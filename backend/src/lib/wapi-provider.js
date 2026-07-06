// W-API Provider - Backend implementation
// https://api.w-api.app/v1/

import { logError, logInfo, logWarn } from '../logger.js';
import { fetchWithRetry } from './retry-fetch.js';
import http from 'http';
import https from 'https';

const W_API_BASE_URL = (process.env.W_API_BASE_URL || 'https://api.w-api.app/v1').replace(/\/$/, '');
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || process.env.API_BASE_URL || '';

// In-memory send attempts buffer (for diagnostics only; not persisted)
const SEND_ATTEMPTS_MAX = 200;
const sendAttempts = []; // { at, instanceId, phone, messageType, success, status, error, preview }

// In-memory endpoint discovery attempts buffer (for diagnostics only)
const ENDPOINT_DISCOVERY_MAX = 300;
const endpointDiscoveryAttempts = []; // { at, instanceId, label, attempts: [{url, method, status, error?}], resolvedUrl?, success }

function recordSendAttempt(attempt) {
  try {
    sendAttempts.unshift(attempt);
    if (sendAttempts.length > SEND_ATTEMPTS_MAX) sendAttempts.length = SEND_ATTEMPTS_MAX;
  } catch {
    // no-op
  }
}

function recordEndpointDiscovery({ instanceId, label, attempts, resolvedUrl, success }) {
  try {
    endpointDiscoveryAttempts.unshift({
      at: new Date().toISOString(),
      instanceId: instanceId || null,
      label,
      attempts: attempts || [],
      resolvedUrl: resolvedUrl || null,
      success: Boolean(success),
    });
    if (endpointDiscoveryAttempts.length > ENDPOINT_DISCOVERY_MAX) endpointDiscoveryAttempts.length = ENDPOINT_DISCOVERY_MAX;
  } catch {
    // no-op
  }
}

export function getEndpointDiscoveryAttempts({ instanceId, limit = 200 } = {}) {
  const filtered = instanceId ? endpointDiscoveryAttempts.filter((a) => a.instanceId === instanceId) : endpointDiscoveryAttempts;
  return filtered.slice(0, Math.max(1, Math.min(300, Number(limit) || 200)));
}

export function clearEndpointDiscoveryAttempts(instanceId) {
  if (!instanceId) {
    endpointDiscoveryAttempts.length = 0;
    return;
  }
  for (let i = endpointDiscoveryAttempts.length - 1; i >= 0; i--) {
    if (endpointDiscoveryAttempts[i]?.instanceId === instanceId) endpointDiscoveryAttempts.splice(i, 1);
  }
}

export function getSendAttempts({ instanceId, limit = 200 } = {}) {
  const filtered = instanceId ? sendAttempts.filter((a) => a.instanceId === instanceId) : sendAttempts;
  return filtered.slice(0, Math.max(1, Math.min(200, Number(limit) || 200)));
}

export function clearSendAttempts(instanceId) {
  if (!instanceId) {
    sendAttempts.length = 0;
    return;
  }
  for (let i = sendAttempts.length - 1; i >= 0; i--) {
    if (sendAttempts[i]?.instanceId === instanceId) sendAttempts.splice(i, 1);
  }
}

async function readJsonResponse(response) {
  const text = await response.text().catch(() => '');
  if (!text) return { data: {}, text: '' };
  try {
    return { data: JSON.parse(text), text };
  } catch {
    // Keep raw text to avoid hard-failing when provider returns non-JSON payloads
    return { data: { raw: text }, text };
  }
}

/**
 * Verify that a media URL is accessible (HEAD request with timeout)
 * Returns { accessible: true, contentType, contentLength } or { accessible: false, error }
 */
async function verifyMediaUrl(url, timeoutMs = 8000) {
  if (!url || typeof url !== 'string') {
    return { accessible: false, error: 'URL vazia ou inválida' };
  }

  return new Promise((resolve) => {
    try {
      const client = url.startsWith('https://') ? https : http;
      const req = client.request(
        url,
        { method: 'HEAD', timeout: timeoutMs },
        (res) => {
          const status = res.statusCode || 0;
          const contentType = res.headers['content-type'] || '';
          const contentLength = parseInt(res.headers['content-length'] || '0', 10);

          if (status >= 200 && status < 400) {
            // Check if it's HTML (error page) instead of actual file
            if (contentType.includes('text/html')) {
              resolve({
                accessible: false,
                error: `URL retorna HTML ao invés do arquivo (status ${status}). Verifique se a URL é pública.`,
                status,
                contentType,
              });
            } else {
              resolve({ accessible: true, contentType, contentLength, status });
            }
          } else {
            resolve({
              accessible: false,
              error: `URL não acessível (HTTP ${status})`,
              status,
              contentType,
            });
          }
        }
      );

      req.on('error', (err) => {
        resolve({ accessible: false, error: `Erro de conexão: ${err.message}` });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ accessible: false, error: `Timeout ao acessar URL (${timeoutMs}ms)` });
      });

      req.end();
    } catch (err) {
      resolve({ accessible: false, error: `Exceção: ${err.message}` });
    }
  });
}

/**
 * Get headers for W-API requests
 */
function getHeaders(token) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

/**
 * Configure all webhooks for a W-API instance
 * Called when creating or updating a connection
 */
