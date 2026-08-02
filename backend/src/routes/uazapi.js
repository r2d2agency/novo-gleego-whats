// UAZAPI Routes - Webhook handler + diagnostics
// https://docs.uazapi.com/

import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import * as uazapiProvider from '../lib/uazapi-provider.js';
import { executeFlow, continueFlowWithInput } from '../lib/flow-executor.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { detectSalesSeoLead, updateSalesSeoEvolution } from '../lib/sales-seo-service.js';
import { handleAutoReplies } from '../lib/auto-reply-service.js';
import { analyzeGroupMessage } from '../lib/group-secretary.js';
import { sendPushToOrgUsers } from './push.js';
import { recordSecretaryEvent, getSecretaryEvents, clearSecretaryEvents } from '../lib/group-secretary-diagnostic.js';
import { processIncomingWithAgent } from '../lib/ai-agent-processor.js';

const router = Router();

/**
 * Extrai instanceId do payload (várias formas possíveis)
 */
function extractInstanceId(payload) {
  return (
    payload?.instance ||
    payload?.instanceId ||
    payload?.instance_id ||
    payload?.instance?.id ||
    payload?.data?.instance ||
    payload?.data?.instanceId ||
    payload?.token || // alguns webhooks enviam token como identificador
    null
  );
}

/**
 * Detecta tipo de evento
 */
function detectEventType(payload) {
  const ev = String(payload?.event || payload?.type || '').toLowerCase();
  if (ev.includes('connect') || ev.includes('status')) return 'connection_update';
  if (ev.includes('message') || payload?.message || payload?.text || payload?.data?.message) {
    if (payload?.fromMe || payload?.message?.fromMe) return 'message_sent';
    return 'message_received';
  }
  return 'unknown';
}

function isTruthy(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'sim'].includes(value.trim().toLowerCase());
  }
  return false;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

function normalizeChatId(value, isGroup = false) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return raw;

  if (isGroup) return `${raw.replace(/\s/g, '')}@g.us`;

  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

async function findExistingConversationForUazapi(connectionId, message) {
  let conversationResult = await query(
    `SELECT id FROM conversations WHERE connection_id = $1 AND remote_jid = $2 LIMIT 1`,
    [connectionId, message.chatId]
  );

  if (conversationResult.rows.length === 0 && message.isGroup && message.chatId) {
    // Some old UAZAPI webhook formats arrived without @g.us and were previously
    // normalized as @s.whatsapp.net. Match the group by its base id to avoid
    // creating a duplicate and to fix the is_group flag on the existing chat.
    conversationResult = await query(
      `SELECT id FROM conversations
       WHERE connection_id = $1
         AND (
           split_part(COALESCE(remote_jid, ''), '@', 1) = split_part($2, '@', 1)
           OR REGEXP_REPLACE(COALESCE(remote_jid, ''), '\D', '', 'g') = REGEXP_REPLACE($2, '\D', '', 'g')
         )
       ORDER BY last_message_at DESC NULLS LAST, updated_at DESC NULLS LAST
       LIMIT 1`,
      [connectionId, message.chatId]
    );
  }

  if (conversationResult.rows.length === 0 && !message.isGroup && message.phone) {
    // Phone/JID formats can change between providers/events (+55, @lid, @s.whatsapp.net).
    // The platform standard is to match people by the last 9 digits to avoid duplicate chats.
    conversationResult = await query(
      `SELECT id FROM conversations
       WHERE connection_id = $1
         AND COALESCE(is_group, false) = false
         AND RIGHT(REGEXP_REPLACE(COALESCE(contact_phone, remote_jid, ''), '\\D', '', 'g'), 9) = RIGHT($2, 9)
       ORDER BY last_message_at DESC NULLS LAST, updated_at DESC NULLS LAST
       LIMIT 1`,
      [connectionId, message.phone]
    );
  }

  return conversationResult;
}

function extractMessagePayload(payload) {
  return payload?.message || payload?.data?.message || payload?.data || payload;
}

function getMessageId(payload, messagePayload) {
  return (
    payload?.messageId ||
    payload?.id ||
    payload?.key?.id ||
    messagePayload?.id ||
    messagePayload?.messageId ||
    messagePayload?.key?.id ||
    `uazapi_${Date.now()}_${crypto.randomUUID()}`
  );
}

