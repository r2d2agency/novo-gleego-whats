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
      const headerParams = headerComp.text.match(/\{\{(\d+)\}\}/g) || ['{{1}}'];
      if (headerParams.length > 0) {
        out.push({
          type: 'header',
          parameters: headerParams.map(p => ({
            type: 'text',
            text: resolveParamValue(paramValues[p], contact) || ' ',
          })),
        });
      }
    }
  }

  if (bodyComp?.text) {
    const bodyParams = bodyComp.text.match(/\{\{(\d+)\}\}/g) || [];
    if (bodyParams.length > 0) {
      out.push({
        type: 'body',
        parameters: bodyParams.map(p => ({
          type: 'text',
          text: resolveParamValue(paramValues[p], contact) || ' ',
        })),
      });
    }
  }

  for (const btnComp of buttonsComps) {
    const buttons = btnComp.buttons || [];
    buttons.forEach((btn, idx) => {
      if (btn.type === 'URL' && btn.url && btn.url.includes('{{')) {
        const v = paramValues[`{{button_${idx}}}`] || paramValues[`button_${idx}`];
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

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${metaToken}` },
      body: JSON.stringify(payload),
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const metaErr = result?.error || {};
    const errMsg = metaErr.error_user_msg || metaErr.message || `HTTP ${response.status}`;
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