export async function configureWebhooks(instanceId, token) {
  const webhookUrl = `${WEBHOOK_BASE_URL}/api/wapi/webhook`;

  if (!/^https?:\/\//i.test(webhookUrl)) {
    const error = 'WEBHOOK_BASE_URL/API_BASE_URL inválido: defina uma URL pública absoluta (https://...)';
    logWarn('wapi.webhooks_configure_invalid_base_url', {
      instance_id: instanceId,
      webhook_url: webhookUrl,
      webhook_base_url: WEBHOOK_BASE_URL,
    });
    return {
      success: false,
      configured: 0,
      total: 0,
      required_ok: false,
      required_webhooks: ['received'],
      missing_required: ['received'],
      results: [{ type: 'base-url', success: false, error }],
    };
  }

  logInfo('wapi.webhooks_configure_started', {
    instance_id: instanceId,
    webhook_url: webhookUrl,
  });
  
  const webhookTypes = [
    { endpoint: 'update-webhook-received', name: 'received' },              // Mensagens recebidas
    { endpoint: 'update-webhook-delivery', name: 'delivery' },              // Status de entrega
    { endpoint: 'update-webhook-message-status', name: 'message-status' },  // Status de msg (lido, entregue)
    { endpoint: 'update-webhook-connected', name: 'connected' },            // Conexão estabelecida
    { endpoint: 'update-webhook-disconnected', name: 'disconnected' },      // Desconexão
    { endpoint: 'update-webhook-chat-presence', name: 'chat-presence' },    // Typing/presença
  ];

  const results = [];
  
  for (const wh of webhookTypes) {
    try {
      const response = await fetch(
        `${W_API_BASE_URL}/webhook/${wh.endpoint}?instanceId=${instanceId}`,
        {
          method: 'PUT',
          headers: getHeaders(token),
          body: JSON.stringify({ 
            url: webhookUrl,
            enabled: true,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));
      results.push({ 
        type: wh.name, 
        success: response.ok, 
        status: response.status,
        data 
      });

      if (response.ok) {
        logInfo('wapi.webhook_configured', {
          instance_id: instanceId,
          webhook_type: wh.name,
          status_code: response.status,
        });
      } else {
        logWarn('wapi.webhook_config_failed', {
          instance_id: instanceId,
          webhook_type: wh.name,
          status_code: response.status,
          error: data?.message || data?.error || null,
          body_preview: JSON.stringify(data).slice(0, 400),
        });
      }
    } catch (error) {
      logError('wapi.webhook_config_exception', error, {
        instance_id: instanceId,
        webhook_type: wh.name,
      });
      results.push({ type: wh.name, success: false, error: error.message });
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  const requiredWebhooks = ['received'];
  const missingRequired = requiredWebhooks.filter((required) => {
    const found = results.find((r) => r.type === required);
    return !found || !found.success;
  });
  const requiredOk = missingRequired.length === 0;

  logInfo('wapi.webhooks_configure_finished', {
    instance_id: instanceId,
    configured: successCount,
    total: webhookTypes.length,
    required_ok: requiredOk,
    missing_required: missingRequired,
  });
  return {
    success: requiredOk,
    configured: successCount,
    total: webhookTypes.length,
    required_ok: requiredOk,
    required_webhooks: requiredWebhooks,
    missing_required: missingRequired,
    results,
  };
}

/**
 * Read current webhook configuration from the W-API instance for diagnostics.
 */
export async function getWebhookConfig(instanceId, token) {
  const webhookNames = [
    { endpoint: 'get-webhook-received', name: 'received' },
    { endpoint: 'get-webhook-delivery', name: 'delivery' },
    { endpoint: 'get-webhook-message-status', name: 'message-status' },
    { endpoint: 'get-webhook-connected', name: 'connected' },
    { endpoint: 'get-webhook-disconnected', name: 'disconnected' },
    { endpoint: 'get-webhook-chat-presence', name: 'chat-presence' },
  ];

  const results = [];

  for (const wh of webhookNames) {
    try {
      const response = await fetch(
        `${W_API_BASE_URL}/webhook/${wh.endpoint}?instanceId=${instanceId}`,
        { method: 'GET', headers: getHeaders(token) }
      );
      const data = await response.json().catch(() => ({}));
      results.push({ type: wh.name, status: response.status, ok: response.ok, data });
    } catch (error) {
      results.push({ type: wh.name, ok: false, error: error.message });
    }
  }

  return results;
}

/**

 * Create a new W-API instance via the integrator endpoint.
 * POST https://api.w-api.app/v1/integrator/create-instance
 * Returns { instanceId, token } of the newly created instance.
 */
export async function createInstance(token, instanceName) {
  logInfo('wapi.create_instance_started', { instance_name: instanceName || null });

  const url = `${W_API_BASE_URL}/integrator/create-instance`;
  const body = {
    instanceName: instanceName || `inst-${Date.now().toString(36)}`,
    rejectCalls: true,
    callMessage: 'Não estamos disponíveis no momento.',
  };

  try {
    console.log('[W-API] Creating instance:', url, 'body:', JSON.stringify(body));

    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    const text = await response.text();
    console.log('[W-API] Create instance response:', response.status, text.slice(0, 1000));

    let data = {};
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!response.ok) {
      const errMsg = data?.message || data?.error || data?.detail || `HTTP ${response.status}: ${text.slice(0, 200)}`;
      logError('wapi.create_instance_failed', new Error(errMsg), { status: response.status, url, body: text.slice(0, 500) });
      throw new Error(errMsg);
    }

    // Extract instanceId from response (check multiple shapes)
    const candidates = [data, data?.data, data?.result, data?.instance].filter(Boolean);
    let instanceId = null;
    let instanceToken = null;

    for (const c of candidates) {
      instanceId = instanceId || c?.instanceId || c?.instance_id || c?.id || null;
      instanceToken = instanceToken || c?.token || c?.accessToken || c?.access_token || null;
    }

    if (!instanceId) {
      logError('wapi.create_instance_no_id', new Error('No instanceId in response'), { body: text.slice(0, 500) });
      throw new Error('W-API não retornou um Instance ID válido');
    }

    logInfo('wapi.create_instance_success', { instance_id: instanceId });
    return {
      instanceId,
      token: instanceToken || token,
      raw: data,
    };
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('Timeout ao criar instância W-API');
    }
    throw error;
  }
}

/**
 * Delete a W-API instance
 * DELETE https://api.w-api.app/v1/instance/delete?instanceId=XXX
 */
export async function deleteInstance(instanceId, token) {
  logInfo('wapi.delete_instance_started', { instance_id: instanceId });

  try {
    const response = await fetch(
      `${W_API_BASE_URL}/instance/delete?instanceId=${encodeURIComponent(instanceId)}`,
      {
        method: 'DELETE',
        headers: getHeaders(token),
        signal: AbortSignal.timeout(15000),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errMsg = data?.message || data?.error || `HTTP ${response.status}`;
      logWarn('wapi.delete_instance_failed', { instance_id: instanceId, error: errMsg });
      return { success: false, error: errMsg };
    }

    logInfo('wapi.delete_instance_success', { instance_id: instanceId });
    return { success: true, data };
  } catch (error) {
    logError('wapi.delete_instance_exception', error, { instance_id: instanceId });
    return { success: false, error: error.message };
  }
}

/**
 * Check instance status
 * W-API returns different response structures, handle all possibilities
 */
export async function checkStatus(instanceId, token) {
  const encodedInstanceId = encodeURIComponent(instanceId || '');
  const startedAt = Date.now();

  if (!instanceId || !token) {
    return { status: 'disconnected', error: 'Instance ID ou Token não configurado' };
  }

  const primaryUrl = `${W_API_BASE_URL}/instance/status-instance?instanceId=${encodedInstanceId}`;

  try {
    // 1) Tenta endpoint principal com retry para intermitência de rede
    const primaryResponse = await fetchWithRetry(
      primaryUrl,
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      {
        label: 'wapi.check_status_primary',
        retries: 1,
        baseDelay: 300,
        maxDelay: 1200,
        timeout: 8000,
      }
    );

    // 2) Se não for 404, processa direto (evita fallback ruidoso)
    if (primaryResponse.status !== 404) {
      const responseText = await primaryResponse.text().catch(() => '');

      if (!primaryResponse.ok) {
        let errMsg = `HTTP ${primaryResponse.status}`;
        try {
          const errData = responseText ? JSON.parse(responseText) : {};
          errMsg = errData?.message || errData?.error || errMsg;
        } catch {
          // ignore parse errors
        }

        logWarn('wapi.status_check_non_ok', {
          instance_id: instanceId,
          status_code: primaryResponse.status,
          error: errMsg,
          duration_ms: Date.now() - startedAt,
        });

        if (primaryResponse.status === 401 || primaryResponse.status === 403) {
          return { status: 'disconnected', error: errMsg };
        }

        return { status: 'connecting', error: errMsg, transient: true };
      }

      let data = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = {};
      }

      const candidatesData = [
        data,
        data?.data,
        data?.result,
        data?.instance,
        data?.data?.instance,
        data?.result?.instance,
        data?.connection,
      ].filter(Boolean);

      const normalize = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
      const looksConnected = (obj) => {
        if (!obj) return false;
        if (obj.connected === true || obj.isConnected === true) return true;
        const status = normalize(obj.status);
        const state = normalize(obj.state);
        return (
          status === 'connected' ||
          status === 'open' ||
          status === 'online' ||
          state === 'open' ||
          state === 'connected' ||
          state === 'online'
        );
      };

      const isConnected = candidatesData.some(looksConnected);

      const pickPhone = (obj) =>
        obj?.phoneNumber ||
        obj?.phone ||
        obj?.number ||
        obj?.wid?.split?.('@')?.[0] ||
        obj?.me?.id?.split?.('@')?.[0] ||
        obj?.me?.user ||
        null;

      let phoneNumber = null;
      for (const c of candidatesData) {
        phoneNumber = pickPhone(c) || phoneNumber;
      }

      if (Date.now() - startedAt > 3000) {
        logInfo('wapi.status_check', {
          instance_id: instanceId,
          connected: isConnected,
          duration_ms: Date.now() - startedAt,
          endpoint: 'status-instance',
        });
      }

      return isConnected
        ? { status: 'connected', phoneNumber }
        : { status: 'disconnected', phoneNumber: phoneNumber || undefined };
    }

    // 3) Só usa fallback quando realmente parece mudança de contrato (404)
    const fallbackCandidates = [
      { url: `${W_API_BASE_URL}/instance/status?instanceId=${encodedInstanceId}`, method: 'GET' },
      { url: `${W_API_BASE_URL}/instance/connection-state?instanceId=${encodedInstanceId}`, method: 'GET' },
      { url: `${W_API_BASE_URL}/instance/status`, method: 'POST', body: { instanceId } },
    ];

    const result = await requestWithEndpointFallback(token, fallbackCandidates, 'checkStatus', instanceId);
    if (!result.success) {
      const attempts = Array.isArray(result.attempts) ? result.attempts : [];
      const hasTransientFailure = attempts.some((attempt) => {
        const status = Number(attempt?.status || 0);
        return status === 0 || status >= 500;
      });

      if (hasTransientFailure) {
        return { status: 'connecting', error: result.error || 'Falha transitória ao verificar status', transient: true };
      }

      return { status: 'disconnected', error: result.error || 'Falha ao verificar status' };
    }

    const data = result.data || {};
    const candidatesData = [
      data,
      data?.data,
      data?.result,
      data?.instance,
      data?.data?.instance,
      data?.result?.instance,
      data?.connection,
    ].filter(Boolean);

    const normalize = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
    const looksConnected = (obj) => {
      if (!obj) return false;
      if (obj.connected === true || obj.isConnected === true) return true;
      const status = normalize(obj.status);
      const state = normalize(obj.state);
      return (
        status === 'connected' ||
        status === 'open' ||
        status === 'online' ||
        state === 'open' ||
        state === 'connected' ||
        state === 'online'
      );
    };

    const isConnected = candidatesData.some(looksConnected);

    const pickPhone = (obj) =>
      obj?.phoneNumber ||
      obj?.phone ||
      obj?.number ||
      obj?.wid?.split?.('@')?.[0] ||
      obj?.me?.id?.split?.('@')?.[0] ||
      obj?.me?.user ||
      null;

    let phoneNumber = null;
    for (const c of candidatesData) {
      phoneNumber = pickPhone(c) || phoneNumber;
    }

    return isConnected
      ? { status: 'connected', phoneNumber }
      : { status: 'disconnected', phoneNumber: phoneNumber || undefined };
  } catch (error) {
    logError('wapi.status_check_exception', error, {
      instance_id: instanceId,
      duration_ms: Date.now() - startedAt,
      endpoint: 'status-instance',
    });
    return { status: 'connecting', error: error.message, transient: true };
  }
}

/**
 * Get QR Code for connection
 * Using /instance/qr-code endpoint with image=enable to get base64 PNG
 */
export async function getQRCode(instanceId, token) {
  try {
    const url = `${W_API_BASE_URL}/instance/qr-code?instanceId=${instanceId}&image=enable`;
    logInfo('wapi.qrcode_request', { instance_id: instanceId, url });

    const response = await fetch(url, { headers: getHeaders(token) });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logWarn('wapi.qrcode_failed', {
        instance_id: instanceId,
        status: response.status,
        body_preview: text.slice(0, 500),
      });
      return null;
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    logInfo('wapi.qrcode_content_type', { instance_id: instanceId, contentType });

    // If the API returns a binary image, convert to base64 data URI
    if (contentType.includes('image/')) {
      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const mimeType = contentType.includes('png') ? 'image/png' : 'image/jpeg';
      logInfo('wapi.qrcode_binary_converted', { instance_id: instanceId, byteLength: bytes.length });
      return `data:${mimeType};base64,${base64}`;
    }

    // Otherwise treat as text (JSON or raw base64)
    const rawText = await response.text();
    logInfo('wapi.qrcode_raw_response', {
      instance_id: instanceId,
      status: response.status,
      body_length: rawText.length,
      body_preview: rawText.slice(0, 500),
    });

    const normalizeQrString = (value) => {
      if (typeof value !== 'string') return null;
      const s = value.trim();
      if (!s) return null;
      if (s.startsWith('data:image/')) return s;
      if (s.length >= 200) return `data:image/png;base64,${s}`;
      return null;
    };

    const directText = normalizeQrString(rawText);
    if (directText) return directText;

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      logWarn('wapi.qrcode_not_json', { instance_id: instanceId, body_preview: rawText.slice(0, 300) });
      return null;
    }

    if (!data || typeof data !== 'object') return null;

    logInfo('wapi.qrcode_parsed', { instance_id: instanceId, keys: Object.keys(data) });

    const direct =
      normalizeQrString(data.qrcode) ||
      normalizeQrString(data.base64) ||
      normalizeQrString(data.qr) ||
      normalizeQrString(data.image);
    if (direct) return direct;

    for (const key of Object.keys(data)) {
      const val = data[key];
      const found = normalizeQrString(val);
      if (found) return found;

      if (val && typeof val === 'object') {
        const nested =
          normalizeQrString(val.qrcode) ||
          normalizeQrString(val.base64) ||
          normalizeQrString(val.qr) ||
          normalizeQrString(val.image);
        if (nested) return nested;
      }
    }

    return null;
  } catch (error) {
    logError('wapi.qrcode_error', error, { instance_id: instanceId });
    return null;
  }
}

/**
 * Get pairing code for phone-based connection (no QR needed)
 * W-API endpoint: GET /instance/pairing-code?instanceId=ID&phoneNumber=PHONE
 */
export async function getPairingCode(instanceId, token, phoneNumber) {
  try {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const url = `${W_API_BASE_URL}/instance/pairing-code?instanceId=${encodeURIComponent(instanceId)}&phoneNumber=${encodeURIComponent(cleanPhone)}`;
    logInfo('wapi.pairing_code_request', { instance_id: instanceId, phone: cleanPhone });

    const response = await fetch(url, { headers: getHeaders(token) });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      const errMsg = data?.message || data?.error || `HTTP ${response.status}`;
      logWarn('wapi.pairing_code_failed', { instance_id: instanceId, status: response.status, error: errMsg });
      return { success: false, error: errMsg };
    }

    // Extract pairing code from response
    const code = data?.code || data?.pairingCode || data?.pairing_code || data?.data?.code || data?.data?.pairingCode || null;

    logInfo('wapi.pairing_code_success', { instance_id: instanceId, has_code: Boolean(code) });
    return { success: true, code };
  } catch (error) {
    logError('wapi.pairing_code_exception', error, { instance_id: instanceId });
    return { success: false, error: error.message };
  }
}

