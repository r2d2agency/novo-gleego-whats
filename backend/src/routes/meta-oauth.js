import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PROVIDERS = new Set(['facebook', 'instagram', 'whatsapp']);
const CONNECT_ROLES = new Set(['owner', 'admin']);

function hashState(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function redirectUriFor(req, requested) {
  const configured = process.env.META_OAUTH_REDIRECT_URI;
  const value = String(requested || configured || '').trim();
  if (!value || !/^https:\/\//i.test(value)) return null;
  return value;
}

async function getMembership(userId, organizationId) {
  const result = await query(
    `SELECT om.organization_id, om.role, COALESCE(u.is_superadmin, false) AS is_superadmin
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
      WHERE om.user_id = $1 AND om.organization_id = $2`,
    [userId, organizationId]
  );
  return result.rows[0] || null;
}

function scopesFor(provider) {
  if (provider === 'instagram') {
    return ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'instagram_basic', 'instagram_manage_messages', 'leads_retrieval'];
  }
  if (provider === 'whatsapp') {
    return ['business_management', 'whatsapp_business_management', 'whatsapp_business_messaging'];
  }
  return ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'pages_messaging', 'leads_retrieval', 'instagram_basic', 'instagram_manage_messages'];
}

router.post('/start', authenticate, async (req, res) => {
  try {
    const provider = String(req.body?.provider || '').trim().toLowerCase();
    const organizationId = String(req.body?.organization_id || '').trim();
    if (!PROVIDERS.has(provider) || !organizationId) {
      return res.status(400).json({ error: 'provider e organization_id são obrigatórios' });
    }
    const membership = await getMembership(req.userId, organizationId);
    if (!membership || (!membership.is_superadmin && !CONNECT_ROLES.has(membership.role))) {
      return res.status(403).json({ error: 'Apenas administradores da organização podem conectar o Meta' });
    }
    const appId = String(process.env.META_APP_ID || '').trim();
    if (!appId) return res.status(503).json({ error: 'META_APP_ID não configurado no backend' });
    const redirectUri = redirectUriFor(req, req.body?.redirect_uri);
    if (!redirectUri) return res.status(400).json({ error: 'META_OAUTH_REDIRECT_URI HTTPS não configurado' });

    const state = crypto.randomBytes(32).toString('base64url');
    await query(
      `INSERT INTO meta_oauth_states (state_hash, organization_id, user_id, provider, redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '10 minutes')`,
      [hashState(state), organizationId, req.userId, provider, redirectUri]
    );
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: scopesFor(provider).join(','),
    });
    res.json({ url: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}` });
  } catch (error) {
    console.error('[Meta OAuth] start failed:', error.message);
    res.status(500).json({ error: 'Não foi possível iniciar a conexão Meta' });
  }
});

router.get('/callback', async (req, res) => {
  const frontend = process.env.FRONTEND_URL || process.env.APP_URL || '/conectar-meta';
  try {
    const { code, state, error: oauthError, error_description: errorDescription } = req.query;
    if (oauthError) return res.redirect(`${frontend}?meta=error&message=${encodeURIComponent(errorDescription || oauthError)}`);
    if (!code || !state) return res.redirect(`${frontend}?meta=error&message=callback_invalido`);

    const stateResult = await query(
      `UPDATE meta_oauth_states SET consumed_at = NOW()
        WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()
        RETURNING *`,
      [hashState(String(state))]
    );
    const oauthState = stateResult.rows[0];
    if (!oauthState) return res.redirect(`${frontend}?meta=error&message=state_invalido_ou_expirado`);

    const appId = String(process.env.META_APP_ID || '').trim();
    const appSecret = String(process.env.META_APP_SECRET || '').trim();
    if (!appId || !appSecret) throw new Error('Credenciais META_APP_ID/META_APP_SECRET ausentes');
    const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: oauthState.redirect_uri, code: String(code) });
    const tokenResponse = await fetch(tokenUrl);
    const tokenBody = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenBody.access_token) throw new Error(tokenBody?.error?.message || 'Falha ao trocar código OAuth');

    const accessToken = tokenBody.access_token;
    const meResponse = await fetch(`${GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`);
    const meBody = await meResponse.json().catch(() => ({}));
    if (!meResponse.ok || !meBody.id) throw new Error(meBody?.error?.message || 'Não foi possível validar usuário Meta');

    await query(
      `UPDATE meta_oauth_connections
          SET user_id = $2, access_token = $5, token_expires_at = $6,
              scopes = $7, metadata = $8::jsonb, updated_at = NOW()
        WHERE organization_id = $1 AND provider = $3 AND fb_user_id = $4`,
      [oauthState.organization_id, oauthState.user_id, oauthState.provider, meBody.id, accessToken,
        tokenBody.expires_in ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000) : null,
        scopesFor(oauthState.provider), JSON.stringify({ fb_user_name: meBody.name || null })]
    );
    await query(
      `INSERT INTO meta_oauth_connections (organization_id, user_id, provider, fb_user_id, access_token, token_expires_at, scopes, metadata)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM meta_oauth_connections
           WHERE organization_id = $1 AND provider = $3 AND fb_user_id = $4
        )`,
      [oauthState.organization_id, oauthState.user_id, oauthState.provider, meBody.id, accessToken,
        tokenBody.expires_in ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000) : null,
        scopesFor(oauthState.provider), JSON.stringify({ fb_user_name: meBody.name || null })]
    );
    res.redirect(`${frontend}?meta=ok&provider=${encodeURIComponent(oauthState.provider)}`);
  } catch (error) {
    console.error('[Meta OAuth] callback failed:', error.message);
    res.redirect(`${frontend}?meta=error&message=${encodeURIComponent(error.message || 'falha_oauth')}`);
  }
});

router.get('/assets', authenticate, async (req, res) => {
  try {
    const organizationId = String(req.query.organization_id || '').trim();
    if (!organizationId) return res.status(400).json({ error: 'organization_id é obrigatório' });
    if (!await getMembership(req.userId, organizationId)) return res.status(403).json({ error: 'Organização não autorizada' });
    const result = await query(
      `SELECT id, oauth_connection_id, kind, external_id, external_name, waba_id, phone_number, status, metadata, created_at, updated_at
         FROM meta_pages WHERE organization_id = $1 ORDER BY kind, external_name NULLS LAST`,
      [organizationId]
    );
    res.json({ assets: result.rows });
  } catch (error) {
    console.error('[Meta OAuth] assets list failed:', error.message);
    res.status(500).json({ error: 'Não foi possível listar ativos Meta' });
  }
});

router.post('/assets/sync', authenticate, async (req, res) => {
  try {
    const organizationId = String(req.body?.organization_id || '').trim();
    const connectionId = String(req.body?.connection_id || '').trim();
    if (!organizationId || !connectionId) return res.status(400).json({ error: 'organization_id e connection_id são obrigatórios' });
    const membership = await getMembership(req.userId, organizationId);
    if (!membership || (!membership.is_superadmin && !CONNECT_ROLES.has(membership.role))) return res.status(403).json({ error: 'Sem permissão para sincronizar ativos' });
    const connectionResult = await query(
      `SELECT id, provider, access_token FROM meta_oauth_connections WHERE id = $1 AND organization_id = $2`,
      [connectionId, organizationId]
    );
    const connection = connectionResult.rows[0];
    if (!connection) return res.status(404).json({ error: 'Conexão Meta não encontrada' });
    const graphUrl = new URL(`${GRAPH_BASE}/me/accounts`);
    graphUrl.search = new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account{id,username,name}', limit: '100', access_token: connection.access_token });
    const graphResponse = await fetch(graphUrl);
    const graphBody = await graphResponse.json().catch(() => ({}));
    if (!graphResponse.ok) return res.status(502).json({ error: graphBody?.error?.message || 'Falha ao consultar ativos Meta' });
    let synced = 0;
    for (const page of graphBody.data || []) {
      const pageResult = await query(
        `INSERT INTO meta_pages (organization_id, oauth_connection_id, kind, external_id, external_name, page_access_token, metadata, status)
         VALUES ($1, $2, 'facebook_page', $3, $4, $5, $6::jsonb, 'active')
         ON CONFLICT (organization_id, kind, external_id) DO UPDATE SET
           oauth_connection_id = EXCLUDED.oauth_connection_id, external_name = EXCLUDED.external_name,
           page_access_token = EXCLUDED.page_access_token, metadata = EXCLUDED.metadata, updated_at = NOW()
         RETURNING id`,
        [organizationId, connection.id, String(page.id), page.name || null, page.access_token || null, JSON.stringify({ source: 'oauth', provider: connection.provider })]
      );
      synced += 1;
      const instagram = page.instagram_business_account;
      if (instagram?.id) {
        await query(
          `INSERT INTO meta_pages (organization_id, oauth_connection_id, kind, external_id, external_name, page_access_token, metadata, status)
           VALUES ($1, $2, 'instagram_account', $3, $4, $5, $6::jsonb, 'active')
           ON CONFLICT (organization_id, kind, external_id) DO UPDATE SET
             oauth_connection_id = EXCLUDED.oauth_connection_id, external_name = EXCLUDED.external_name,
             page_access_token = EXCLUDED.page_access_token, metadata = EXCLUDED.metadata, updated_at = NOW()`,
          [organizationId, connection.id, String(instagram.id), instagram.username ? `@${instagram.username}` : (instagram.name || null), page.access_token || null, JSON.stringify({ source: 'oauth', page_id: String(page.id), provider: connection.provider })]
        );
        synced += 1;
      }
    }
    res.json({ success: true, synced });
  } catch (error) {
    console.error('[Meta OAuth] assets sync failed:', error.message);
    res.status(500).json({ error: 'Não foi possível sincronizar ativos Meta' });
  }
});

router.patch('/assets/:id', authenticate, async (req, res) => {
  try {
    const organizationId = String(req.body?.organization_id || '').trim();
    const status = String(req.body?.status || '').trim();
    if (!organizationId) return res.status(400).json({ error: 'organization_id é obrigatório' });
    if (!['active', 'paused'].includes(status)) return res.status(400).json({ error: 'status deve ser active ou paused' });
    const membership = await getMembership(req.userId, organizationId);
    if (!membership || (!membership.is_superadmin && !CONNECT_ROLES.has(membership.role))) return res.status(403).json({ error: 'Sem permissão para alterar ativos' });
    const result = await query(
      `UPDATE meta_pages SET status = $1, updated_at = NOW()
        WHERE id = $2 AND organization_id = $3
        RETURNING id, kind, external_id, external_name, status`,
      [status, req.params.id, organizationId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Ativo não encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Meta OAuth] asset update failed:', error.message);
    res.status(500).json({ error: 'Não foi possível atualizar o ativo' });
  }
});

router.get('/connections', authenticate, async (req, res) => {
  const organizationId = String(req.query.organization_id || '').trim();
  if (!organizationId) return res.status(400).json({ error: 'organization_id é obrigatório' });
  const membership = await getMembership(req.userId, organizationId);
  if (!membership) return res.status(403).json({ error: 'Organização não autorizada' });
  const result = await query(
    `SELECT id, provider, fb_user_id, token_expires_at, scopes, metadata, created_at, updated_at
       FROM meta_oauth_connections WHERE organization_id = $1 ORDER BY created_at DESC`,
    [organizationId]
  );
  res.json({ connections: result.rows });
});

export default router;