function extractMessageData(payload) {
  const msg = extractMessagePayload(payload);
  const fromMe = isTruthy(
    payload?.fromMe ??
    msg?.fromMe ??
    payload?.key?.fromMe ??
    msg?.key?.fromMe
  );

  const rawChatId = (
    payload?.chatId ||
    payload?.chatid ||
    payload?.remoteJid ||
    payload?.key?.remoteJid ||
    payload?.data?.key?.remoteJid ||
    payload?.message?.key?.remoteJid ||
    payload?.data?.message?.key?.remoteJid ||
    msg?.chatId ||
    msg?.chatid ||
    msg?.remoteJid ||
    msg?.key?.remoteJid ||
    msg?.message?.key?.remoteJid ||
    msg?.chat?.id ||
    msg?.chat?.jid ||
    payload?.from ||
    msg?.from ||
    msg?.jid ||
    msg?.id
  );

  const explicitIsGroup = isTruthy(
    payload?.isGroup ??
    payload?.is_group ??
    payload?.group ??
    payload?.is_group_message ??
    payload?.chat?.isGroup ??
    payload?.chat?.is_group ??
    msg?.isGroup ??
    msg?.is_group ??
    msg?.group ??
    msg?.is_group_message ??
    msg?.chat?.isGroup ??
    msg?.chat?.is_group
  ) ||
  String(payload?.chatType || payload?.chat_type || payload?.typeChat || msg?.chatType || msg?.chat_type || msg?.typeChat || '')
    .toLowerCase()
    .includes('group');

  const chatId = normalizeChatId(rawChatId, explicitIsGroup || String(rawChatId || '').includes('@g.us'));

  const isGroup = explicitIsGroup || String(chatId || '').includes('@g.us');
  // Some UAZAPI/Baileys events arrive addressed by @lid (linked-device id) instead
  // of the real phone JID. That causes the SAME contact to create a duplicate
  // conversation (one under @lid, another under @s.whatsapp.net). Prefer the
  // real phone whenever the provider ships it in an auxiliary field.
  const lidRealPhone = normalizePhone(
    payload?.senderPn ||
    payload?.sender_pn ||
    payload?.lidPn ||
    payload?.participant_pn ||
    payload?.participantPn ||
    payload?.pn ||
    payload?.phoneNumber ||
    msg?.senderPn ||
    msg?.sender_pn ||
    msg?.lidPn ||
    msg?.participant_pn ||
    msg?.participantPn ||
    msg?.pn ||
    msg?.phoneNumber ||
    msg?.sender?.pn ||
    payload?.sender?.pn ||
    null
  );
  const chatIdIsLid = String(rawChatId || '').includes('@lid');
  const normalizedChatId = (!isGroup && chatIdIsLid && lidRealPhone)
    ? `${lidRealPhone}@s.whatsapp.net`
    : chatId;
  const phone = normalizePhone(
    (!isGroup && chatIdIsLid && lidRealPhone) ? lidRealPhone :
    payload?.phone ||
    payload?.number ||
    payload?.from ||
    msg?.phone ||
    msg?.number ||
    msg?.from ||
    normalizedChatId
  );

  const messageId = getMessageId(payload, msg);
  // IMPORTANTE: quando fromMe=true, pushName/senderName é o nome do DONO da conta
  // (quem enviou), e não do contato remoto. Nesse caso não devemos usar como nome
  // do contato — caso contrário todas as conversas iniciadas por nós ficariam
  // com o mesmo nome (o nome do operador do WhatsApp).
  const rawSenderName =
    payload?.senderName ||
    payload?.pushName ||
    msg?.senderName ||
    msg?.pushName ||
    msg?.sender?.pushName ||
    payload?.sender?.pushName ||
    payload?.name ||
    msg?.name ||
    null;
  const senderName = fromMe ? null : rawSenderName;

  const groupName =
    payload?.groupName ||
    msg?.groupName ||
    payload?.chat?.name ||
    msg?.chat?.name ||
    payload?.chat?.subject ||
    msg?.chat?.subject ||
    null;

  // ===== Detecção de tipo + extração de mídia =====
  // UAZAPI/Baileys pode entregar:
  //   - msg.type = 'image'|'video'|'audio'|'document'|'sticker'|'text'
  //   - msg.imageMessage / videoMessage / audioMessage / documentMessage / stickerMessage
  //   - msg.image / video / audio / document (objetos com URL/mimetype/caption ou string JSON)
  //   - msg.text, msg.body, msg.caption, msg.conversation (texto puro)
  //
  // ATENÇÃO: campos como msg.image podem vir como STRING contendo JSON inteiro
  // ({"URL":"...enc","mimetype":"image/jpeg",...}). Precisamos parsear e extrair.

  function tryParseJSON(v) {
    if (!v || typeof v !== 'string') return v;
    const s = v.trim();
    if (!s.startsWith('{') && !s.startsWith('[')) return v;
    try { return JSON.parse(s); } catch { return v; }
  }

  function pickMediaObject() {
    const candidates = [
      ['image', 'image'],
      ['video', 'video'],
      ['audio', 'audio'],
      ['document', 'document'],
      ['sticker', 'sticker'],
      ['imageMessage', 'image'],
      ['videoMessage', 'video'],
      ['audioMessage', 'audio'],
      ['documentMessage', 'document'],
      ['stickerMessage', 'sticker'],
    ];
    for (const [field, type] of candidates) {
      const raw = msg?.[field] ?? payload?.[field];
      if (!raw) continue;
      const obj = typeof raw === 'object' ? raw : tryParseJSON(raw);
      if (obj && typeof obj === 'object') return { obj, type };
    }
    return null;
  }

  // Algumas instâncias UAZAPI colocam o JSON da mídia direto em text/body/content
  function tryExtractMediaFromText() {
    const candidates = [msg?.text, msg?.body, msg?.content, msg?.caption, payload?.text, payload?.body];
    for (const c of candidates) {
      if (!c || typeof c !== 'string') continue;
      const s = c.trim();
      if (!s.startsWith('{')) continue;
      const parsed = tryParseJSON(s);
      if (parsed && typeof parsed === 'object' && (parsed.URL || parsed.url || parsed.directPath || parsed.mediaKey)) {
        const mt = String(parsed.mimetype || parsed.mimeType || '').toLowerCase();
        let type = 'document';
        if (mt.startsWith('image/')) type = 'sticker' === parsed.kind ? 'sticker' : 'image';
        else if (mt.startsWith('video/')) type = 'video';
        else if (mt.startsWith('audio/')) type = 'audio';
        return { obj: parsed, type };
      }
    }
    return null;
  }

  function tryExtractMediaFromContent() {
    const c = msg?.content;
    if (!c || typeof c !== 'object') return null;
    if (c.URL || c.url || c.directPath || c.mediaKey) {
      const mt = String(c.mimetype || c.mimeType || '').toLowerCase();
      let type = 'document';
      if (mt.startsWith('image/')) type = 'image';
      else if (mt.startsWith('video/')) type = 'video';
      else if (mt.startsWith('audio/')) type = 'audio';
      return { obj: c, type };
    }
    return null;
  }

  let mediaObj = pickMediaObject() || tryExtractMediaFromText();
  if (!mediaObj) mediaObj = tryExtractMediaFromContent();

  const typeRaw = String(
    msg?.type ||
    msg?.messageType ||
    payload?.messageType ||
    payload?.type ||
    ''
  ).toLowerCase().replace(/message$/, '');

  // ===== Album (Baileys/UAZAPI) =====
  // O 'albumMessage' é apenas um container — as imagens/vídeos chegam como
  // mensagens individuais separadas no webhook. Ignoramos o container para
  // evitar registros sem conteúdo (ex.: "Album: 1 Image, 1 video").
  const isAlbumContainer =
    typeRaw === 'album' ||
    !!msg?.albumMessage ||
    !!payload?.albumMessage ||
    !!msg?.album ||
    !!payload?.album ||
    // Texto literal gerado pelo provedor para containers de álbum
    (typeof (msg?.text || msg?.body || msg?.content) === 'string' &&
      /^album:\s*\d+\s+(image|video|photo)/i.test(
        String(msg?.text || msg?.body || msg?.content).trim()
      ));

  // Texto: prioriza campos de texto puros; se for JSON de mídia, ignora
  function pickText() {
    const candidates = [
      mediaObj?.obj?.caption,
      msg?.caption,
      payload?.caption,
      msg?.text,
      msg?.body,
      msg?.content,
      msg?.conversation,
      payload?.text,
      payload?.body,
    ];
    for (const c of candidates) {
      if (!c || typeof c !== 'string') continue;
      const s = c.trim();
      if (s.startsWith('{') && (s.includes('"URL"') || s.includes('"directPath"') || s.includes('"mediaKey"'))) continue;
      if (s) return s;
    }
    return '';
  }

  let text = pickText();

  // ===== Tratamento de Mensagens Interativas (Menus/Botões) =====
  // Se for uma resposta de menu ou o próprio menu interativo, o conteúdo pode estar em msg.interactive ou campos similares
  const interactive = msg?.interactive || payload?.interactive || msg?.message?.interactive;
  if (interactive) {
    const reply = interactive.button_reply || interactive.list_reply || interactive.native_flow_response;
    if (reply) {
      text = reply.title || reply.name || reply.id || text;
    } else if (interactive.header || interactive.body || interactive.footer) {
      // É a mensagem do menu que enviamos (quando recebida de volta via webhook message_sent)
      const body = interactive.body?.text || '';
      const footer = interactive.footer?.text ? `\n_${interactive.footer.text}_` : '';
      text = `${body}${footer}`;
    }
  }

  // Resposta de Botão Simples (versões legadas ou específicas)
  if (msg?.buttonText || msg?.selectedButtonId) {
    text = msg.buttonText || msg.selectedButtonId;
  }

  // Resposta de Lista (versões legadas)
  if (msg?.listReply || msg?.selectedRowId) {
    text = msg.listReply?.title || msg.selectedRowId;
  }

  // Caso a UAZAPI envie o menu como JSON string no text (comum em message_sent)
  if (!text && (msg?.text || msg?.body || msg?.content)) {
    const rawText = String(msg?.text || msg?.body || msg?.content);
    if (rawText.startsWith('{') && rawText.includes('"buttons"')) {
      try {
        const parsed = JSON.parse(rawText);
        if (parsed.text) {
          text = parsed.text;
          if (parsed.footer) text += `\n_${parsed.footer}_`;
        }
      } catch (e) {}
    }
  }

  // URL da mídia: prefere URL pública direta; .enc precisa ser baixada via UAZAPI.
  // Algumas versões entregam a URL em campos diferentes.
  const rawMediaUrl = [
    msg?.content?.URL,
    msg?.content?.url,
    msg?.content?.mediaUrl,
    msg?.content?.file,
    msg?.mediaUrl,
    msg?.url,
    msg?.file,
    msg?.media?.url,
    payload?.mediaUrl,
    payload?.url,
    payload?.file,
    mediaObj?.obj?.mediaUrl,
    mediaObj?.obj?.url,
    mediaObj?.obj?.URL,
    mediaObj?.obj?.file,
    msg?.urlFull, // Algumas versões da UAZAPI usam urlFull para a URL pública
    payload?.urlFull
  ].find(v => !!v) || null;

  const mediaMimetype = [
    mediaObj?.obj?.mimetype,
    mediaObj?.obj?.mimeType,
    msg?.mimetype,
    msg?.mimeType,
    msg?.media?.mimetype,
    payload?.mimetype,
    payload?.mimeType,
    payload?.data?.mimetype,
    payload?.data?.mimeType
  ].find(v => !!v) || null;

  let messageType = (() => {
    if (['image', 'video', 'audio', 'document', 'sticker'].includes(typeRaw)) return typeRaw;
    if (mediaObj?.type) return mediaObj.type;
    if (rawMediaUrl) {
      const m = String(mediaMimetype || '').toLowerCase();
      if (m.startsWith('image/')) return 'image';
      if (m.startsWith('video/')) return 'video';
      if (m.startsWith('audio/')) return 'audio';
      return 'document';
    }
    return 'text';
  })();

  // ===== Tratamento Adicional de Respostas (Fallbacks Exaustivos) =====
  if (!text) {
    // 1. Resposta de Botões (vários formatos)
    const btnResponse = 
      msg?.buttonsResponseMessage || 
      payload?.buttonsResponseMessage || 
      msg?.message?.buttonsResponseMessage ||
      msg?.templateButtonReplyMessage || 
      payload?.templateButtonReplyMessage ||
      msg?.message?.templateButtonReplyMessage ||
      msg?.buttonReplyMessage ||
      msg?.message?.buttonReplyMessage;
    
    if (btnResponse) {
      text = btnResponse.selectedDisplayText || btnResponse.selectedId || btnResponse.displayText || '';
    }
    
    // 2. Resposta de Lista (vários formatos)
    const listResp = 
      msg?.listResponseMessage || 
      payload?.listResponseMessage || 
      msg?.message?.listResponseMessage ||
      msg?.listResponse ||
      msg?.message?.listResponse;

    if (listResp) {
      text = listResp.title || listResp.singleSelectReply?.selectedRowId || listResp.selectedRowId || '';
    }

    // 3. Resposta 'interactive' (Baileys/Evolution moderno)
    const interactiveResp = 
      msg?.interactiveResponseMessage || 
      payload?.interactiveResponseMessage || 
      msg?.message?.interactiveResponseMessage;

    if (interactiveResp) {
      const bodyText = interactiveResp.body?.text || '';
      const nativeFlow = interactiveResp.nativeFlowResponseMessage;
      if (nativeFlow) {
        try {
          const params = JSON.parse(nativeFlow.paramsJson || '{}');
          text = params.title || params.id || bodyText || '[Resposta]';
        } catch {
          text = bodyText || '[Resposta]';
        }
      } else {
        text = bodyText || '[Resposta]';
      }
    }

    // 4. Resposta dentro do objeto 'interactive'
    if (!text && interactive) {
      if (interactive.button_reply) {
        text = interactive.button_reply.title || interactive.button_reply.id;
      } else if (interactive.list_reply) {
        text = interactive.list_reply.title || interactive.list_reply.id;
      } else if (interactive.native_flow_response) {
        text = interactive.native_flow_response.name || '[Resposta]';
      }
    }

    // 5. Enquetes (Poll)
    if (!text && (msg?.pollUpdateMessage || msg?.pollCreationMessage || msg?.message?.pollUpdateMessage || msg?.message?.pollCreationMessage)) {
      text = `[Voto em enquete]`;
    }

    // 6. Reações
    if (!text && (typeRaw === 'reaction' || msg?.reactionMessage || msg?.message?.reactionMessage)) {
      const react = msg?.reactionMessage || msg?.message?.reactionMessage;
      text = react?.text ? `[Reação: ${react.text}]` : '[Reação]';
    }
  }

  // Se chegarmos aqui e ainda for uma mensagem de sistema da UAZAPI sobre o menu, tentamos forçar o texto
  if (!text && (typeRaw === 'interactive' || typeRaw === 'button' || typeRaw === 'list')) {
    text = interactive?.body?.text || interactive?.header?.text || '';
  }

  const originalFilename = [
    msg?.content?.fileName,
    msg?.content?.filename,
    mediaObj?.obj?.fileName,
    mediaObj?.obj?.filename,
    msg?.fileName,
    msg?.filename,
    payload?.fileName,
    payload?.filename
  ].find(v => !!v) || null;

  let content = text;
  if (!content) {
    if (messageType === 'image') content = '[Imagem]';
    else if (messageType === 'video') content = '[Vídeo]';
    else if (messageType === 'audio') content = '[Áudio]';
    else if (messageType === 'sticker') content = '[Sticker]';
    else if (messageType === 'document') content = originalFilename ? `[Documento: ${originalFilename}]` : '[Documento]';
    else if (typeRaw === 'interactive' || typeRaw === 'button' || typeRaw === 'list') {
      const choices = msg?.choices || payload?.choices || [];
      if (Array.isArray(choices) && choices.length > 0) {
        const btnList = choices.map(c => `[${typeof c === 'string' ? c : (c.label || c.text || c.id)}]`).join(' ');
        content = `Opções: ${btnList}`;
      } else {
        content = '[Mensagem interativa]';
      }
    } else {
      content = '[Mensagem interativa]';
    }
  }

  // mediaUrl final: marcamos com placeholder especial para o persist resolver.
  // (precisa do connection.uazapi_url para montar o proxy de download). 
  // Priorizamos o download via endpoint decifrado se o mediaObj existir e não houver uma URL pública clara.
  // mediaUrl final: marcamos com placeholder especial para o persist resolver.
  // Priorizamos o download via endpoint decifrado para garantir persistência e evitar erros 404 de URLs temporárias.
  const needsProxy = !!(mediaObj && (!rawMediaUrl || String(rawMediaUrl).includes('.enc') || String(rawMediaUrl).includes('mmg.whatsapp.net') || String(rawMediaUrl).includes('uazapi.com/files')));
  const mediaUrl = needsProxy ? `__UAZAPI_DOWNLOAD__:${messageId}` : (rawMediaUrl || null);
  return {
    chatId: normalizedChatId,
    phone,
    isGroup,
    fromMe,
    messageId,
    senderName,
    groupName,
    content,
    messageType,
    mediaUrl,
    mediaMimetype,
    isAlbumContainer,
    originalFilename,
  };
}