/**
 * Disconnect/Logout instance
 */
export async function disconnect(instanceId, token) {
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/instance/logout?instanceId=${instanceId}`,
      {
        method: 'POST',
        headers: getHeaders(token),
      }
    );

    return response.ok;
  } catch (error) {
    console.error('W-API disconnect error:', error);
    return false;
  }
}

/**
 * Send text message
 */
export async function sendText(instanceId, token, phone, message) {
  // For groups (@g.us), keep the full JID; for individuals, clean the phone
  const isGroup = phone.includes('@g.us');
  const cleanPhone = isGroup ? phone : phone.replace(/\D/g, '');
  const at = new Date().toISOString();

  try {
    const encodedInstanceId = encodeURIComponent(instanceId || '');
    const candidates = [
      {
        url: `${W_API_BASE_URL}/message/send-text?instanceId=${encodedInstanceId}`,
        method: 'POST',
        body: { phone: cleanPhone, message },
      },
      {
        url: `${W_API_BASE_URL}/message/send-text?instanceId=${encodedInstanceId}`,
        method: 'POST',
        body: { phone: cleanPhone, text: message },
      },
      {
        url: `${W_API_BASE_URL}/message/send-text`,
        method: 'POST',
        body: { instanceId, phone: cleanPhone, message },
      },
      {
        url: `${W_API_BASE_URL}/message/sendText?instanceId=${encodedInstanceId}`,
        method: 'POST',
        body: { phone: cleanPhone, message },
      },
      {
        url: `${W_API_BASE_URL}/message/sendText`,
        method: 'POST',
        body: { instanceId, phone: cleanPhone, message },
      },
    ];

    const result = await requestWithEndpointFallback(token, candidates, 'sendText', instanceId);

    if (!result.success) {
      recordSendAttempt({
        at,
        instanceId,
        phone: cleanPhone,
        messageType: 'text',
        success: false,
        status: 0,
        error: result.error || 'Failed to send message',
        preview: JSON.stringify(result.attempts || []).slice(0, 800),
      });
      return { success: false, error: result.error || 'Failed to send message' };
    }

    const data = result.data || {};

    recordSendAttempt({
      at,
      instanceId,
      phone: cleanPhone,
      messageType: 'text',
      success: true,
      status: 200,
      preview: JSON.stringify(data).slice(0, 800),
    });

    return {
      success: true,
      messageId: data.messageId || data.id || data.key?.id || data?.data?.id || data?.result?.id,
    };
  } catch (error) {
    recordSendAttempt({
      at,
      instanceId,
      phone: cleanPhone,
      messageType: 'text',
      success: false,
      status: 0,
      error: error.message,
      preview: '',
    });

    console.error('W-API sendText error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Edit a sent text message
 */
export async function editMessage(instanceId, token, messageId, phone, newText) {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/message/edit-text?instanceId=${instanceId}`,
      {
        method: 'PUT',
        headers: getHeaders(token),
        body: JSON.stringify({
          messageId,
          phone: cleanPhone,
          message: newText,
        }),
      }
    );
    const { data } = await readJsonResponse(response);
    if (!response.ok) {
      return { success: false, error: data?.message || 'Failed to edit message' };
    }
    return { success: true };
  } catch (error) {
    console.error('W-API editMessage error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete/revoke a sent message
 */
export async function deleteMessage(instanceId, token, messageId, phone) {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  try {
    const params = new URLSearchParams({
      instanceId,
      messageId,
      phone: cleanPhone,
    });
    const response = await fetch(
      `${W_API_BASE_URL}/message/delete-message?${params.toString()}`,
      {
        method: 'DELETE',
        headers: getHeaders(token),
      }
    );
    const { data } = await readJsonResponse(response);
    if (!response.ok) {
      console.error('W-API deleteMessage failed:', response.status, data);
      return { success: false, error: data?.message || 'Failed to delete message' };
    }
    return { success: true };
  } catch (error) {
    console.error('W-API deleteMessage error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send image message
 */
export async function sendImage(instanceId, token, phone, imageUrl, caption = '') {
  const isGroup = phone.includes('@g.us');
  const cleanPhone = isGroup ? phone : phone.replace(/\D/g, '');
  
  try {
    const response = await fetchWithRetry(
      `${W_API_BASE_URL}/message/send-image?instanceId=${instanceId}`,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          phone: cleanPhone,
          image: imageUrl,
          caption: caption,
        }),
      },
      // Uploads maiores (fotos de câmera moderna 10-25MB) precisam de mais tempo
      // pois a W-API baixa a URL antes de encaminhar ao WhatsApp.
      { retries: 2, baseDelay: 1000, timeout: 120000, label: 'wapi-sendImage' }
    );

    const { data } = await readJsonResponse(response);

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error || data.raw || 'Failed to send image',
      };
    }

    return {
      success: true,
      messageId: data.messageId || data.id || data.key?.id,
    };
  } catch (error) {
    console.error('W-API sendImage error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send audio message
 */
export async function sendAudio(instanceId, token, phone, audioUrl) {
  const isGroup = phone.includes('@g.us');
  const cleanPhone = isGroup ? phone : phone.replace(/\D/g, '');
  
  try {
    const response = await fetchWithRetry(
      `${W_API_BASE_URL}/message/send-audio?instanceId=${instanceId}`,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          phone: cleanPhone,
          audio: audioUrl,
          ptt: true,
        }),
      },
      { retries: 2, baseDelay: 1000, timeout: 120000, label: 'wapi-sendAudio' }
    );

    const { data } = await readJsonResponse(response);

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error || data.raw || 'Failed to send audio',
      };
    }

    return {
      success: true,
      messageId: data.messageId || data.id || data.key?.id,
    };
  } catch (error) {
    console.error('W-API sendAudio error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send video message
 */
export async function sendVideo(instanceId, token, phone, videoUrl, caption = '') {
  const isGroup = phone.includes('@g.us');
  const cleanPhone = isGroup ? phone : phone.replace(/\D/g, '');
  
  try {
    const response = await fetchWithRetry(
      `${W_API_BASE_URL}/message/send-video?instanceId=${instanceId}`,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          phone: cleanPhone,
          video: videoUrl,
          caption: caption,
        }),
      },
      { retries: 2, baseDelay: 1000, timeout: 180000, label: 'wapi-sendVideo' }
    );

    const { data } = await readJsonResponse(response);

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error || data.raw || 'Failed to send video',
      };
    }

    return {
      success: true,
      messageId: data.messageId || data.id || data.key?.id,
    };
  } catch (error) {
    console.error('W-API sendVideo error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send document message
 */
export async function sendDocument(instanceId, token, phone, documentUrl, filename = 'document') {
  const isGroup = phone.includes('@g.us');
  const cleanPhone = isGroup ? phone : phone.replace(/\D/g, '');
  const at = new Date().toISOString();

  const sanitizeFilenameBase = (name) => {
    const raw = String(name || 'document');
    // Remove any path fragments just in case
    const base = raw.split('/').pop().split('\\').pop();
    // Replace problematic chars; keep letters, numbers, dot, dash, underscore
    const cleaned = base
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[_\.]+|[_\.]+$/g, '');
    // Prevent empty / very long names
    return (cleaned || 'document').slice(0, 80);
  };

  // Ensure filename has an extension (W-API requires it)
  const ensureExtension = (fname, url) => {
    const safeBase = sanitizeFilenameBase(fname);

    // If filename already has extension, keep it (but sanitize base)
    const hasExt = /\.[a-z0-9]{2,10}$/i.test(String(fname || ''));
    if (hasExt) {
      const ext = String(fname).match(/\.([a-z0-9]{2,10})$/i)?.[1] || 'pdf';
      return `${safeBase.replace(/\.[a-z0-9]{2,10}$/i, '')}.${ext}`;
    }

    // Try to extract extension from URL
    try {
      const urlPath = new URL(url).pathname;
      const match = urlPath.match(/\.([a-z0-9]{2,10})$/i);
      if (match) {
        const ext = match[1];
        return `${safeBase}.${ext}`;
      }
    } catch (e) {
      // URL parsing failed, fallback below
    }

    // Last resort: use mimetype from URL check or default to .pdf
    return `${safeBase}.pdf`;
  };

  const filenameWithExt = ensureExtension(filename, documentUrl);

  // Some W-API installations validate the *URL* extension (not just the filename).
  // If we have a URL without an extension (common when original uploads had no ext),
  // serve it through our public download route that includes the desired filename.
  let effectiveDocumentUrl = documentUrl;
  try {
    const u = new URL(documentUrl);
    const wantedExt = (String(filenameWithExt).match(/\.([a-z0-9]{2,10})$/i)?.[1] || '').toLowerCase();
    const currentExt = (String(u.pathname).match(/\.([a-z0-9]{2,10})$/i)?.[1] || '').toLowerCase();
    const pathHasExt = Boolean(currentExt);

    // We re-serve our own uploads with a friendlier filename when:
    // - the URL has no extension, OR
    // - the stored file ends with .bin/.tmp (common when browser sends octet-stream), OR
    // - the extension differs from the intended filename extension.
    const shouldReseaveWithExt =
      !pathHasExt ||
      currentExt === 'bin' ||
      currentExt === 'tmp' ||
      (wantedExt && currentExt && currentExt !== wantedExt);

    if (shouldReseaveWithExt && u.pathname.startsWith('/uploads/')) {
      const stored = u.pathname.split('/').pop();
      if (stored) {
        effectiveDocumentUrl = `${u.origin}/api/uploads/public/${encodeURIComponent(stored)}/${encodeURIComponent(filenameWithExt)}`;
      }
    }
  } catch {
    // keep original
  }

  logInfo('wapi.send_document_started', {
    instance_id: instanceId,
    phone_preview: cleanPhone.substring(0, 15),
    document_url_preview: documentUrl ? documentUrl.substring(0, 100) : null,
    effective_document_url_preview: effectiveDocumentUrl ? effectiveDocumentUrl.substring(0, 100) : null,
    filename: filenameWithExt,
  });

  // Pre-check: verify URL is accessible before sending to W-API
  const urlCheck = await verifyMediaUrl(effectiveDocumentUrl, 10000);
  if (!urlCheck.accessible) {
    const errorMsg = `URL do arquivo não acessível: ${urlCheck.error}`;
    logError('wapi.send_document_url_check_failed', new Error(errorMsg), {
      instance_id: instanceId,
      document_url_preview: effectiveDocumentUrl ? effectiveDocumentUrl.substring(0, 200) : null,
      url_check_result: urlCheck,
    });

    recordSendAttempt({
      at,
      instanceId,
      phone: cleanPhone,
      messageType: 'document',
      success: false,
      status: 0,
      error: errorMsg,
      preview: JSON.stringify(urlCheck).slice(0, 800),
    });

    return { success: false, error: errorMsg };
  }

  logInfo('wapi.send_document_url_verified', {
    instance_id: instanceId,
    content_type: urlCheck.contentType,
    content_length: urlCheck.contentLength,
  });
  
  // Extract extension for W-API (required field)
  const extensionMatch = filenameWithExt.match(/\.([a-z0-9]{2,10})$/i);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'pdf';

  try {
    const response = await fetchWithRetry(
      `${W_API_BASE_URL}/message/send-document?instanceId=${instanceId}`,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          phone: cleanPhone,
          document: effectiveDocumentUrl,
          filename: filenameWithExt,
          fileName: filenameWithExt,
          extension: extension,
        }),
      },
      // Documentos podem ter até 200MB (PDFs escaneados). Damos 3min para
      // a W-API baixar do nosso servidor e encaminhar ao WhatsApp.
      { retries: 2, baseDelay: 1000, timeout: 180000, label: 'wapi-sendDocument' }
    );

    const { data, text } = await readJsonResponse(response);

    logInfo('wapi.send_document_response', {
      instance_id: instanceId,
      status_code: response.status,
      ok: response.ok,
      response_preview: text.substring(0, 800),
    });

    const providerRejected =
      data?.success === false ||
      data?.status === false ||
      String(data?.status || '').toLowerCase() === 'error' ||
      String(data?.data?.status || '').toLowerCase() === 'error';

    if (!response.ok || providerRejected) {
      const errorMsg = data?.message || data?.error || data?.data?.message || data?.raw || 'Failed to send document';
      recordSendAttempt({
        at,
        instanceId,
        phone: cleanPhone,
        messageType: 'document',
        success: false,
        status: response.status,
        error: errorMsg,
        preview: text.slice(0, 800),
      });

      logError('wapi.send_document_failed', new Error(errorMsg), {
        instance_id: instanceId,
        status_code: response.status,
      });

      return { success: false, error: errorMsg };
    }

    recordSendAttempt({
      at,
      instanceId,
      phone: cleanPhone,
      messageType: 'document',
      success: true,
      status: response.status,
      preview: text.slice(0, 800),
    });

    const messageId = data.messageId || data.id || data.key?.id || data?.data?.id || data?.data?.messageId || data?.result?.id;

    logInfo('wapi.send_document_success', {
      instance_id: instanceId,
      message_id: messageId || null,
    });

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    recordSendAttempt({
      at,
      instanceId,
      phone: cleanPhone,
      messageType: 'document',
      success: false,
      status: 0,
      error: error.message,
      preview: '',
    });

    logError('wapi.send_document_exception', error, {
      instance_id: instanceId,
    });

    return { success: false, error: error.message };
  }
}

