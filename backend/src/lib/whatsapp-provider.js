 /**
  * Upload media to Meta Cloud API
  */
 async function uploadMetaMedia(connection, filePath, mimetype) {
   try {
     const token = connection.meta_token;
     const phoneNumberId = connection.meta_phone_number_id;
 
     if (!token || !phoneNumberId) {
       throw new Error('Meta credentials not configured');
     }
 
     const formData = new FormData();
     const fileBuffer = fs.readFileSync(filePath);
     const blob = new Blob([fileBuffer], { type: mimetype });
     formData.append('file', blob, path.basename(filePath));
     formData.append('messaging_product', 'whatsapp');
     formData.append('type', mimetype);
 
     const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/media`, {
       method: 'POST',
       headers: {
         Authorization: `Bearer ${token}`,
       },
       body: formData,
     });
 
     const data = await response.json();
     if (!response.ok) {
       throw new Error(data?.error?.message || `Upload failed with status ${response.status}`);
     }
 
     return data.id; // Returns the media ID
   } catch (error) {
     logError('meta.upload_media_failed', error, { connection_id: connection.id });
     throw error;
   }
 }
 
 /**
  * Delete/Revoke message (unified)
  */
export async function deleteMessage(connection, phone, messageId, options = {}) {
   const provider = detectProvider(connection);
   
   if (provider === 'meta') {
     try {
       const response = await fetch(
         `https://graph.facebook.com/v21.0/${connection.meta_phone_number_id}/messages`,
         {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
             Authorization: `Bearer ${connection.meta_token}`,
           },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
             recipient_type: 'individual',
             to: String(phone || '').replace(/\D/g, ''),
             type: 'reaction',
             reaction: { message_id: messageId, emoji: '' },
            }),
         }
       );
       const data = await response.json();
      // Meta Cloud API não suporta apagar (revogar) mensagem para todos.
      // O melhor que conseguimos é remover a reação. Retornamos sucesso apenas
      // se a API aceitou o request, mas avisamos no error.
      if (!response.ok) {
        const errorDetails = data?.error?.message || `HTTP ${response.status}`;
        const errorCode = data?.error?.code || response.status;
        console.error(`[Meta API Error] Code ${errorCode}: ${errorDetails}`);
        return { 
          success: false, 
          error: `Meta Error #${errorCode}: ${errorDetails}`,
          metaError: data?.error 
        };
      }
      return { success: true, warning: 'Meta Cloud API não permite apagar mensagens para o destinatário; apagada apenas localmente.' };
     } catch (error) {
       return { success: false, error: error.message };
     }
   }
 
   if (provider === 'wapi') {
     const resolvedToken = await resolveWapiToken(connection);
     return wapiProvider.deleteMessage(connection.instance_id, resolvedToken, messageId, phone);
   }
 
  if (provider === 'uazapi') {
    if (!connection.uazapi_url || !connection.uazapi_token) {
      return { success: false, error: 'Credenciais UAZAPI não configuradas para esta conexão' };
    }
    return uazapiProvider.deleteMessage(
      connection.uazapi_url,
      connection.uazapi_token,
      phone,
      messageId,
      { originalText: options?.originalText }
    );
  }

    if (provider === 'evolution') {
     try {
       const isGroup = phone.includes('@g.us');
       const remoteJid = isGroup ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
       const response = await fetch(`${connection.api_url}/message/deleteMessage/${connection.instance_name}`, {
         method: 'DELETE',
         headers: {
           apikey: connection.api_key,
           'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           number: remoteJid,
           key: { id: messageId, fromMe: true },
         }),
       });
       return { success: response.ok };
     } catch (error) {
       return { success: false, error: error.message };
     }
   }
 
   return { success: false, error: 'Provider not supported for delete' };
 }
 
 /**
  * Edit message (unified)
  */
 export async function editMessage(connection, phone, messageId, newText, options = {}) {
   const provider = detectProvider(connection);
 
  if (provider === 'meta') {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${connection.meta_phone_number_id}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${connection.meta_token}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            message_id: messageId,
            status: 'edited',
            text: { body: newText },
          }),
         }
      );
      const data = await response.json();
      return { success: response.ok, error: data?.error?.message };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

   if (provider === 'wapi') {
     const resolvedToken = await resolveWapiToken(connection);
     return wapiProvider.editMessage(connection.instance_id, resolvedToken, messageId, phone, newText);
   }
 
  if (provider === 'uazapi') {
    try {
      const baseUrl = connection.uazapi_url;
      const token = connection.uazapi_token;
      if (!baseUrl || !token) {
        return { success: false, error: 'UAZAPI URL/token ausentes na conexão' };
      }
      return await uazapiProvider.editMessage(baseUrl, token, phone, messageId, newText, options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

   if (provider === 'evolution') {
     try {
       const isGroup = phone.includes('@g.us');
       const remoteJid = isGroup ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
       const response = await fetch(`${connection.api_url}/message/editMessage/${connection.instance_name}`, {
         method: 'POST',
         headers: {
           apikey: connection.api_key,
           'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           number: remoteJid,
           text: newText,
           key: { id: messageId, fromMe: true },
         }),
       });
       return { success: response.ok };
     } catch (error) {
       return { success: false, error: error.message };
     }
   }
 
   return { success: false, error: 'Provider not supported for edit' };
 }
 
// Unified WhatsApp Provider
// Routes requests to the correct provider (Evolution API or W-API)

import fs from 'fs';
import path from 'path';
import { query } from '../db.js';
import * as wapiProvider from './wapi-provider.js';
import * as uazapiProvider from './uazapi-provider.js';
import { logError, logInfo, logWarn } from '../logger.js';


const globalWapiTokenCache = {
  value: null,
  expiresAt: 0,
};

async function getGlobalWapiToken() {
  if (globalWapiTokenCache.value && Date.now() < globalWapiTokenCache.expiresAt) {
    return globalWapiTokenCache.value;
  }

  const result = await query(`SELECT value FROM system_settings WHERE key = 'wapi_token' LIMIT 1`);
  const token = result.rows[0]?.value || null;

  globalWapiTokenCache.value = token;
  globalWapiTokenCache.expiresAt = Date.now() + 60 * 1000;
  return token;
}

async function resolveWapiToken(connection) {
  // Prioriza token da própria conexão (especialmente importante para instâncias
  // que exigem token de instância), com fallback para token global do integrador.
  if (connection?.wapi_token) {
    try {
      const globalToken = await getGlobalWapiToken();
      if (globalToken && globalToken !== connection.wapi_token) {
        logWarn('wapi.token_mismatch_using_connection', {
          connection_id: connection?.id || null,
        });
      }
    } catch (error) {
      logWarn('wapi.resolve_global_token_failed', {
        connection_id: connection?.id || null,
        error: error?.message || 'unknown_error',
      });
    }

    return connection.wapi_token;
  }

  try {
    return await getGlobalWapiToken();
  } catch (error) {
    logWarn('wapi.resolve_global_token_failed', {
      connection_id: connection?.id || null,
      error: error?.message || 'unknown_error',
    });
    return null;
  }
}

/**
 * Check Meta Cloud API connection status by validating the token
 */
async function checkMetaStatus(connection) {
  try {
    const token = connection.meta_token;
    const phoneNumberId = connection.meta_phone_number_id;

    if (!token || !phoneNumberId) {
      return {
        status: 'disconnected',
        error: 'Token ou Phone Number ID não configurados',
      };
    }

    // Validate token by calling the Graph API
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=verified_name,display_phone_number`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (response.ok) {
      const data = await response.json();
      return {
        status: 'connected',
        phoneNumber: data.display_phone_number || connection.phone_number || null,
      };
    }

    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData?.error?.message || `HTTP ${response.status}`;

    // Token expired or invalid
    if (response.status === 401 || response.status === 190) {
      return {
        status: 'disconnected',
        error: `Token inválido ou expirado: ${errorMsg}`,
      };
    }

    return {
      status: 'disconnected',
      error: errorMsg,
    };
  } catch (error) {
    logError('meta.status_check_failed', error, {
      connection_id: connection?.id,
    });
    // If it's a network error, preserve current status
    if (connection.status === 'connected') {
      return { status: 'connected', phoneNumber: connection.phone_number, transient: true };
    }
    return { status: 'disconnected', error: error.message };
  }
}

/**
 * Detect provider from connection data
 */
export function detectProvider(connection) {
  const provider = String(connection?.provider || '').toLowerCase();

  // Meta Cloud API
  if (provider === 'meta') {
    return 'meta';
  }

  // UAZAPI
  if (provider === 'uazapi' || (connection?.uazapi_url && connection?.uazapi_token)) {
    return 'uazapi';
  }

  // Direct Instance ID é sempre W-API no sistema atual
  if (connection?.instance_id) {
    return 'wapi';
  }

  if (provider === 'wapi' || provider === 'evolution') {
    return provider;
  }

  // Default to Evolution
  return 'evolution';
}

/**
 * Check connection status
 */
export async function checkStatus(connection) {
  const provider = detectProvider(connection);

  if (provider === 'meta') {
    return checkMetaStatus(connection);
  }

  if (provider === 'uazapi') {
    return uazapiProvider.checkStatus(connection.uazapi_url, connection.uazapi_token);
  }

  if (provider === 'wapi') {
    const resolvedToken = await resolveWapiToken(connection);
    return wapiProvider.checkStatus(connection.instance_id, resolvedToken);
  }

  // Evolution API
  try {
    const startedAt = Date.now();
    logInfo('evolution.status_check_started', {
      connection_id: connection.id,
      instance_name: connection.instance_name,
    });

    const response = await fetch(
      `${connection.api_url}/instance/connectionState/${connection.instance_name}`,
      {
        headers: { apikey: connection.api_key },
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logWarn('evolution.status_check_non_ok', {
        connection_id: connection.id,
        instance_name: connection.instance_name,
        status_code: response.status,
        duration_ms: Date.now() - startedAt,
        body_preview: String(text || '').slice(0, 300),
      });
      return { status: 'disconnected', error: `Failed to check status (HTTP ${response.status})` };
    }

    const text = await response.text().catch(() => '');
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      logError('evolution.status_check_parse_failed', e, {
        connection_id: connection.id,
        instance_name: connection.instance_name,
        duration_ms: Date.now() - startedAt,
        body_preview: String(text || '').slice(0, 500),
      });
      return { status: 'disconnected', error: 'Invalid JSON response' };
    }

    if (data.instance?.state === 'open') {
      logInfo('evolution.status_check_connected', {
        connection_id: connection.id,
        instance_name: connection.instance_name,
        duration_ms: Date.now() - startedAt,
        has_phone: Boolean(data.instance?.phoneNumber),
      });
      return {
        status: 'connected',
        phoneNumber: data.instance?.phoneNumber,
      };
    }

    logInfo('evolution.status_check_disconnected', {
      connection_id: connection.id,
      instance_name: connection.instance_name,
      duration_ms: Date.now() - startedAt,
    });
    return { status: 'disconnected' };
  } catch (error) {
    logError('evolution.status_check_exception', error, {
      connection_id: connection.id,
      instance_name: connection.instance_name,
    });
    return { status: 'disconnected', error: error.message };
  }
}

/**
 * Get QR Code
 */
export async function getQRCode(connection) {
  const provider = detectProvider(connection);

  if (provider === 'meta') {
    // Meta Cloud API doesn't use QR codes
    return null;
  }

  if (provider === 'uazapi') {
    return uazapiProvider.getQRCode(connection.uazapi_url, connection.uazapi_token);
  }

  if (provider === 'wapi') {
    const resolvedToken = await resolveWapiToken(connection);
    return wapiProvider.getQRCode(connection.instance_id, resolvedToken);
  }

  // Evolution API
  try {
    const response = await fetch(
      `${connection.api_url}/instance/connect/${connection.instance_name}`,
      {
        headers: { apikey: connection.api_key },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.base64 || data.qrcode?.base64 || null;
  } catch (error) {
    console.error('Evolution getQRCode error:', error);
    return null;
  }
}

/**
 * Disconnect/Logout
 */
export async function disconnect(connection) {
  const provider = detectProvider(connection);

  if (provider === 'meta') {
    // Meta Cloud API: just mark as disconnected in DB
    await query('UPDATE connections SET status = $1, updated_at = NOW() WHERE id = $2', ['disconnected', connection.id]);
    return true;
  }

  if (provider === 'uazapi') {
    return uazapiProvider.disconnect(connection.uazapi_url, connection.uazapi_token);
  }

  if (provider === 'wapi') {
    const resolvedToken = await resolveWapiToken(connection);
    return wapiProvider.disconnect(connection.instance_id, resolvedToken);
  }

  // Evolution API
  try {
    const response = await fetch(
      `${connection.api_url}/instance/logout/${connection.instance_name}`,
      {
        method: 'DELETE',
        headers: { apikey: connection.api_key },
      }
    );

    return response.ok;
  } catch (error) {
    console.error('Evolution disconnect error:', error);
    return false;
  }
}

/**
 * Send message (unified)
 */
export async function sendMessage(connection, phone, content, messageType, mediaUrl, filename = null, duration = null, mimetype = null) {
  const provider = detectProvider(connection);
  const startedAt = Date.now();

  logInfo('whatsapp.send_message_started', {
    connection_id: connection.id,
    provider,
    message_type: messageType,
    has_media_url: Boolean(mediaUrl),
    has_content: Boolean(content),
    phone_preview: phone ? String(phone).substring(0, 15) : null,
  });

  if (provider === 'uazapi') {
    try {
      const result = await uazapiProvider.sendMessage(
        connection.uazapi_url,
        connection.uazapi_token,
        phone,
        content,
        messageType,
        mediaUrl,
        filename,
        null, // messageId para edição
        (() => {
          if (duration === null || duration === undefined) return 1;
          const rawSeconds = String(duration).trim().toUpperCase();
          if (rawSeconds === 'N/A' || rawSeconds === 'UNDEFINED' || rawSeconds === 'NULL' || rawSeconds === '') {
            return 0;
          }
          const clean = rawSeconds.replace(/[^\d.]/g, '');
          if (!clean || clean === '.') return 1;
          const num = parseFloat(clean);
          return (!isNaN(num) && num >= 0) ? Math.floor(num) : 1;
        })(),
        mimetype
      );
      logInfo('whatsapp.send_message_uazapi_result', {
        connection_id: connection.id,
        success: result.success,
        error: result.error || null,
        duration_ms: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      logError('whatsapp.send_message_uazapi_exception', error, {
        connection_id: connection.id,
        duration_ms: Date.now() - startedAt,
      });
      return { success: false, error: error.message };
    }
  }

  if (provider === 'meta') {
    return sendMetaMessage(connection, phone, content, messageType, mediaUrl);
  }

  if (provider === 'wapi') {
    try {
      const resolvedToken = await resolveWapiToken(connection);
      const result = await wapiProvider.sendMessage(
        connection.instance_id,
        resolvedToken,
        phone,
        content,
        messageType,
        mediaUrl,
        filename
      );

      logInfo('whatsapp.send_message_wapi_result', {
        connection_id: connection.id,
        success: result.success,
        error: result.error || null,
        duration_ms: Date.now() - startedAt,
      });

      return result;
    } catch (error) {
      logError('whatsapp.send_message_wapi_exception', error, {
        connection_id: connection.id,
        duration_ms: Date.now() - startedAt,
      });
      return { success: false, error: error.message };
    }
  }

  // Evolution API
  try {
    if (!connection.api_url) {
      logWarn('whatsapp.send_message_evolution_missing_url', {
        connection_id: connection.id,
        instance_name: connection.instance_name
      });
      return { 
        success: false, 
        error: 'URL da API não configurada para esta conexão. Verifique as configurações da conexão.' 
      };
    }

    let endpoint;
    let body;

    if (messageType === 'text') {
      endpoint = `/message/sendText/${connection.instance_name}`;
      body = {
        number: phone,
        text: content,
      };
    } else if (messageType === 'audio') {
      endpoint = `/message/sendWhatsAppAudio/${connection.instance_name}`;
      body = {
        number: phone,
        audio: mediaUrl,
        delay: 1200,
        seconds: (() => {
          if (duration === null || duration === undefined) return 1;
          const rawSeconds = String(duration).trim().toUpperCase();
          
          if (rawSeconds === 'N/A' || rawSeconds === 'UNDEFINED' || rawSeconds === 'NULL' || rawSeconds === '') {
            return 0;
          }
          
          const clean = rawSeconds.replace(/[^\d.]/g, '');
          if (!clean || clean === '.') return 1;
          const num = parseFloat(clean);
          return (!isNaN(num) && num >= 0) ? Math.floor(num) : 1;
        })(),
      };
    } else {
      // image, video, document
      endpoint = `/message/sendMedia/${connection.instance_name}`;
      body = {
        number: phone,
        mediatype: messageType,
        media: mediaUrl,
      };
      if (content) {
        body.caption = content;
      }
    }

    const response = await fetch(`${connection.api_url}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: connection.api_key,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.message || 'Failed to send message',
      };
    }

    const result = await response.json();
    return { success: true, messageId: result.key?.id };
  } catch (error) {
    console.error('Evolution sendMessage error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if number is on WhatsApp
 */
export async function checkNumber(connection, phone) {
  const provider = detectProvider(connection);

  if (provider === 'meta') {
    // Meta Cloud API doesn't have a direct "check number" API
    // Return true by default; delivery will fail if number is invalid
    return true;
  }

  if (provider === 'uazapi') {
    return uazapiProvider.checkNumber(connection.uazapi_url, connection.uazapi_token, phone);
  }

  if (provider === 'wapi') {
    const resolvedToken = await resolveWapiToken(connection);
    return wapiProvider.checkNumber(connection.instance_id, resolvedToken, phone);
  }

  // Evolution API
  try {
    const response = await fetch(
      `${connection.api_url}/chat/whatsappNumbers/${connection.instance_name}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: connection.api_key,
        },
        body: JSON.stringify({
          numbers: [phone],
        }),
      }
    );

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data?.[0]?.exists === true;
  } catch (error) {
    console.error('Evolution checkNumber error:', error);
    return false;
  }
}

/**
 * Send typing/composing presence indicator
 */
export async function sendPresenceComposing(connection, contactPhone) {
  const provider = detectProvider(connection);

  if (provider === 'uazapi') {
    return uazapiProvider.sendPresenceComposing(connection.uazapi_url, connection.uazapi_token, contactPhone);
  }

  if (provider === 'wapi') {
    const resolvedToken = await resolveWapiToken(connection);
    return wapiProvider.sendPresenceComposing(connection.instance_id, resolvedToken, contactPhone);
  }

  // Evolution API
  try {
    const isGroup = contactPhone.includes('@g.us');
    const remoteJid = isGroup ? contactPhone : `${contactPhone.replace(/\D/g, '')}@s.whatsapp.net`;
    
    await fetch(
      `${connection.api_url}/chat/presence/${connection.instance_name}`,
      {
        method: 'POST',
        headers: {
          apikey: connection.api_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          remoteJid,
          presence: 'composing',
        }),
      }
    );
  } catch (error) {
    logWarn('whatsapp_provider.presence_error', { error: error.message });
  }
}

/**
 * Send message via Meta Cloud API
 */
async function sendMetaMessage(connection, phone, content, messageType, mediaUrl) {
  try {
    const token = connection.meta_token;
    const phoneNumberId = connection.meta_phone_number_id;

    if (!token || !phoneNumberId) {
      return { success: false, error: 'Token ou Phone Number ID não configurados' };
    }

    // Handle local media upload for Meta
    let mediaId = null;
    if (mediaUrl && (mediaUrl.includes('/uploads/') || !mediaUrl.startsWith('http'))) {
      try {
        const filename = path.basename(mediaUrl.split('?')[0]);
        const filePath = path.join(process.cwd(), 'uploads', filename);
        
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filename).toLowerCase();
          const mimeMap = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
            '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.webm': 'audio/webm',
            '.m4a': 'audio/mp4', '.aac': 'audio/aac'
          };
          const mimetype = mimeMap[ext] || 'application/octet-stream';
          mediaId = await uploadMetaMedia(connection, filePath, mimetype);
        }
      } catch (uploadError) {
        logWarn('meta.auto_upload_failed_falling_back_to_link', { error: uploadError.message });
      }
    }

    // Normalize phone number (remove non-digits)
    const cleanPhone = String(phone).replace(/\D/g, '');

    let body;

    if (messageType === 'text') {
      body = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'text',
        text: { body: content },
      };
    } else if (messageType === 'image') {
      body = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'image',
        image: mediaId ? { id: mediaId, ...(content ? { caption: content } : {}) } : { link: mediaUrl, ...(content ? { caption: content } : {}) },
      };
    } else if (messageType === 'audio') {
      body = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'audio',
        audio: mediaId ? { id: mediaId } : { link: mediaUrl },
      };
    } else if (messageType === 'video') {
      body = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'video',
        video: mediaId ? { id: mediaId, ...(content ? { caption: content } : {}) } : { link: mediaUrl, ...(content ? { caption: content } : {}) },
      };
    } else if (messageType === 'document') {
      body = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'document',
        document: mediaId ? { id: mediaId, ...(content ? { filename: content } : {}) } : { link: mediaUrl, ...(content ? { filename: content } : {}) },
      };
    } else if (messageType === 'contact') {
      // Meta Cloud API: type 'contacts' (array)
      let contactName = '';
      let contactPhone = '';
      try {
        const ct = typeof content === 'string' ? JSON.parse(content) : content;
        contactName = ct?.contactName || ct?.name || '';
        contactPhone = String(ct?.contactPhone || ct?.phone || '').replace(/\D/g, '');
      } catch {
        return { success: false, error: 'Dados de contato inválidos' };
      }
      if (!contactName || !contactPhone) {
        return { success: false, error: 'Nome e telefone do contato são obrigatórios' };
      }
      const parts = contactName.trim().split(/\s+/);
      const firstName = parts[0] || contactName;
      const lastName = parts.slice(1).join(' ');
      body = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'contacts',
        contacts: [{
          name: {
            formatted_name: contactName,
            first_name: firstName,
            ...(lastName ? { last_name: lastName } : {}),
          },
          phones: [{
            phone: `+${contactPhone}`,
            wa_id: contactPhone,
            type: 'CELL',
          }],
        }],
      };
    } else {
      // Fallback to text
      body = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'text',
        text: { body: content || '' },
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    const result = await response.json();

    if (!response.ok) {
      const errorMsg = result?.error?.message || `HTTP ${response.status}`;
      const errorCode = result?.error?.code || response.status;
      logError('meta.send_message_failed', new Error(errorMsg), {
        connection_id: connection.id,
        status: response.status,
        code: errorCode
      });
      return { 
        success: false, 
        error: `Meta Error #${errorCode}: ${errorMsg}`,
        metaError: result?.error 
      };
    }

    return {
      success: true,
      messageId: result?.messages?.[0]?.id || null,
    };
  } catch (error) {
    logError('meta.send_message_exception', error, {
      connection_id: connection.id,
    });
    return { success: false, error: error.message };
  }
}
