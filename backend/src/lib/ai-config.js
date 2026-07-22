import { query } from '../db.js';
import { logError } from '../logger.js';

export function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return ['openai', 'gemini', 'openrouter'].includes(provider) ? provider : null;
}

export function cleanAIKey(value) {
  const key = String(value || '').trim();
  if (!key) return null;

  // Valores mascarados/placeholder nunca devem ser enviados para o provedor.
  if (key.startsWith('••')) return null;
  if (/^\*+$/.test(key)) return null;
  if (['null', 'undefined', 'none', 'api_key', 'your_api_key', 'sua_api_key'].includes(key.toLowerCase())) return null;
  if (key === '@N3tw0rk$') return null;

  return key;
}

export function inferProviderFromKey(apiKey, fallbackProvider = null) {
  const key = String(apiKey || '').trim();
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-')) return 'openai';
  return normalizeProvider(fallbackProvider) || null;
}

export function defaultModelForProvider(provider) {
  if (provider === 'gemini') return 'gemini-2.5-flash';
  if (provider === 'openrouter') return 'openai/gpt-4o-mini';
  return 'gpt-4o-mini';
}

export function getEnvKeyForProvider(provider) {
  if (provider === 'gemini') return cleanAIKey(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (provider === 'openai') return cleanAIKey(process.env.OPENAI_API_KEY);
  if (provider === 'openrouter') return cleanAIKey(process.env.OPENROUTER_API_KEY);
  return null;
}

export function modelMatchesProvider(provider, model) {
  const m = String(model || '').trim().toLowerCase();
  if (!m) return false;
  if (provider === 'gemini') return m.startsWith('gemini-');
  if (provider === 'openrouter') return m.includes('/');
  if (provider === 'openai') return !m.includes('/') && !m.startsWith('gemini-');
  return false;
}

export function resolveModelForProvider(provider, ...models) {
  const matching = models.map(m => String(m || '').trim()).find(m => modelMatchesProvider(provider, m));
  return matching || defaultModelForProvider(provider);
}

function pickLegacyAIConfig(row, preferredProvider = null, preferredModel = null) {
  if (!row) return null;

  const providerPriority = [
    normalizeProvider(preferredProvider),
    normalizeProvider(row.ai_provider),
    normalizeProvider(row.provider),
    normalizeProvider(row.default_provider),
    'openai',
    'gemini',
    'openrouter',
  ].filter(Boolean);

  const keyAliases = {
    openai: ['openai_api_key', 'openai_key', 'OPENAI_API_KEY'],
    gemini: ['gemini_api_key', 'google_api_key', 'gemini_key', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    openrouter: ['openrouter_api_key', 'openrouter_key', 'OPENROUTER_API_KEY'],
  };

  for (const provider of [...new Set(providerPriority)]) {
    const aliases = keyAliases[provider] || [];
    const keyField = aliases.find(field => cleanAIKey(row[field]));
    const apiKey = keyField ? cleanAIKey(row[keyField]) : null;
    if (!apiKey) continue;

    return {
      provider,
      model: resolveModelForProvider(provider, preferredModel, row[`${provider}_model`], row.ai_model, row.model),
      apiKey,
      keySource: `organization_ai_config.${keyField}`,
    };
  }

  return null;
}

export async function getOrganizationAIConfig(organizationId, preferredProvider = null, preferredModel = null) {
  const orgResult = await query(
    `SELECT ai_provider, ai_model, ai_api_key
       FROM organizations
      WHERE id = $1
      LIMIT 1`,
    [organizationId]
  ).catch((error) => {
    logError('ai_config.organization_lookup_error', error);
    return { rows: [] };
  });

  const org = orgResult.rows[0];
  const orgApiKey = cleanAIKey(org?.ai_api_key);
  if (orgApiKey) {
    const provider = normalizeProvider(org?.ai_provider) || inferProviderFromKey(orgApiKey, preferredProvider) || 'openai';
    return {
      provider,
      model: resolveModelForProvider(provider, preferredModel, org?.ai_model),
      apiKey: orgApiKey,
      keySource: 'organizations.ai_api_key',
    };
  }

  const legacyResult = await query(
    `SELECT *
       FROM organization_ai_config
      WHERE organization_id = $1
      LIMIT 1`,
    [organizationId]
  ).catch((error) => {
    // A tabela existe apenas em algumas instalações antigas/novas.
    if (error?.code !== '42P01') logError('ai_config.legacy_lookup_error', error);
    return { rows: [] };
  });

  const legacyConfig = pickLegacyAIConfig(legacyResult.rows[0], org?.ai_provider || preferredProvider, preferredModel || org?.ai_model);
  if (legacyConfig) return legacyConfig;

  // Fallback multi-org: se a organização atual está sem chave (vazia/mascarada) mas
  // outra organização que compartilha membros já tem uma chave válida salva
  // (cenário comum: usuário pertence a várias orgs e configurou a IA apenas em uma delas),
  // reaproveita essa chave para não travar o módulo.
  const siblingResult = await query(
    `SELECT o.id, o.ai_provider, o.ai_model, o.ai_api_key
       FROM organizations o
      WHERE o.id <> $1
        AND o.ai_api_key IS NOT NULL
        AND length(trim(o.ai_api_key)) > 0
        AND (
          EXISTS (
            SELECT 1 FROM organization_members m1
              JOIN organization_members m2 ON m1.user_id = m2.user_id
             WHERE m1.organization_id = $1 AND m2.organization_id = o.id
          )
        )
      ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST
      LIMIT 5`,
    [organizationId]
  ).catch((error) => {
    logError('ai_config.sibling_lookup_error', error);
    return { rows: [] };
  });

  for (const sibling of siblingResult.rows) {
    const key = cleanAIKey(sibling.ai_api_key);
    if (!key) continue;
    const provider = normalizeProvider(sibling.ai_provider) || inferProviderFromKey(key, preferredProvider) || 'openai';
    return {
      provider,
      model: resolveModelForProvider(provider, preferredModel, sibling.ai_model),
      apiKey: key,
      keySource: `organizations.ai_api_key (sibling:${sibling.id})`,
    };
  }

  const provider = normalizeProvider(org?.ai_provider) || normalizeProvider(preferredProvider);
  if (provider) {
    return {
      provider,
      model: resolveModelForProvider(provider, preferredModel, org?.ai_model),
      apiKey: null,
      keySource: 'organizations.ai_provider',
    };
  }

  return null;
}

export async function getAgentAIConfig(agent, organizationId) {
  const agentApiKey = cleanAIKey(agent?.ai_api_key);
  if (agentApiKey) {
    const provider = normalizeProvider(agent?.ai_provider) || inferProviderFromKey(agentApiKey) || 'openai';
    return {
      provider,
      model: resolveModelForProvider(provider, agent?.ai_model),
      apiKey: agentApiKey,
      keySource: 'ai_agents.ai_api_key',
    };
  }

  const orgConfig = await getOrganizationAIConfig(organizationId, agent?.ai_provider, agent?.ai_model);
  if (orgConfig?.apiKey) return orgConfig;

  // Fallback: environment variables (permite operação quando a chave da org foi
  // salva mascarada/vazia por engano, ou quando o admin configurou via env).
  const provider =
    orgConfig?.provider ||
    normalizeProvider(agent?.ai_provider) ||
    (process.env.OPENAI_API_KEY ? 'openai' : null) ||
    (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'gemini' : null) ||
    (process.env.OPENROUTER_API_KEY ? 'openrouter' : null);

  if (provider) {
    const envKey = getEnvKeyForProvider(provider);
    if (envKey) {
      return {
        provider,
        model: resolveModelForProvider(provider, agent?.ai_model, orgConfig?.model),
        apiKey: envKey,
        keySource: `env.${provider}`,
      };
    }
  }

  const detail = orgConfig?.provider
    ? ` (organização tem provider="${orgConfig.provider}" mas a chave está vazia ou mascarada — reabra Ajustes → IA e cole a chave novamente).`
    : '';
  throw new Error(
    `Nenhuma chave de API válida configurada. Configure a chave da organização em Ajustes → IA ou informe uma chave específica no agente.${detail}`
  );
}