async function persistIncomingMessage(connection, payload) {
  const message = extractMessageData(payload);

  // Ignora containers de álbum: as mídias virão em webhooks separados
  if (message.isAlbumContainer) {
    return { skipped: true, reason: 'album_container' };
  }

  if (!message.chatId || (!message.content && !message.mediaUrl)) {
    return { skipped: true, reason: 'not_incoming_or_empty' };
  }

  // Resolve placeholder de download da UAZAPI: baixa mídia decifrada,
  // salva em /uploads e substitui mediaUrl pelo caminho público.
  if (typeof message.mediaUrl === 'string' && message.mediaUrl.startsWith('__UAZAPI_DOWNLOAD__:')) {
    const msgIdForDownload = message.mediaUrl.slice('__UAZAPI_DOWNLOAD__:'.length);
    try {
      const dl = await uazapiProvider.downloadMedia(
        connection.uazapi_url,
        connection.uazapi_token,
        msgIdForDownload
      );
      if (dl?.success) {
        const baseUrl = String(process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
        if (dl.url) {
          // Se a URL já for completa e externa (não for um path local), usamos ela.
          // Caso contrário, garantimos que seja absoluta se for um path do servidor.
          if (dl.url.startsWith('http')) {
            message.mediaUrl = dl.url;
          } else {
            const cleanPath = dl.url.startsWith('/') ? dl.url : `/uploads/${dl.url}`;
            message.mediaUrl = baseUrl ? `${baseUrl}${cleanPath}` : cleanPath;
          }
          if (!message.mediaMimetype && dl.mimetype) message.mediaMimetype = dl.mimetype;
        } else if (dl.buffer || dl.base64) {
          const buf = dl.buffer || Buffer.from(dl.base64, 'base64');
          const mt = (dl.mimetype || message.mediaMimetype || 'application/octet-stream').toLowerCase();
          const extMap = {
            'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
            'image/gif': '.gif', 'image/webp': '.webp',
            'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/3gpp': '.3gp',
            'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
            'audio/wav': '.wav', 'audio/webm': '.webm',
            'application/pdf': '.pdf',
          };
          const ext = extMap[mt] || path.extname(message.originalFilename || '') || '.bin';
          const baseName = message.originalFilename 
            ? path.parse(message.originalFilename).name.replace(/[^a-zA-Z0-9.-]/g, '_')
            : `uazapi_${crypto.randomUUID()}`;
          
          const fname = `${Date.now()}_${baseName}${ext}`;
          const uploadsDir = path.join(process.cwd(), 'uploads');
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
          fs.writeFileSync(path.join(uploadsDir, fname), buf);
          
          const localPath = `/uploads/${fname}`;
          message.mediaUrl = baseUrl ? `${baseUrl}${localPath}` : localPath;
          if (!message.mediaMimetype) message.mediaMimetype = mt;
        } else {
          message.mediaUrl = null;
        }
      } else {
        console.warn('[UAZAPI] downloadMedia falhou para', msgIdForDownload, dl?.error);
        message.mediaUrl = null;
      }
    } catch (e) {
      console.error('[UAZAPI] erro ao baixar mídia', e?.message);
      message.mediaUrl = null;
    }
  }

  // Dedup + reconcile pending optimistic messages sent via chat (temp_ message_id)
  {
    // Some UAZAPI echoes (mainly media sent from the phone) arrive without an id.
    // Give them a stable synthetic id so distinct messages never collide.
    if (!message.messageId) {
      message.messageId = `wa_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    }
    const existingMessage = await query(
      `SELECT id, message_id, conversation_id FROM chat_messages WHERE message_id = $1 LIMIT 1`,
      [message.messageId]
    );
    if (existingMessage.rows.length > 0) {
      return { skipped: true, reason: 'duplicate' };
    }

    if (message.fromMe) {
      // Reconcile webhook echoes from messages sent in the web chat.
      // Sometimes UAZAPI returns one id in the send response and a different id in the webhook;
      // in that case exact message_id dedupe is not enough, so match the recent optimistic row too.
      const convLookup = await findExistingConversationForUazapi(connection.id, message);
      if (convLookup.rows.length > 0) {
        const convId = convLookup.rows[0].id;
        const pending = await query(
          `SELECT id, message_id FROM chat_messages
           WHERE conversation_id = $1
             AND from_me = true
             AND COALESCE(is_deleted, false) = false
             AND timestamp > NOW() - INTERVAL '180 seconds'
             AND message_type = $2
             AND (
               -- ONLY optimistic rows created by the web chat can be reconciled.
               -- message_id IS NULL rows come from the phone/provider itself and are
               -- REAL distinct messages (e.g. several files sent from WhatsApp) —
               -- collapsing them made only the first file show up in the chat.
               message_id LIKE 'temp_%'
               AND sender_id IS NOT NULL
               AND status IN ('pending','sent')
               AND (
                 -- Text: match by exact content (safe: distinct texts don't collide)
                 ($2 = 'text' AND COALESCE(content,'') = COALESCE($3,''))
                 -- Media sent from the web chat: match the oldest pending item of same type
                 OR ($2 <> 'text' AND timestamp > NOW() - INTERVAL '180 seconds')
               )
             )
           ORDER BY
             timestamp ASC
           LIMIT 1`,
          [convId, message.messageType, message.content || '']
        );
        if (pending.rows.length > 0) {
          const existing = pending.rows[0];
          if (!existing.message_id || String(existing.message_id).startsWith('temp_')) {
            await query(
              `UPDATE chat_messages
               SET message_id = $1,
                   status = 'sent',
                   content = COALESCE($3, content),
                   media_url = COALESCE($4, media_url),
                   media_mimetype = COALESCE($5, media_mimetype)
               WHERE id = $2`,
              [message.messageId, existing.id, message.content || null, message.mediaUrl || null, message.mediaMimetype || null]
            );
          }
          return { skipped: true, reason: 'reconciled' };
        }
      }
    }
  }

  let conversationResult = await findExistingConversationForUazapi(connection.id, message);

  let conversationId;
  if (conversationResult.rows.length === 0) {
    const contactName = message.isGroup
      ? (message.groupName || 'Grupo')
      : (message.senderName || message.phone || 'Contato');

    const createdConversation = await query(
      `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone, is_group, group_name, last_message_at, unread_count, attendance_status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
       RETURNING id`,
      [
        connection.id,
        message.chatId,
        contactName,
        message.isGroup ? null : message.phone,
        message.isGroup,
        message.isGroup ? message.groupName : null,
        message.fromMe ? 0 : 1,
        message.fromMe ? 'attending' : 'waiting',
      ]
    );
    conversationId = createdConversation.rows[0].id;
    
    // SALES SEO: Detecta lead na criação da conversa
    try {
      await detectSalesSeoLead(connection.id, conversationId, message);
      await updateSalesSeoEvolution(conversationId, message);
    } catch (seoErr) {
      console.error('[Sales SEO] Erro UAZAPI (new):', seoErr.message);
    }
  } else {
    conversationId = conversationResult.rows[0].id;
    await query(
      `UPDATE conversations
       SET last_message_at = NOW(),
            unread_count = CASE WHEN $5::boolean THEN unread_count ELSE unread_count + 1 END,
           contact_name = COALESCE($2, contact_name),
            is_group = CASE WHEN $6::boolean THEN true ELSE COALESCE(is_group, false) END,
            group_name = CASE WHEN ($6::boolean OR COALESCE(is_group, false) = true OR remote_jid LIKE '%@g.us') THEN COALESCE($3, group_name) ELSE group_name END,
            attendance_status = CASE
              WHEN $5::boolean AND attendance_status = 'waiting' THEN 'attending'
              WHEN NOT $5::boolean AND attendance_status = 'finished' THEN 'waiting'
              ELSE attendance_status
            END,
            accepted_at = CASE WHEN $5::boolean AND attendance_status = 'waiting' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
            connection_id = COALESCE($4, connection_id),
            remote_jid = CASE WHEN $6::boolean THEN COALESCE($7, remote_jid) ELSE remote_jid END,
            contact_phone = CASE WHEN $6::boolean THEN NULL ELSE contact_phone END,
            updated_at = NOW()
        WHERE id = $1`,
       [conversationId, message.senderName, message.groupName, connection.id, message.fromMe, message.isGroup, message.chatId]
    );

    // Modo híbrido: se o atendente respondeu pelo WhatsApp diretamente (fromMe),
    // muda automaticamente de 'waiting' para 'attending'.
    if (message.fromMe) {
      await query(
        `UPDATE conversations
         SET attendance_status = 'attending',
             accepted_at = COALESCE(accepted_at, NOW()),
             updated_at = NOW()
         WHERE id = $1 AND attendance_status = 'waiting'`,
        [conversationId]
      );
    }

    // SALES SEO: Detecta lead e atualiza evolução
    try {
      await detectSalesSeoLead(connection.id, conversationId, message);
      await updateSalesSeoEvolution(conversationId, message);
    } catch (seoErr) {
      console.error('[Sales SEO] Erro UAZAPI:', seoErr.message);
    }
  }

  // Verifica se chat_messages tem a coluna connection_id
  const chatMessagesHasConnectionId = await query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'chat_messages' AND column_name = 'connection_id'
    ) as exists_column
  `).then(r => r.rows[0].exists_column);

  if (chatMessagesHasConnectionId) {
    await query(
      `INSERT INTO chat_messages (conversation_id, message_id, content, message_type, media_url, media_mimetype, from_me, sender_name, sender_phone, status, timestamp, connection_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)`,
      [
        conversationId,
        message.messageId,
        message.content,
        message.messageType,
        message.mediaUrl,
        message.mediaMimetype,
        message.fromMe,
        message.senderName,
        message.phone,
        message.fromMe ? 'sent' : 'received',
        connection.id
      ]
    );
  } else {
    await query(
      `INSERT INTO chat_messages (conversation_id, message_id, content, message_type, media_url, media_mimetype, from_me, sender_name, sender_phone, status, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        conversationId,
        message.messageId,
        message.content,
        message.messageType,
        message.mediaUrl,
        message.mediaMimetype,
        message.fromMe,
        message.senderName,
        message.phone,
        message.fromMe ? 'sent' : 'received',
      ]
    );
  }

  // Push notification on incoming message (skip own messages); honors per-conversation mute
  if (!message.fromMe && connection.organization_id) {
    (async () => {
      try {
        const convInfo = await query(
          `SELECT is_muted, (COALESCE(is_group, false) OR remote_jid LIKE '%@g.us') AS is_group, group_name, contact_name, contact_phone FROM conversations WHERE id = $1`,
          [conversationId]
        );
        const conv = convInfo.rows[0];
        if (!conv || conv.is_muted) return;
        const titleName = conv.is_group
          ? (conv.group_name || 'Grupo')
          : (conv.contact_name || conv.contact_phone || 'Nova mensagem');
        const senderPrefix = conv.is_group && message.senderName ? `${message.senderName}: ` : '';
        let preview = '';
        if (message.messageType === 'text') preview = (message.content || '').slice(0, 120);
        else if (message.messageType === 'image') preview = '📷 Foto';
        else if (message.messageType === 'audio') preview = '🎤 Áudio';
        else if (message.messageType === 'video') preview = '🎥 Vídeo';
        else if (message.messageType === 'document') preview = '📎 Documento';
        else preview = 'Nova mensagem';
        await sendPushToOrgUsers(connection.organization_id, {
          title: titleName,
          body: `${senderPrefix}${preview}`,
          url: '/chat',
          tag: `conv-${conversationId}`,
          data: { conversation_id: conversationId, type: 'new_message', is_group: !!conv.is_group },
        });
      } catch (e) {
        console.error('[UAZAPI] push notify error:', e.message);
      }
    })();
  }

  return { skipped: false, conversationId, messageId: message.messageId };
}

/**
 * Check active flow session and continue with user input.
 * Crucial para nó "Aguardar Resposta" — quando o usuário responde,
 * o fluxo segue imediatamente pelo handle "replied" (sem esperar timeout).
 */
async function continueActiveFlow(conversationId, userInput) {
  try {
    const sessionResult = await query(
      `SELECT id, flow_id, current_node_id FROM flow_sessions
       WHERE conversation_id = $1 AND is_active = true LIMIT 1`,
      [conversationId]
    );
    if (sessionResult.rows.length === 0) return { continued: false };
    console.log('[UAZAPI Flow Continue] Active session, node:', sessionResult.rows[0].current_node_id);
    const result = await continueFlowWithInput(conversationId, userInput);
    return { continued: !!result?.success, result };
  } catch (error) {
    console.error('[UAZAPI Flow Continue] Error:', error);
    return { continued: false, error: error.message };
  }
}

/**
 * Verifica palavras-chave e dispara fluxo, se não houver sessão ativa.
 */
async function checkAndTriggerFlow(connection, conversationId, messageContent) {
  try {
    if (!messageContent || typeof messageContent !== 'string') return false;
    const messageLower = messageContent.trim().toLowerCase();
    if (!messageLower) return false;

    const flowsResult = await query(
      `SELECT f.id, f.name, f.trigger_keywords, f.trigger_match_mode
       FROM flows f
       WHERE f.is_active = true
         AND f.trigger_enabled = true
         AND f.trigger_keywords IS NOT NULL
         AND array_length(f.trigger_keywords, 1) > 0
         AND (f.connection_ids IS NULL OR f.connection_ids = '{}' OR $1 = ANY(f.connection_ids))
       ORDER BY f.created_at`,
      [connection.id]
    );
    if (flowsResult.rows.length === 0) return false;

    for (const flow of flowsResult.rows) {
      const keywords = (flow.trigger_keywords || []).map(k => String(k).toLowerCase().trim());
      const matchMode = flow.trigger_match_mode || 'exact';
      let matched = false;
      for (const keyword of keywords) {
        if (!keyword) continue;
        if (matchMode === 'contains') matched = messageLower.includes(keyword);
        else if (matchMode === 'starts_with') matched = messageLower.startsWith(keyword);
        else matched = messageLower === keyword;
        if (matched) break;
      }
      if (matched) {
        console.log('[UAZAPI Flow Trigger] Iniciando fluxo:', flow.name);
        await executeFlow(flow.id, conversationId, 'start');
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('[UAZAPI Flow Trigger] Error:', error);
    return false;
  }
}

/**
 * Webhook handler
 * Configurar em UAZAPI: POST {SUA_URL}/api/uazapi/webhook
 */
async function handleWebhook(req, res, routeMeta = {}) {
  try {
    const payload = {
      ...(req.body || {}),
      event: req.body?.event || routeMeta.event || req.params?.event || null,
      messageType: req.body?.messageType || routeMeta.messageType || req.params?.messageType || null,
    };
    const instanceId = extractInstanceId(payload);
    const eventType = detectEventType(payload);

    console.log('[UAZAPI Webhook] Received:', JSON.stringify(payload).slice(0, 400));

    if (!instanceId) {
      uazapiProvider.pushUazapiEvent({ instanceId, eventType, payload });
      return res.status(200).json({ received: true, skipped: 'no instanceId' });
    }

    // Buscar conexão pela instance_id (uazapi armazena em instance_id também)
    const connResult = await query(
      `SELECT * FROM connections
       WHERE provider = 'uazapi' AND (instance_id = $1 OR uazapi_token = $1)
       LIMIT 1`,
      [String(instanceId)]
    );

    if (connResult.rows.length === 0) {
      console.log('[UAZAPI Webhook] Connection not found for:', instanceId);
      return res.status(200).json({ received: true, skipped: 'connection not found' });
    }

    const connection = connResult.rows[0];

    uazapiProvider.pushUazapiEvent({
      instanceId,
      eventType,
      payload,
      connectionId: connection.id,
      connectionInstanceId: connection.instance_id,
      connectionToken: connection.uazapi_token,
    });

    // Atualizar status quando recebe evento de conexão
    if (eventType === 'connection_update') {
      const status = String(payload?.status || payload?.state || '').toLowerCase();
      const dbStatus = (status === 'connected' || status === 'open') ? 'connected' : 'disconnected';
      await query(
        `UPDATE connections SET status = $1, phone_number = COALESCE($2, phone_number), updated_at = NOW() WHERE id = $3`,
        [dbStatus, payload?.phone || payload?.wid || null, connection.id]
      );
    }

    let persistence = null;
    if (eventType === 'message_received' || eventType === 'message_sent') {
      persistence = await persistIncomingMessage(connection, payload);
    }

    // Trigger/continue flows for incoming user messages (not echoes from us)
    try {
      if (eventType === 'message_received' && persistence && !persistence.skipped && persistence.conversationId) {
        const message = extractMessageData(payload);
        if (!message.fromMe) {
          // Auto-replies (Away / Out of Office)
          handleAutoReplies(connection, message.chatId || message.remoteJid, message.content || '').catch(err => {
            console.error('[UAZAPI] Auto-reply error:', err.message);
          });

          // ======= GROUP SECRETARY: AI analysis for group messages =======
          if (message.isGroup && message.content && connection.organization_id) {
            try {
              const msg = payload?.message || payload?.msg || {};
              const sources = [
                msg?.extendedTextMessage?.contextInfo?.mentionedJid,
                msg?.extendedTextMessage?.contextInfo?.mentionedJids,
                msg?.contextInfo?.mentionedJid,
                msg?.contextInfo?.mentionedJids,
                payload?.contextInfo?.mentionedJid,
                payload?.mentionedJids,
                payload?.mentionedJid,
              ];
              let mentionedJids = [];
              for (const src of sources) {
                if (Array.isArray(src) && src.length > 0) { mentionedJids = src; break; }
              }
              recordSecretaryEvent({
                organizationId: connection.organization_id,
                provider: 'uazapi',
                messageId: message.messageId || null,
                conversationId: persistence.conversationId,
                groupName: message.groupName || 'Grupo',
                senderName: message.senderName || 'Desconhecido',
                stage: 'webhook_received',
                message: `Mensagem de grupo recebida via UAZAPI`,
                details: {
                  content: String(message.content || '').slice(0, 200),
                  mentioned: mentionedJids,
                },
              });
              analyzeGroupMessage({
                organizationId: connection.organization_id,
                conversationId: persistence.conversationId,
                messageContent: message.content,
                senderName: message.senderName || 'Desconhecido',
                senderPhone: message.phone || null,
                groupName: message.groupName || 'Grupo',
                mentionedJids,
                messageId: message.messageId || null,
                provider: 'uazapi',
              }).catch(err => console.error('[UAZAPI][GroupSecretary] Error:', err.message));
            } catch (gsErr) {
              console.error('[UAZAPI][GroupSecretary] Setup error:', gsErr.message);
              recordSecretaryEvent({
                organizationId: connection.organization_id,
                provider: 'uazapi',
                stage: 'error', level: 'error',
                message: 'Erro na preparação da análise (UAZAPI)',
                error: gsErr?.message || String(gsErr),
              });
            }
          }

          let flowHandled = false;
          if (message.content && typeof message.content === 'string') {
            console.log(`[UAZAPI Webhook] Attempting to continue flow for conversation ${persistence.conversationId}`);
            const cont = await continueActiveFlow(persistence.conversationId, message.content);
            console.log(`[UAZAPI Webhook] Flow continuation result: ${cont.continued ? 'Success' : 'Not continued'}`);
            flowHandled = !!cont.continued;
            
            if (!cont.continued) {
              flowHandled = await checkAndTriggerFlow(connection, persistence.conversationId, message.content);
            }
          }

          if (!flowHandled) {
            const aiSupportedTypes = ['text', 'image', 'audio', 'video', 'document', 'sticker'];
            if (aiSupportedTypes.includes(message.messageType) && (message.content || message.mediaUrl)) {
              processIncomingWithAgent({
                connection,
                conversationId: persistence.conversationId,
                contactPhone: message.phone || message.chatId,
                contactName: message.senderName || message.phone || 'Contato',
                messageContent: message.content,
                messageType: message.messageType,
                mediaUrl: message.mediaUrl || null,
                mediaMimetype: message.mediaMimetype || null,
                mediaFilename: message.originalFilename || null,
              }).then(result => {
                if (result.handled) {
                  console.log('[UAZAPI] AI Agent handled message, agent:', result.agentId, 'type:', message.messageType);
                }
              }).catch(err => {
                console.error('[UAZAPI] AI Agent processing error:', err.message);
              });
            }
          }
        }
      }
    } catch (flowErr) {
      console.error('[UAZAPI Webhook] Flow handling error:', flowErr);
    }

    res.status(200).json({ received: true, processed: eventType, persistence });
  } catch (error) {
    console.error('[UAZAPI Webhook] Error:', error);
    res.status(200).json({ received: true, error: error.message });
  }
}

router.post('/webhook', async (req, res) => {
  return handleWebhook(req, res);
});

router.post('/webhook/:event/:messageType?', async (req, res) => {
  return handleWebhook(req, res, {
    event: req.params.event,
    messageType: req.params.messageType,
  });
});

/**
 * Eventos diagnósticos (apenas leitura)
 */
router.get('/events', (req, res) => {
  const { instanceId, connectionId, limit } = req.query;
  res.json({ events: uazapiProvider.getUazapiEvents({ instanceId, connectionId, limit: Number(limit) || 100 }) });
});

router.delete('/events', (req, res) => {
  const { instanceId, connectionId } = req.query;
  uazapiProvider.clearUazapiEvents({ instanceId, connectionId });
  res.json({ cleared: true });
});

/**
 * Helper: carrega conexão UAZAPI por id
 */
async function loadUazapiConnection(connectionId) {
  const r = await query(
    `SELECT * FROM connections WHERE id = $1 AND provider = 'uazapi' LIMIT 1`,
    [connectionId]
  );
  return r.rows[0] || null;
}

/**
 * Lista chats sincronizados pela instância UAZAPI
 * GET /api/uazapi/:connectionId/chats?limit=200
 */
router.get('/:connectionId/chats', async (req, res) => {
  try {
    const conn = await loadUazapiConnection(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Conexão UAZAPI não encontrada' });
    const out = await uazapiProvider.syncChats(conn.uazapi_url, conn.uazapi_token, {
      limit: Number(req.query.limit) || 200,
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Sincroniza mensagens de um chat (UAZAPI)
 * POST /api/uazapi/:connectionId/sync-messages  body: { chatId, limit? }
 */
router.post('/:connectionId/sync-messages', authenticate, async (req, res) => {
  try {
    const connResult = await query(
      'SELECT * FROM connections WHERE id = $1 AND (user_id = $2 OR organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = $2))',
      [req.params.connectionId, req.userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada ou sem permissão' });
    }

    const conn = connResult.rows[0];
    const { chatId, limit } = req.body || {};
    if (!chatId) return res.status(400).json({ error: 'chatId obrigatório' });
    
    const syncLimit = Number(limit) || 100;
    const out = await uazapiProvider.syncMessages(conn.uazapi_url, conn.uazapi_token, chatId, {
      limit: syncLimit,
    });

    if (out.success && Array.isArray(out.messages)) {
      console.log(`[UAZAPI Sync] Sincronizando ${out.messages.length} mensagens para ${chatId}`);
      let imported = 0;
      let skipped = 0;

      for (const msg of out.messages) {
        try {
          const result = await persistIncomingMessage(conn, msg);
          if (result.skipped) skipped++;
          else imported++;
        } catch (err) {
          console.error('[UAZAPI Sync] Erro ao persistir mensagem:', err.message);
          skipped++;
        }
      }

      // Update conversation last_message_at
      await query(
        `UPDATE conversations SET last_message_at = (
          SELECT MAX(timestamp) FROM chat_messages WHERE conversation_id IN (
            SELECT id FROM conversations WHERE connection_id = $1 AND remote_jid = $2
          )
        ), updated_at = NOW() WHERE connection_id = $1 AND remote_jid = $2`,
        [conn.id, chatId]
      );

      return res.json({
        success: true,
        imported,
        skipped,
        total: out.messages.length,
        message: `Sincronização concluída: ${imported} novas mensagens importadas.`
      });
    }

    res.json(out);
  } catch (e) {
    console.error('[UAZAPI Sync] Erro geral:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * Envia BOTÕES interativos (UAZAPI exclusivo)
 */
router.post('/:connectionId/send-buttons', async (req, res) => {
  try {
    const conn = await loadUazapiConnection(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Conexão UAZAPI não encontrada' });
    const { phone, text, buttons, footer, header, image } = req.body || {};
    if (!phone || !text || !Array.isArray(buttons)) {
      return res.status(400).json({ error: 'phone, text e buttons[] são obrigatórios' });
    }
    const out = await uazapiProvider.sendButtons(conn.uazapi_url, conn.uazapi_token, phone, text, buttons, { footer, header, image });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Envia LISTA interativa (UAZAPI exclusivo)
 */
router.post('/:connectionId/send-list', async (req, res) => {
  try {
    const conn = await loadUazapiConnection(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Conexão UAZAPI não encontrada' });
    const { phone, text, options, buttonText, footer, sections } = req.body || {};
    if (!phone || !text) return res.status(400).json({ error: 'phone e text são obrigatórios' });
    const out = await uazapiProvider.sendList(conn.uazapi_url, conn.uazapi_token, phone, text, options || [], { buttonText, footer, sections });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Envia ENQUETE (poll) (UAZAPI exclusivo)
 */
router.post('/:connectionId/send-poll', async (req, res) => {
  try {
    const conn = await loadUazapiConnection(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Conexão UAZAPI não encontrada' });
    const { phone, question, options, multiSelect } = req.body || {};
    if (!phone || !question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'phone, question e ao menos 2 options são obrigatórios' });
    }
    const out = await uazapiProvider.sendPoll(conn.uazapi_url, conn.uazapi_token, phone, question, options, { multiSelect: !!multiSelect });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Lista contatos do celular sincronizados pelo WhatsApp (UAZAPI)
 * GET /api/uazapi/:connectionId/contacts?search=&limit=
 */
router.get('/:connectionId/contacts', async (req, res) => {
  try {
    const conn = await loadUazapiConnection(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Conexão UAZAPI não encontrada' });
    const out = await uazapiProvider.listContacts(conn.uazapi_url, conn.uazapi_token, {
      limit: Number(req.query.limit) || undefined,
      search: req.query.search || undefined,
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Importa contatos do celular UAZAPI para uma lista do sistema
 * POST /api/uazapi/:connectionId/sync-contacts-to-list
 * body: { listId, onlyMyContacts?, search? }
 */
router.post('/:connectionId/sync-contacts-to-list', async (req, res) => {
  try {
    const conn = await loadUazapiConnection(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Conexão UAZAPI não encontrada' });
    const { listId, onlyMyContacts = true, search } = req.body || {};
    if (!listId) return res.status(400).json({ error: 'listId obrigatório' });

    // Verifica se a lista pertence ao usuário/org
    const listCheck = await query(`SELECT id, user_id FROM contact_lists WHERE id = $1 LIMIT 1`, [listId]);
    if (!listCheck.rows.length) return res.status(404).json({ error: 'Lista não encontrada' });

    const out = await uazapiProvider.listContacts(conn.uazapi_url, conn.uazapi_token, { search });
    if (!out.success) return res.status(502).json(out);

    const filtered = onlyMyContacts ? out.contacts.filter((c) => c.isMyContact) : out.contacts;

    let imported = 0;
    let duplicates = 0;
    for (const c of filtered) {
      try {
        const exists = await query(
          `SELECT id FROM contacts WHERE list_id = $1 AND phone = $2 LIMIT 1`,
          [listId, c.phone]
        );
        if (exists.rows.length) {
          duplicates++;
          continue;
        }
        await query(
          `INSERT INTO contacts (list_id, name, phone, is_whatsapp) VALUES ($1, $2, $3, true)`,
          [listId, c.name || c.phone, c.phone]
        );
        imported++;
      } catch {
        // ignora erros individuais
      }
    }
    res.json({ success: true, total: filtered.length, imported, duplicates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * SENDER - Cria campanha de disparo em massa nativa UAZAPI
 * POST /api/uazapi/:connectionId/sender
 * body: { numbers[], type, text?, file?, delayMin?, delayMax?, scheduled_for?, info?, docName? }
 */
router.post('/:connectionId/sender', async (req, res) => {
  try {
    const conn = await loadUazapiConnection(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Conexão UAZAPI não encontrada' });
    const out = await uazapiProvider.senderCreate(conn.uazapi_url, conn.uazapi_token, req.body || {});
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * SENDER - Lista pastas/campanhas
 */
router.get('/:connectionId/sender/folders', async (req, res) => {
  try {
    const conn = await loadUazapiConnection(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Conexão UAZAPI não encontrada' });
    const out = await uazapiProvider.senderListFolders(conn.uazapi_url, conn.uazapi_token);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * SENDER - Lista mensagens de uma pasta
 */
router.get('/:connectionId/sender/folders/:folderId/messages', async (req, res) => {
  try {
    const conn = await loadUazapiConnection(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Conexão UAZAPI não encontrada' });
    const out = await uazapiProvider.senderListMessages(conn.uazapi_url, conn.uazapi_token, req.params.folderId, {
      status: req.query.status || undefined,
      limit: Number(req.query.limit) || 500,
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * SENDER - Pause/Resume/Stop/Delete uma pasta
 * POST /api/uazapi/:connectionId/sender/folders/:folderId/action  body: { action }
 */
router.post('/:connectionId/sender/folders/:folderId/action', async (req, res) => {
  try {
    const conn = await loadUazapiConnection(req.params.connectionId);
    if (!conn) return res.status(404).json({ error: 'Conexão UAZAPI não encontrada' });
    const { action } = req.body || {};
    if (!['play', 'pause', 'stop', 'delete'].includes(action)) {
      return res.status(400).json({ error: 'action deve ser play|pause|stop|delete' });
    }
    const out = await uazapiProvider.senderEdit(conn.uazapi_url, conn.uazapi_token, req.params.folderId, action);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Sincroniza nomes reais dos contatos para conversas existentes (UAZAPI).
 * Busca contatos da agenda do WhatsApp via /contacts/list e atualiza
 * conversations.contact_name por correspondência dos últimos 9 dígitos do telefone.
 * NÃO altera grupos.
 * POST /api/uazapi/:connectionId/resync-contact-names
 * body: { dryRun?: boolean, overwrite?: boolean }
 *   - overwrite=true substitui qualquer nome (default true: corrige nomes errados antigos)
 *   - overwrite=false só preenche quando o nome atual parece ser um telefone
 */
router.post('/:connectionId/resync-contact-names', authenticate, async (req, res) => {
  try {
    const connResult = await query(
      'SELECT * FROM connections WHERE id = $1 AND (user_id = $2 OR organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = $2))',
      [req.params.connectionId, req.userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada ou sem permissão' });
    }

    const conn = connResult.rows[0];
    const parsedBody = typeof req.body === 'string'
      ? (() => {
          try {
            return JSON.parse(req.body);
          } catch {
            return {};
          }
        })()
      : (req.body || {});
    const dryRun = !!parsedBody?.dryRun;
    const overwrite = parsedBody?.overwrite !== false; // default true

    const allContacts = [];
    const seenJids = new Set();
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const out = await uazapiProvider.listContacts(conn.uazapi_url, conn.uazapi_token, {
        limit: pageSize,
        offset,
        contactScope: 'address_book',
      });

      if (!out.success) {
        const status = /HTTP 400/.test(String(out.error || '')) ? 400 : 502;
        return res.status(status).json({ error: out.error || 'Falha ao listar contatos' });
      }

      const pageContacts = Array.isArray(out.contacts) ? out.contacts : [];
      for (const contact of pageContacts) {
        const dedupeKey = contact.jid || `${contact.phone}`;
        if (seenJids.has(dedupeKey)) continue;
        seenJids.add(dedupeKey);
        allContacts.push(contact);
      }

      if (pageContacts.length < pageSize) break;
      offset += pageSize;
    }

    // Mapa: últimos 9 dígitos -> melhor nome encontrado
    const map = new Map();
    for (const c of allContacts) {
      if (!c.phone || !c.name) continue;
      const key = c.phone.slice(-9);
      const name = String(c.name).trim();
      if (!name || /^\+?\d[\d\s\-()]*$/.test(name)) continue; // pula nomes que são só números
      const prev = map.get(key);
      // prefere isMyContact e nome mais longo
      if (!prev || (c.isMyContact && !prev.isMyContact) || name.length > prev.name.length) {
        map.set(key, { name, isMyContact: !!c.isMyContact });
      }
    }

    // Carrega conversas individuais (não-grupo) desta conexão
    const convs = await query(
      `SELECT id, contact_phone, contact_name FROM conversations
       WHERE connection_id = $1 AND COALESCE(is_group, false) = false`,
      [conn.id]
    );

    let updated = 0;
    let skipped = 0;
    const samples = [];
    for (const row of convs.rows) {
      const phone = String(row.contact_phone || '').replace(/\D/g, '');
      if (phone.length < 9) { skipped++; continue; }
      const key = phone.slice(-9);
      const hit = map.get(key);
      if (!hit) { skipped++; continue; }
      if (hit.name === row.contact_name) { skipped++; continue; }

      // Se overwrite=false só atualiza quando o nome atual é um telefone
      if (!overwrite) {
        const cur = String(row.contact_name || '').trim();
        const looksLikePhone = !cur || /^\+?\d[\d\s\-()]*$/.test(cur);
        if (!looksLikePhone) { skipped++; continue; }
      }

      if (samples.length < 20) {
        samples.push({ phone, from: row.contact_name, to: hit.name });
      }
      if (!dryRun) {
        await query(`UPDATE conversations SET contact_name = $1 WHERE id = $2`, [hit.name, row.id]);
      }
      updated++;
    }

    res.json({
      success: true,
      dryRun,
      overwrite,
      contactsLoaded: allContacts.length,
      conversationsScanned: convs.rows.length,
      updated,
      skipped,
      samples,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:connectionId/check-number', authenticate, async (req, res) => {
  const { connectionId } = req.params;
  const { phone } = req.body;
  
  if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório' });

  try {
    const result = await query('SELECT uazapi_url, uazapi_token FROM connections WHERE id = $1', [connectionId]);
    const conn = result?.rows?.[0];
    if (!conn) return res.status(404).json({ error: 'Conexão não encontrada' });

    const exists = await uazapiProvider.checkNumber(conn.uazapi_url, conn.uazapi_token, phone);
    res.json({ exists });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:connectionId/validate-numbers', authenticate, async (req, res) => {
  const { connectionId } = req.params;
  const { phones } = req.body;
  
  if (!Array.isArray(phones)) return res.status(400).json({ error: 'Lista de telefones inválida' });

  try {
    const result = await query('SELECT uazapi_url, uazapi_token FROM connections WHERE id = $1', [connectionId]);
    const conn = result?.rows?.[0];
    if (!conn) return res.status(404).json({ error: 'Conexão não encontrada' });

    const results = await uazapiProvider.checkNumbers(conn.uazapi_url, conn.uazapi_token, phones);
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