/**
 * Check if number is on WhatsApp
 */
export async function checkNumber(instanceId, token, phone) {
  try {
    const cleanPhone = phone.replace(/\D/g, '');
    // W-API uses GET /contacts/phone-exists with phoneNumber as query param
    const response = await fetch(
      `${W_API_BASE_URL}/contacts/phone-exists?instanceId=${encodeURIComponent(instanceId)}&phoneNumber=${cleanPhone}`,
      {
        method: 'GET',
        headers: getHeaders(token),
      }
    );

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.exists === true || data.isWhatsApp === true || data.result === true;
  } catch (error) {
    console.error('W-API checkNumber error:', error);
    return false;
  }
}

/**
 * Get group info/metadata from W-API
 * Returns group name, participants, etc.
 */
export async function getGroupInfo(instanceId, token, groupJid) {
  const encodedInstanceId = encodeURIComponent(instanceId || '');
  const groupIdWithoutSuffix = groupJid?.replace('@g.us', '') || '';
  const fullGroupJid = groupJid?.includes('@g.us') ? groupJid : `${groupJid}@g.us`;

  try {
    // Try the correct W-API endpoint first: /group/group-metadata
    const endpoints = [
      // Primary endpoint (from W-API docs)
      { method: 'GET', url: `${W_API_BASE_URL}/group/group-metadata?instanceId=${encodedInstanceId}&groupId=${encodeURIComponent(fullGroupJid)}` },
      { method: 'GET', url: `${W_API_BASE_URL}/group/group-metadata?instanceId=${encodedInstanceId}&groupId=${encodeURIComponent(groupIdWithoutSuffix)}` },
      // Fallback endpoints
      { method: 'GET', url: `${W_API_BASE_URL}/group/metadata?instanceId=${encodedInstanceId}&groupId=${encodeURIComponent(fullGroupJid)}` },
      { method: 'GET', url: `${W_API_BASE_URL}/group/metadata?instanceId=${encodedInstanceId}&groupId=${encodeURIComponent(groupIdWithoutSuffix)}` },
      { method: 'GET', url: `${W_API_BASE_URL}/group/get-group?instanceId=${encodedInstanceId}&groupId=${encodeURIComponent(fullGroupJid)}` },
      { method: 'GET', url: `${W_API_BASE_URL}/group/info?instanceId=${encodedInstanceId}&groupId=${encodeURIComponent(groupIdWithoutSuffix)}` },
    ];

    for (const endpoint of endpoints) {
      try {
        console.log('[W-API] Trying group info:', endpoint.url);
        
        const response = await fetch(endpoint.url, {
          method: endpoint.method,
          headers: getHeaders(token),
        });

        console.log('[W-API] Response status:', response.status);
        if (!response.ok) continue;

        const responseText = await response.text();
        let data;
        try {
          data = JSON.parse(responseText);
        } catch {
          console.log('[W-API] Non-JSON response:', responseText.substring(0, 100));
          continue;
        }
        
        console.log('[W-API] Group metadata response:', JSON.stringify(data).substring(0, 500));
        
        // Extract group name from various possible response formats
        const groupName = data?.subject || data?.name || data?.groupName || data?.title ||
                         data?.pushName || data?.displayName ||
                         data?.data?.subject || data?.data?.name || data?.data?.groupName ||
                         data?.result?.subject || data?.result?.name || data?.result?.groupName ||
                         data?.response?.subject || data?.response?.name ||
                         data?.group?.subject || data?.group?.name || null;

        if (groupName) {
          console.log('[W-API] Got group name for', groupJid, ':', groupName);
          return {
            success: true,
            name: groupName,
            subject: groupName,
            participants: data?.participants || data?.data?.participants || data?.result?.participants || [],
          };
        }
      } catch (e) {
        console.log('[W-API] Endpoint error:', e.message);
      }
    }

    console.log('[W-API] Could not fetch group info for:', groupJid);
    return { success: false, error: 'Could not fetch group info' };
  } catch (error) {
    console.error('W-API getGroupInfo error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all groups from W-API
 * Returns an array of group objects with jid and name
 */
export async function getGroups(instanceId, token) {
  const encodedInstanceId = encodeURIComponent(instanceId || '');

  try {
    // Try different endpoints to get groups (primary endpoint from W-API docs)
    const endpoints = [
      `${W_API_BASE_URL}/group/fetch-all-groups?instanceId=${encodedInstanceId}`,
      `${W_API_BASE_URL}/group/list-groups?instanceId=${encodedInstanceId}`,
      `${W_API_BASE_URL}/group/get-groups?instanceId=${encodedInstanceId}`,
      `${W_API_BASE_URL}/group/list?instanceId=${encodedInstanceId}`,
      `${W_API_BASE_URL}/group/all?instanceId=${encodedInstanceId}`,
    ];

    for (const url of endpoints) {
      try {
        console.log('[W-API] Trying getGroups endpoint:', url);
        const response = await fetch(url, {
          method: 'GET',
          headers: getHeaders(token),
        });

        console.log('[W-API] getGroups response status:', response.status);
        if (!response.ok) continue;

        const responseText = await response.text();
        console.log('[W-API] getGroups raw response:', responseText.substring(0, 500));
        
        let data;
        try {
          data = JSON.parse(responseText);
        } catch {
          continue;
        }

        // Parse response - could be array or wrapped
        const groupsArray = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.result)
              ? data.result
              : Array.isArray(data?.groups)
                ? data.groups
                : Array.isArray(data?.response)
                  ? data.response
                  : [];

        console.log('[W-API] Parsed groups array length:', groupsArray.length);
        if (groupsArray.length > 0) {
          console.log('[W-API] Sample group:', JSON.stringify(groupsArray[0]).substring(0, 300));
        }

        if (groupsArray.length > 0) {
          console.log(`[W-API] Found ${groupsArray.length} groups via ${url}`);
          
          // Normalize group data - try all possible name fields
          const groups = groupsArray.map(g => ({
            jid: g.jid || g.id || g.groupId || g.remoteJid || '',
            name: g.subject || g.name || g.groupName || g.title || g.pushName || g.displayName || '',
            participants: g.participants?.length || g.size || 0,
          })).filter(g => g.jid && g.jid.includes('@g.us'));

          console.log(`[W-API] Normalized ${groups.length} groups with JIDs`);
          if (groups.length > 0) {
            console.log('[W-API] Sample normalized group:', JSON.stringify(groups[0]));
          }

          return { success: true, groups };
        }
      } catch (e) {
        console.log('[W-API] getGroups endpoint error:', e.message);
        // Continue to next endpoint
      }
    }

    // Fallback: try to get groups from chat list
    const chatsResponse = await fetch(
      `${W_API_BASE_URL}/chat/get-chats?instanceId=${encodedInstanceId}`,
      {
        method: 'GET',
        headers: getHeaders(token),
      }
    );

    if (chatsResponse.ok) {
      const chatsData = await chatsResponse.json();
      const chatsArray = Array.isArray(chatsData)
        ? chatsData
        : Array.isArray(chatsData?.data)
          ? chatsData.data
          : Array.isArray(chatsData?.result)
            ? chatsData.result
            : [];

      const groups = chatsArray
        .filter(c => {
          const jid = c.jid || c.id || c.remoteJid || '';
          return jid.includes('@g.us');
        })
        .map(g => ({
          jid: g.jid || g.id || g.remoteJid || '',
          name: g.name || g.subject || g.groupName || g.title || '',
          participants: g.participants?.length || 0,
        }));

      if (groups.length > 0) {
        console.log(`[W-API] Found ${groups.length} groups from chat list`);
        return { success: true, groups };
      }
    }

    return { success: false, error: 'Could not fetch groups', groups: [] };
  } catch (error) {
    console.error('W-API getGroups error:', error);
    return { success: false, error: error.message, groups: [] };
  }
}

/**
 * Internal helper: try multiple endpoint/method combinations and return first successful payload
 */
async function requestWithEndpointFallback(token, candidates, label, instanceId) {
  const attempts = [];

  for (const candidate of candidates) {
    const { url, method = 'GET', body } = candidate;

    try {
      const response = await fetch(url, {
        method,
        headers: getHeaders(token),
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });

      const text = await response.text().catch(() => '');
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      attempts.push({ url, method, status: response.status });

      if (response.ok) {
        recordEndpointDiscovery({ instanceId, label, attempts, resolvedUrl: url, success: true });
        return { success: true, data, attempts };
      }

      // Token/auth error: fail fast
      if (response.status === 401 || response.status === 403) {
        recordEndpointDiscovery({ instanceId, label, attempts, resolvedUrl: null, success: false });
        return {
          success: false,
          error: data?.message || data?.error || `Falha de autenticação (${response.status})`,
          attempts,
        };
      }

      // For 404/405 keep trying next candidates; same for other non-ok while discovering
    } catch (error) {
      attempts.push({ url, method, status: 0, error: error.message });
    }
  }

  recordEndpointDiscovery({ instanceId, label, attempts, resolvedUrl: null, success: false });
  return {
    success: false,
    error: `Nenhum endpoint válido para ${label}`,
    attempts,
  };
}

function pickArray(data, keys = []) {
  const containers = [
    data,
    data?.data,
    data?.result,
    data?.payload,
    data?.response,
    data?.data?.data,
    data?.result?.data,
    data?.payload?.data,
    data?.response?.data,
  ].filter(Boolean);

  for (const container of containers) {
    if (Array.isArray(container)) return container;
    if (typeof container !== 'object') continue;

    for (const key of keys) {
      if (Array.isArray(container?.[key])) return container[key];
    }
  }

  return [];
}

function normalizePhone(value) {
  if (value == null) return '';
  return String(value).replace(/\D/g, '');
}

function extractJidAndPhone(entity = {}) {
  const jidCandidates = [
    entity?.jid,
    entity?.id,
    entity?.remoteJid,
    entity?.chatId,
    entity?.from,
    entity?.to,
    entity?.participant,
    entity?.key?.remoteJid,
    entity?.key?.participant,
    entity?.contact?.jid,
    entity?.contact?.id,
    entity?.chat?.id,
    entity?.chat?.jid,
    entity?.chat?.remoteJid,
  ];

  const plainPhoneCandidates = [
    entity?.phone,
    entity?.number,
    entity?.user,
    entity?.contact?.phone,
    entity?.contact?.number,
    entity?.chat?.phone,
    entity?.chat?.number,
  ];

  let jid = '';
  for (const candidate of jidCandidates) {
    if (typeof candidate !== 'string') continue;
    if (candidate.includes('@')) {
      jid = candidate;
      break;
    }
    const digits = normalizePhone(candidate);
    if (digits) {
      jid = `${digits}@s.whatsapp.net`;
      break;
    }
  }

  let phone = normalizePhone(jid);
  if (!phone) {
    for (const candidate of plainPhoneCandidates) {
      phone = normalizePhone(candidate);
      if (phone) break;
    }
  }

  if (!jid && phone) {
    jid = `${phone}@s.whatsapp.net`;
  }

  return { jid, phone };
}

/**
 * Get all chats from W-API (includes contacts with chat history)
 * Returns an array of chat objects with phone and name
 */
export async function getChats(instanceId, token) {
  const encodedInstanceId = encodeURIComponent(instanceId || '');

  try {
    const candidates = [
      // Possível padrão novo (plural)
      { url: `${W_API_BASE_URL}/chats/fetch-chats?instanceId=${encodedInstanceId}`, method: 'GET' },
      { url: `${W_API_BASE_URL}/chats/fetch-chats?instanceId=${encodedInstanceId}`, method: 'POST', body: {} },

      // Legados
      { url: `${W_API_BASE_URL}/chat/get-chats?instanceId=${encodedInstanceId}`, method: 'GET' },
      { url: `${W_API_BASE_URL}/chat/get-chats?instanceId=${encodedInstanceId}`, method: 'POST', body: {} },
      { url: `${W_API_BASE_URL}/chat/get-chats`, method: 'POST', body: { instanceId } },
      { url: `${W_API_BASE_URL}/chat/chats?instanceId=${encodedInstanceId}`, method: 'GET' },
      { url: `${W_API_BASE_URL}/chat/chats`, method: 'POST', body: { instanceId } },
    ];

    const result = await requestWithEndpointFallback(token, candidates, 'getChats', instanceId);
    if (!result.success) {
      return { success: false, error: result.error, chats: [] };
    }

    const chatsArray = pickArray(result.data, ['data', 'result', 'chats', 'contacts', 'items']);
    console.log(`[W-API] Found ${chatsArray.length} chats`);

    const contactsByPhone = new Map();

    for (const chat of chatsArray) {
      const { jid, phone } = extractJidAndPhone(chat);
      if (!jid || !phone || jid.includes('@g.us')) continue;

      const name =
        chat.name ||
        chat.pushName ||
        chat.notify ||
        chat.verifiedName ||
        chat.formattedName ||
        chat.displayName ||
        chat.contact?.name ||
        chat.contact?.pushName ||
        chat.chat?.name ||
        '';

      const profilePicture =
        chat.profilePicture ||
        chat.profilePictureUrl ||
        chat.imgUrl ||
        chat.picture ||
        chat.contact?.profilePictureUrl ||
        chat.chat?.profilePictureUrl ||
        null;

      contactsByPhone.set(phone, { phone, name: name || phone, jid, profilePicture });
    }

    const contacts = Array.from(contactsByPhone.values());
    console.log(`[W-API] Parsed ${contacts.length} individual contacts from chats`);
    return { success: true, contacts, total: contacts.length };
  } catch (error) {
    console.error('[W-API] getChats error:', error);
    return { success: false, error: error.message, chats: [] };
  }
}

/**
 * Fetch contacts from W-API endpoint
 * Returns actual phone contacts (not just chats)
 */
export async function fetchContacts(instanceId, token) {
  const encodedInstanceId = encodeURIComponent(instanceId || '');

  try {
    const perPage = 200;
    const maxPages = 50;
    const allRawContacts = [];

    for (let page = 1; page <= maxPages; page++) {
      const candidates = [
        // Endpoint confirmado pelo usuário
        { url: `${W_API_BASE_URL}/contacts/fetch-contacts?instanceId=${encodedInstanceId}&perPage=${perPage}&page=${page}`, method: 'GET' },
        { url: `${W_API_BASE_URL}/contacts/fetch-contacts?instanceId=${encodedInstanceId}&perPage=${perPage}&page=${page}`, method: 'POST', body: {} },

        // Fallbacks de compatibilidade
        { url: `${W_API_BASE_URL}/contact/get-contacts?instanceId=${encodedInstanceId}`, method: 'GET' },
        { url: `${W_API_BASE_URL}/contact/get-contacts?instanceId=${encodedInstanceId}`, method: 'POST', body: {} },
        { url: `${W_API_BASE_URL}/contact/get-contacts`, method: 'POST', body: { instanceId } },
        { url: `${W_API_BASE_URL}/contacts?instanceId=${encodedInstanceId}`, method: 'GET' },
        { url: `${W_API_BASE_URL}/contacts`, method: 'POST', body: { instanceId } },
      ];

      const result = await requestWithEndpointFallback(token, candidates, `fetchContacts.page_${page}`, instanceId);

      if (!result.success) {
        if (page === 1) {
          return { success: false, error: result.error, contacts: [] };
        }
        break;
      }

      const rawContacts = pickArray(result.data, ['data', 'result', 'contacts', 'items', 'chats']);

      if (!rawContacts.length) break;

      allRawContacts.push(...rawContacts);

      const totalPages = Number(
        result.data?.totalPages ||
        result.data?.pagination?.totalPages ||
        result.data?.meta?.totalPages ||
        result.data?.data?.totalPages ||
        result.data?.result?.totalPages ||
        0
      );

      if ((totalPages && page >= totalPages) || rawContacts.length < perPage) {
        break;
      }
    }

    const contactsByPhone = new Map();

    for (const c of allRawContacts) {
      const { jid, phone } = extractJidAndPhone(c);
      if (!jid || !phone || jid.includes('@g.us') || jid.includes('@broadcast')) continue;

      const name =
        c.name ||
        c.pushName ||
        c.notify ||
        c.verifiedName ||
        c.formattedName ||
        c.displayName ||
        c.contact?.name ||
        c.chat?.name ||
        '';

      const profilePicture =
        c.profilePicture ||
        c.profilePictureUrl ||
        c.imgUrl ||
        c.picture ||
        c.contact?.profilePictureUrl ||
        c.chat?.profilePictureUrl ||
        null;

      contactsByPhone.set(phone, { phone, name: name || phone, jid, profilePicture });
    }

    const contacts = Array.from(contactsByPhone.values());
    console.log(`[W-API] Parsed ${contacts.length} contacts from fetchContacts`);

    return { success: true, contacts, total: contacts.length };
  } catch (error) {
    console.error('[W-API] fetchContacts error:', error);
    return { success: false, error: error.message, contacts: [] };
  }
}

/**
 * Fetch a single chat's messages (for conversation sync)
 */
export async function getChatMessages(instanceId, token, chatId) {
  const encodedInstanceId = encodeURIComponent(instanceId || '');
  const encodedChatId = encodeURIComponent(chatId || '');

  try {
    const candidates = [
      // Possível padrão novo (plural)
      { url: `${W_API_BASE_URL}/chats/fetch-chat-messages?instanceId=${encodedInstanceId}&chatId=${encodedChatId}`, method: 'GET' },
      { url: `${W_API_BASE_URL}/chats/fetch-chat-messages?instanceId=${encodedInstanceId}`, method: 'POST', body: { chatId } },

      // Legados
      { url: `${W_API_BASE_URL}/chat/get-chat?instanceId=${encodedInstanceId}&chatId=${encodedChatId}`, method: 'GET' },
      { url: `${W_API_BASE_URL}/chat/get-chat?instanceId=${encodedInstanceId}`, method: 'POST', body: { chatId } },
      { url: `${W_API_BASE_URL}/chat/get-chat`, method: 'POST', body: { instanceId, chatId } },
      { url: `${W_API_BASE_URL}/chat/messages?instanceId=${encodedInstanceId}&chatId=${encodedChatId}`, method: 'GET' },
      { url: `${W_API_BASE_URL}/chat/messages`, method: 'POST', body: { instanceId, chatId } },
    ];

    const result = await requestWithEndpointFallback(token, candidates, 'getChatMessages', instanceId);
    if (!result.success) {
      return { success: false, error: result.error, messages: [] };
    }

    const messages = pickArray(result.data, ['messages', 'data', 'result', 'items']);
    return { success: true, messages };
  } catch (error) {
    console.error(`[W-API] getChatMessages error for ${chatId}:`, error);
    return { success: false, error: error.message, messages: [] };
  }
}

// ==================== Advanced Message Types ====================

/**
 * Send sticker message
 */
export async function sendSticker(instanceId, token, phone, stickerUrl) {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/message/send-sticker?instanceId=${instanceId}`,
      { method: 'POST', headers: getHeaders(token), body: JSON.stringify({ phone: cleanPhone, sticker: stickerUrl }) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: data?.message || data?.error || 'Failed to send sticker' };
    return { success: true, messageId: data.messageId || data.id || data.key?.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send GIF message
 */
export async function sendGif(instanceId, token, phone, gifUrl, caption = '') {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/message/send-gif?instanceId=${instanceId}`,
      { method: 'POST', headers: getHeaders(token), body: JSON.stringify({ phone: cleanPhone, gif: gifUrl, caption }) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: data?.message || data?.error || 'Failed to send GIF' };
    return { success: true, messageId: data.messageId || data.id || data.key?.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send PTV (video note / circle video) message
 */
export async function sendPtv(instanceId, token, phone, videoUrl) {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/message/send-ptv?instanceId=${instanceId}`,
      { method: 'POST', headers: getHeaders(token), body: JSON.stringify({ phone: cleanPhone, ptv: videoUrl }) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: data?.message || data?.error || 'Failed to send PTV' };
    return { success: true, messageId: data.messageId || data.id || data.key?.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send location message
 */
export async function sendLocation(instanceId, token, phone, latitude, longitude, name = '', address = '') {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/message/send-location?instanceId=${instanceId}`,
      { method: 'POST', headers: getHeaders(token), body: JSON.stringify({ phone: cleanPhone, lat: latitude, lng: longitude, name, address }) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: data?.message || data?.error || 'Failed to send location' };
    return { success: true, messageId: data.messageId || data.id || data.key?.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send contact card (vCard)
 * W-API: tenta múltiplos formatos de payload conhecidos
 */
export async function sendContact(instanceId, token, phone, contactName, contactPhone) {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  const cleanContact = String(contactPhone).replace(/\D/g, '');
  const encodedInstanceId = encodeURIComponent(instanceId);

  const candidates = [
    // Formato 1: contact aninhado (mais comum no W-API novo)
    {
      url: `${W_API_BASE_URL}/message/send-contact?instanceId=${encodedInstanceId}`,
      body: { phone: cleanPhone, contact: { fullName: contactName, phoneNumber: cleanContact } },
    },
    // Formato 2: contacts array com displayName/vcard
    {
      url: `${W_API_BASE_URL}/message/send-contact?instanceId=${encodedInstanceId}`,
      body: {
        phone: cleanPhone,
        contacts: [{
          displayName: contactName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;${contactName};;;\nFN:${contactName}\nTEL;type=CELL;type=VOICE;waid=${cleanContact}:+${cleanContact}\nEND:VCARD`,
        }],
      },
    },
    // Formato 3: campos planos
    {
      url: `${W_API_BASE_URL}/message/send-contact?instanceId=${encodedInstanceId}`,
      body: { phone: cleanPhone, contactName, contactPhone: cleanContact },
    },
    // Formato 4: fullName/phoneNumber planos
    {
      url: `${W_API_BASE_URL}/message/send-contact?instanceId=${encodedInstanceId}`,
      body: { phone: cleanPhone, fullName: contactName, phoneNumber: cleanContact },
    },
  ];

  let lastError = null;
  for (const cand of candidates) {
    try {
      const response = await fetch(cand.url, {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify(cand.body),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && !data?.error) {
        console.log('[W-API sendContact] success with payload keys:', Object.keys(cand.body));
        return { success: true, messageId: data.messageId || data.id || data.key?.id };
      }
      lastError = data?.message || data?.error || `HTTP ${response.status}`;
      console.warn('[W-API sendContact] format failed:', Object.keys(cand.body), lastError);
    } catch (error) {
      lastError = error.message;
    }
  }
  return { success: false, error: lastError || 'Failed to send contact (all formats)' };
}

/**
 * Send poll message
 */
export async function sendPoll(instanceId, token, phone, question, options) {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/message/send-poll?instanceId=${instanceId}`,
      { method: 'POST', headers: getHeaders(token), body: JSON.stringify({ phone: cleanPhone, poll: { question, options } }) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: data?.message || data?.error || 'Failed to send poll' };
    return { success: true, messageId: data.messageId || data.id || data.key?.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send button message
 */
export async function sendButtons(instanceId, token, phone, title, message, footer, buttons) {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/message/send-button?instanceId=${instanceId}`,
      { method: 'POST', headers: getHeaders(token), body: JSON.stringify({ phone: cleanPhone, title, message, footer, buttons }) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: data?.message || data?.error || 'Failed to send buttons' };
    return { success: true, messageId: data.messageId || data.id || data.key?.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send list message (interactive list)
 */
export async function sendList(instanceId, token, phone, title, description, buttonText, sections, footer = '') {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/message/send-list?instanceId=${instanceId}`,
      { method: 'POST', headers: getHeaders(token), body: JSON.stringify({ phone: cleanPhone, title, description, buttonText, sections, footer }) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: data?.message || data?.error || 'Failed to send list' };
    return { success: true, messageId: data.messageId || data.id || data.key?.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send link preview message
 */
export async function sendLink(instanceId, token, phone, url, caption = '') {
  const cleanPhone = phone.includes('@g.us') ? phone : phone.replace(/\D/g, '');
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/message/send-link?instanceId=${instanceId}`,
      { method: 'POST', headers: getHeaders(token), body: JSON.stringify({ phone: cleanPhone, url, caption }) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: data?.message || data?.error || 'Failed to send link' };
    return { success: true, messageId: data.messageId || data.id || data.key?.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ==================== Contact Profile & Validation ====================

/**
 * Get profile picture for a contact
 * GET /contact/get-profile-picture?instanceId=XXX&phoneNumber=YYY
 */
export async function getProfilePicture(instanceId, token, phone) {
  const cleanPhone = phone.replace(/\D/g, '');
  try {
    const response = await fetch(
      `${W_API_BASE_URL}/contact/get-profile-picture?instanceId=${encodeURIComponent(instanceId)}&phoneNumber=${cleanPhone}`,
      { method: 'GET', headers: getHeaders(token), signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    const data = await response.json().catch(() => ({}));
    const url = data?.profilePictureUrl || data?.profilePicture || data?.url || data?.imgUrl || data?.picture || data?.data?.profilePictureUrl || null;
    return { success: !!url, url };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Bulk check if phone numbers are on WhatsApp
 * Uses /contact/check-phone endpoint in batch
 */
export async function checkNumbersBulk(instanceId, token, phones) {
  const results = [];
  const BATCH_SIZE = 20;

  for (let i = 0; i < phones.length; i += BATCH_SIZE) {
    const batch = phones.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (phone) => {
      const cleanPhone = phone.replace(/\D/g, '');
      try {
        const response = await fetch(
          `${W_API_BASE_URL}/contacts/phone-exists?instanceId=${encodeURIComponent(instanceId)}&phoneNumber=${cleanPhone}`,
          { method: 'GET', headers: getHeaders(token), signal: AbortSignal.timeout(10000) }
        );
        if (!response.ok) return { phone: cleanPhone, exists: false, error: `HTTP ${response.status}` };
        const data = await response.json().catch(() => ({}));
        const exists = data.exists === true || data.isWhatsApp === true || data.result === true;
        return { phone: cleanPhone, exists };
      } catch (error) {
        return { phone: cleanPhone, exists: false, error: error.message };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return { success: true, results, total: results.length, valid: results.filter(r => r.exists).length };
}

/**
 * Generic message sender that routes to the correct method based on type
 */
export async function sendMessage(instanceId, token, phone, content, messageType, mediaUrl) {
  switch (messageType) {
    case 'text':
      return sendText(instanceId, token, phone, content);
    case 'image':
      return sendImage(instanceId, token, phone, mediaUrl, content);
    case 'audio':
      return sendAudio(instanceId, token, phone, mediaUrl);
    case 'video':
      return sendVideo(instanceId, token, phone, mediaUrl, content);
    case 'document':
      return sendDocument(instanceId, token, phone, mediaUrl, content || 'document');
    case 'sticker':
      return sendSticker(instanceId, token, phone, mediaUrl);
    case 'gif':
      return sendGif(instanceId, token, phone, mediaUrl, content);
    case 'ptv':
      return sendPtv(instanceId, token, phone, mediaUrl);
    case 'location':
      // content should be JSON: { latitude, longitude, name, address }
      try {
        const loc = typeof content === 'string' ? JSON.parse(content) : content;
        return sendLocation(instanceId, token, phone, loc.latitude, loc.longitude, loc.name, loc.address);
      } catch {
        return { success: false, error: 'Invalid location data' };
      }
    case 'contact':
      try {
        const ct = typeof content === 'string' ? JSON.parse(content) : content;
        return sendContact(instanceId, token, phone, ct.contactName, ct.contactPhone);
      } catch {
        return { success: false, error: 'Invalid contact data' };
      }
    case 'link':
      return sendLink(instanceId, token, phone, mediaUrl, content);
    default:
      return sendText(instanceId, token, phone, content);
  }
}

/**
 * Download media from W-API using messageId
 * This is needed because WhatsApp CDN URLs (mmg.whatsapp.net) require authentication.
 *
 * NOTE: W-API responses vary by version; this function tries a couple of shapes.
 */
export async function downloadMedia(instanceId, token, messageId) {
  const encodedInstanceId = encodeURIComponent(instanceId || '');
  const encodedMessageId = encodeURIComponent(messageId || '');

  const attempts = [
    {
      label: 'GET messageId',
      url: `${W_API_BASE_URL}/message/download-media?instanceId=${encodedInstanceId}&messageId=${encodedMessageId}`,
      method: 'GET',
    },
    {
      label: 'GET id',
      url: `${W_API_BASE_URL}/message/download-media?instanceId=${encodedInstanceId}&id=${encodedMessageId}`,
      method: 'GET',
    },
    {
      label: 'POST {messageId}',
      url: `${W_API_BASE_URL}/message/download-media?instanceId=${encodedInstanceId}`,
      method: 'POST',
      body: { messageId },
    },
  ];

  const normalizeJson = (data) => {
    if (!data || typeof data !== 'object') return null;

    // Some W-API versions wrap the payload in { data: {...} } or { result: {...} }
    const roots = [data, data?.data, data?.result].filter((v) => v && typeof v === 'object');

    const visit = (obj, depth, cb) => {
      if (!obj || typeof obj !== 'object' || depth > 4) return;
      cb(obj);
      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') visit(v, depth + 1, cb);
      }
    };

    const pickFirstStringDeep = (keys) => {
      for (const r of roots) {
        let found = null;
        visit(r, 0, (o) => {
          if (found) return;
          for (const k of keys) {
            const v = o?.[k];
            if (typeof v === 'string' && v.trim()) {
              found = v.trim();
              return;
            }
          }
        });
        if (found) return found;
      }
      return null;
    };

    const mimetype =
      pickFirstStringDeep(['mimetype', 'mimeType', 'type', 'contentType']) ||
      null;

    // base64 can be nested and/or come without data: prefix
    const base64Raw = pickFirstStringDeep([
      'base64',
      'b64',
      'fileBase64',
      'mediaBase64',
      'data',
      'file',
      'buffer',
      'content',
    ]);

    if (base64Raw) {
      const b = base64Raw.trim();
      const b64 = b.startsWith('data:')
        ? b
        : `data:${mimetype || 'application/octet-stream'};base64,${b}`;
      return { success: true, base64: b64, mimetype: mimetype || undefined };
    }

    const url = pickFirstStringDeep(['url', 'mediaUrl', 'fileUrl', 'downloadUrl', 'link']);
    if (url) {
      return { success: true, url: url.trim(), mimetype: mimetype || undefined };
    }

    return null;
  };

  for (const a of attempts) {
    try {
      console.log('[W-API] downloadMedia attempt:', a.label, 'messageId:', messageId);

      const response = await fetch(a.url, {
        method: a.method,
        headers: {
          ...getHeaders(token),
          ...(a.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        body: a.method === 'POST' ? JSON.stringify(a.body || {}) : undefined,
      });

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[W-API] Download media failed:', a.label, response.status, errorText.slice(0, 300));
        continue;
      }

      // JSON response (may contain base64/url)
      if (contentType.includes('application/json')) {
        const data = await response.json().catch(() => null);
        const normalized = normalizeJson(data);
        if (normalized) return normalized;
        return { success: false, error: 'No media data in JSON response' };
      }

      // Binary response
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const mimetype = contentType.split(';')[0].trim() || 'application/octet-stream';

      console.log('[W-API] Downloaded media successfully, size:', buffer.byteLength, 'type:', mimetype);

      return {
        success: true,
        base64: `data:${mimetype};base64,${base64}`,
        mimetype,
      };
    } catch (error) {
      console.error('[W-API] downloadMedia attempt error:', a.label, error?.message || error);
      // try next
    }
  }

  return { success: false, error: 'All downloadMedia attempts failed' };
}

/**
 * Send typing/composing presence indicator via W-API
 */
export async function sendPresenceComposing(instanceId, token, phone) {
  try {
    const isGroup = phone.includes('@g.us');
    const cleanPhone = isGroup ? phone : phone.replace(/\D/g, '');

    await fetch(`${W_API_BASE_URL}/${instanceId}/chat/send-presence`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: cleanPhone,
        presence: 'composing',
        isGroup,
      }),
    });
  } catch (error) {
    // Non-critical, just log
    console.error('[W-API] sendPresenceComposing error:', error?.message);
  }
}
