// Helper to send a Meta WhatsApp template via Graph API
// Reused by chat send-template route and campaign scheduler.

function applyContactVars(text, contact = {}) {
  if (!text) return '';
  return String(text).replace(/\{(name|nome|phone|telefone|email|company|empresa)\}/gi, (_, key) => {
    const k = key.toLowerCase();
    if (k === 'nome' || k === 'name') return contact.name || contact.contact_name || '';
    if (k === 'telefone' || k === 'phone') return contact.phone || contact.contact_phone || '';
    if (k === 'email') return contact.email || '';
    if (k === 'empresa' || k === 'company') return contact.company || '';
    return '';
  });
}

export function resolveParamValue(rawValue, contact = {}) {
  if (rawValue == null) return '';
  return applyContactVars(String(rawValue), contact).trim();
}

// Extracts placeholders in the order they appear, deduplicated.
// Supports numbered ({{1}}) and named ({{nome_cliente}}) templates.
function extractPlaceholders(text = '') {
  const found = [];
  const seen = new Set();
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    if (!seen.has(key)) {
      seen.add(key);
      found.push(key);
    }
  }
  return found;
}

// Looks up a param value using every key shape the UI/DB may have stored.
function pickParam(paramValues, key, position) {
  const candidates = [
    `{{${key}}}`,
    key,
    `{{ ${key} }}`,
    `{{${position}}}`,
    String(position),
  ];
  for (const c of candidates) {
    if (paramValues[c] != null && String(paramValues[c]).trim() !== '') return paramValues[c];
  }
  return '';
}

function buildTextParam(key, position, paramValues, contact) {
  const raw = pickParam(paramValues, key, position);
  const param = { type: 'text', text: resolveParamValue(raw, contact) || ' ' };
  // Named-parameter templates require parameter_name; numbered ones must NOT have it.
  if (!/^\d+$/.test(key)) param.parameter_name = key.toLowerCase();
  return param;
}

export function buildTemplateComponents(components, paramValues = {}, contact = {}) {
  const out = [];
  const bodyComp = (components || []).find(c => (c.type || '').toUpperCase() === 'BODY');
  const headerComp = (components || []).find(c => (c.type || '').toUpperCase() === 'HEADER');
  const buttonsComps = (components || []).filter(c => (c.type || '').toUpperCase() === 'BUTTONS');

  if (headerComp) {
    const headerFormat = (headerComp.format || '').toUpperCase();
    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
      const mediaUrl = paramValues['{{header_media}}'] || paramValues['header_media'];
      if (mediaUrl) {
        const mediaType = headerFormat.toLowerCase();
        out.push({ type: 'header', parameters: [{ type: mediaType, [mediaType]: { link: mediaUrl } }] });
      }
    } else if (headerComp.text) {
      // Only send header parameters when the template header actually has placeholders.
      const keys = extractPlaceholders(headerComp.text);
      if (keys.length > 0) {
        out.push({
          type: 'header',
          parameters: keys.map((k, i) => buildTextParam(k, i + 1, paramValues, contact)),
        });
      }
    }
  }

  if (bodyComp?.text) {
    const keys = extractPlaceholders(bodyComp.text);
    if (keys.length > 0) {
      out.push({
        type: 'body',
        parameters: keys.map((k, i) => buildTextParam(k, i + 1, paramValues, contact)),
      });
    }
  }

  for (const btnComp of buttonsComps) {
    const buttons = btnComp.buttons || [];
    buttons.forEach((btn, idx) => {
      if (btn.type === 'URL' && btn.url && btn.url.includes('{{')) {
        const keys = extractPlaceholders(btn.url);
        const key = keys[0] || '1';
        const v = paramValues[`{{button_${idx}}}`] ?? paramValues[`button_${idx}`] ?? pickParam(paramValues, key, 1);
        if (v) {
          out.push({
            type: 'button',
            sub_type: 'url',
            index: String(idx),
            parameters: [{ type: 'text', text: resolveParamValue(v, contact) }],
          });
        }
      }
    });
  }

  return out;
}


export async function sendMetaTemplate({
  metaToken,
  metaPhoneNumberId,
  toPhone,
  templateName,
  language,
  components,
  paramValues,
  contact,
}) {
  const cleanPhone = String(toPhone || '').replace(/\D/g, '');
  if (!cleanPhone) throw new Error('Telefone inválido');
  if (!metaToken || !metaPhoneNumberId) throw new Error('Conexão Meta sem token/phone_number_id');
  if (!templateName) throw new Error('Template inválido');

  const templateComponents = buildTemplateComponents(components || [], paramValues || {}, contact || {});

  const payload = {
    messaging_product: 'whatsapp',
    to: cleanPhone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language || 'pt_BR' },
      ...(templateComponents.length > 0 ? { components: templateComponents } : {}),
    },
  };

  const post = async (body) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${metaToken}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
      const json = await response.json().catch(() => ({}));
      return { response, json };
    } finally {
      clearTimeout(timeout);
    }
  };

  let { response, json: result } = await post(payload);

  // #132012 = parameter format mismatch. Common cause: named vs numbered params.
  // Retry once with parameter_name stripped (numbered format).
  if (!response.ok && Number(result?.error?.code) === 132012) {
    const stripped = JSON.parse(JSON.stringify(payload));
    let changed = false;
    for (const comp of stripped.template?.components || []) {
      for (const p of comp.parameters || []) {
        if (p.parameter_name) { delete p.parameter_name; changed = true; }
      }
    }
    if (changed) {
      const retry = await post(stripped);
      response = retry.response;
      result = retry.json;
    }
  }

  if (!response.ok) {
    const metaErr = result?.error || {};
    let errMsg = metaErr.error_user_msg || metaErr.message || `HTTP ${response.status}`;
    if (Number(metaErr.code) === 132012) {
      const expected = templateComponents
        .map(c => `${c.type}: ${(c.parameters || []).length}`)
        .join(', ') || 'nenhum';
      errMsg = `Formato dos parâmetros não corresponde ao template aprovado na Meta (#132012). Enviado -> ${expected}. Verifique se o template usa variáveis numeradas ({{1}}) ou nomeadas e se todos foram preenchidos.`;
    }
    const err = new Error(errMsg);
    err.metaError = metaErr;
    err.status = response.status;
    err.isTransient = response.status >= 500 || response.status === 429;
    throw err;
  }


  const metaMessageId = result?.messages?.[0]?.id || `template_${Date.now()}`;

  // Build readable text from BODY for storage
  const bodyComp = (components || []).find(c => (c.type || '').toUpperCase() === 'BODY');
  let readable = bodyComp?.text || templateName;
  Object.entries(paramValues || {}).forEach(([k, v]) => {
    readable = readable.replace(k, resolveParamValue(v, contact));
  });

  return { metaMessageId, readable, payload };
}