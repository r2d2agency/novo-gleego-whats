import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { getSendAttempts, clearSendAttempts, getEndpointDiscoveryAttempts, clearEndpointDiscoveryAttempts, downloadMedia as wapiDownloadMedia, getChats as wapiGetChats, getGroupInfo as wapiGetGroupInfo, getGroups as wapiGetGroups, fetchContacts as wapiFetchContacts, getChatMessages as wapiGetChatMessages, getProfilePicture as wapiGetProfilePicture, checkNumbersBulk as wapiCheckNumbersBulk } from '../lib/wapi-provider.js';
import { executeFlow, continueFlowWithInput } from '../lib/flow-executor.js';
import { pauseNurturingOnReply } from './nurturing.js';
import { emitLeadEvent } from '../lib/event-bus.js';
import { processIncomingWithAgent } from '../lib/ai-agent-processor.js';
import { analyzeGroupMessage } from '../lib/group-secretary.js';
import { handleAutoReplies } from '../lib/auto-reply-service.js';
import { sendPushToOrgUsers } from './push.js';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import https from 'https';

const router = Router();

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const API_BASE_URL = process.env.API_BASE_URL || '';

// In-memory webhook event buffer for diagnostics only (not persisted)
const WEBHOOK_EVENTS_MAX = 200;
const webhookEvents = []; // { at, connectionId, instanceId, eventType, headers, preview }

function safeHeaders(req) {
  const h = req.headers || {};
  const out = {};
  const pick = (k) => {
    const v = h?.[k];
    if (v === undefined || v === null) return;
    out[k] = Array.isArray(v) ? v.join(', ') : String(v);
  };
  // Store only non-sensitive headers
  pick('user-agent');
  pick('content-type');
  pick('x-forwarded-for');
  pick('x-real-ip');
  pick('host');
  return out;
}

function pushWebhookEvent({ connectionId, instanceId, eventType, req, payload }) {
  webhookEvents.unshift({
    at: new Date().toISOString(),
    connectionId: connectionId || null,
    instanceId: instanceId || null,
    eventType: eventType || null,
    headers: safeHeaders(req),
    preview: JSON.stringify(payload).slice(0, 900),
  });
  if (webhookEvents.length > WEBHOOK_EVENTS_MAX) webhookEvents.length = WEBHOOK_EVENTS_MAX;
}

async function getAccessibleConnection(connectionId, userId) {
  const result = await query(
    `SELECT c.*
     FROM connections c
     LEFT JOIN organization_members om
       ON om.organization_id = c.organization_id AND om.user_id = $2
     WHERE c.id = $1 AND (c.user_id = $2 OR om.id IS NOT NULL)
     LIMIT 1`,
    [connectionId, userId]
  );
  return result.rows[0] || null;
}

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function isAbsoluteUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

function normalizeUploadsUrl(u) {
  if (!u || typeof u !== 'string') return null;
  const s = u.trim();
  if (!s) return null;
  if (isAbsoluteUrl(s) || /^data:/i.test(s) || /^blob:/i.test(s)) return s;
  if (s.startsWith('/')) return `${API_BASE_URL}${s}`;
  return `${API_BASE_URL}/${s}`;
}

function digitsOnly(value) {
  const digits = String(value || '').replace(/@.*$/, '').replace(/\D/g, '');
  return digits || null;
}

async function findExistingConversationForWapi(connectionId, remoteJid, cleanPhone, isGroup) {
  let conversationResult = await query(
    `SELECT id, remote_jid, contact_phone FROM conversations WHERE connection_id = $1 AND remote_jid = $2 LIMIT 1`,
    [connectionId, remoteJid]
  );

  if (conversationResult.rows.length === 0 && !isGroup && cleanPhone) {
    // Provider JIDs can flip between @s.whatsapp.net, @lid and plain phone.
    // Match individual contacts by the project rule: last 9 digits.
    conversationResult = await query(
      `SELECT id, remote_jid, contact_phone FROM conversations
       WHERE connection_id = $1
         AND COALESCE(is_group, false) = false
         AND RIGHT(REGEXP_REPLACE(COALESCE(contact_phone, remote_jid, ''), '\\D', '', 'g'), 9) = RIGHT($2, 9)
       ORDER BY last_message_at DESC NULLS LAST, updated_at DESC NULLS LAST
       LIMIT 1`,
      [connectionId, cleanPhone]
    );

    if (conversationResult.rows.length > 0) {
      await query(
        `UPDATE conversations
         SET remote_jid = $1,
             contact_phone = COALESCE(NULLIF(contact_phone, ''), $2),
             updated_at = NOW()
         WHERE id = $3`,
        [remoteJid, cleanPhone, conversationResult.rows[0].id]
      );
    }
  }

  return conversationResult;
}

function extFromMime(mime) {
  if (!mime) return null;
  const m = String(mime).split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/csv': 'csv',
    'application/zip': 'zip',
    'application/x-zip-compressed': 'zip',
    'application/x-rar-compressed': 'rar',
    'application/octet-stream': null,
  };
  return map[m] !== undefined ? map[m] : null;
}

function extFromUrl(u) {
  try {
    const url = new URL(u);
    const ext = path.extname(url.pathname || '').replace('.', '').toLowerCase();
    return ext || null;
  } catch {
    return null;
  }
}

function defaultExtByType(messageType) {
  if (messageType === 'image') return 'jpg';
  if (messageType === 'video') return 'mp4';
  if (messageType === 'audio') return 'ogg';
  if (messageType === 'sticker') return 'webp';
  if (messageType === 'document') return 'bin';
  return 'bin';
}

function buildUploadsPublicUrl(filename) {
  return `${API_BASE_URL}/uploads/${filename}`;
}

async function writeDataUrlToUploads(dataUrl, messageType, hintedMime) {
  const m = String(dataUrl).match(/^data:([^;,]+)?;base64,(.*)$/i);
  if (!m) throw new Error('Invalid data URL');
  const mime = (m[1] || hintedMime || '').trim() || null;
  const base64 = m[2] || '';
  const buf = Buffer.from(base64, 'base64');

  const ext = extFromMime(mime) || defaultExtByType(messageType);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);
  await fs.promises.writeFile(filePath, buf);

  return { publicUrl: buildUploadsPublicUrl(filename), mime };
}

// Timeouts for media download (large WhatsApp files like PPTX/videos can take >30s)
const MEDIA_DOWNLOAD_TIMEOUT_MS = 180000; // 3 minutes per request
const MEDIA_MAX_BYTES = 250 * 1024 * 1024; // 250 MB hard cap

function downloadToUploads(url, messageType, hintedMime, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;

    console.log('[W-API Media] Attempting download:', url.slice(0, 200));

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': 'Whatsale/1.0',
          'Accept': '*/*',
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        console.log('[W-API Media] Download response:', status);

        // Redirect handling
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          res.headers.location &&
          redirectCount < 3
        ) {
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(downloadToUploads(nextUrl, messageType, hintedMime, redirectCount + 1));
        }

        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${status}`));
        }

        const headerMime = String(res.headers['content-type'] || '').split(';')[0].trim();
        const mime = headerMime || hintedMime || null;

        // --- sniff first bytes to avoid saving decrypted media as .enc (WhatsApp CDN) ---
        let head = Buffer.alloc(0);
        const onData = (chunk) => {
          try {
            if (head.length >= 64) return;
            const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const need = 64 - head.length;
            head = Buffer.concat([head, b.slice(0, need)]);
          } catch {
            // ignore
          }
        };
        res.on('data', onData);

        const sniffExt = () => {
          const b = head;
          if (!b || b.length < 12) return null;

          // JPEG
          if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
          // PNG
          if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
          // GIF
          if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
          // WEBP (RIFF....WEBP)
          if (
            b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
            b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
          ) return 'webp';
          // PDF
          if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
          // OGG
          if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg';
          // MP4/QuickTime: ....ftyp
          if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'mp4';
          // ZIP-based (xlsx, docx, pptx, zip) - PK\x03\x04
          if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
            // These are all ZIP-based; rely on mime/hintedMime to distinguish
            const h = (hintedMime || mime || '').toLowerCase();
            if (h.includes('spreadsheetml') || h.includes('ms-excel')) return 'xlsx';
            if (h.includes('wordprocessingml') || h.includes('msword')) return 'docx';
            if (h.includes('presentationml') || h.includes('powerpoint') || h.includes('ms-powerpoint')) return 'pptx';
            return 'zip';
          }
          // MS Compound (old .xls, .doc, .ppt) - D0 CF 11 E0
          if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
            const h = (hintedMime || mime || '').toLowerCase();
            if (h.includes('excel') || h.includes('ms-excel')) return 'xls';
            if (h.includes('powerpoint') || h.includes('ms-powerpoint')) return 'ppt';
            return 'doc';
          }

          return null;
        };

        const mimeFromExt = (ext) => {
          const map = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            pdf: 'application/pdf',
            ogg: 'audio/ogg',
            mp4: 'video/mp4',
            xls: 'application/vnd.ms-excel',
            xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ppt: 'application/vnd.ms-powerpoint',
            pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            csv: 'text/csv',
            txt: 'text/plain',
            zip: 'application/zip',
            rar: 'application/x-rar-compressed',
          };
          return map[ext] || null;
        };

        // Write to a temporary file first, then rename with the correct extension
        const tmpName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.tmp`;
        const tmpPath = path.join(UPLOADS_DIR, tmpName);
        const fileStream = fs.createWriteStream(tmpPath);

        res.pipe(fileStream);

        fileStream.on('finish', async () => {
          try {
            fileStream.close(() => {
              const sniffed = sniffExt();
              const ext = extFromMime(mime) || sniffed || defaultExtByType(messageType);
              const finalName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
              const finalPath = path.join(UPLOADS_DIR, finalName);

              try {
                fs.renameSync(tmpPath, finalPath);
              } catch (e) {
                // fallback: keep temp file if rename fails
                console.error('[W-API Media] Rename failed:', e?.message || e);
                return resolve({ publicUrl: buildUploadsPublicUrl(tmpName), mime: mime || hintedMime || null });
              }

              const finalMime = mimeFromExt(ext) || mime || hintedMime || null;
              console.log('[W-API Media] Downloaded successfully:', finalName, 'mime:', finalMime);
              resolve({ publicUrl: buildUploadsPublicUrl(finalName), mime: finalMime });
            });
          } catch (err) {
            console.error('[W-API Media] Finish handler error:', err?.message || err);
            return resolve({ publicUrl: buildUploadsPublicUrl(tmpName), mime: mime || hintedMime || null });
          }
        });

        fileStream.on('error', (err) => {
          res.resume();
          reject(err);
        });
      }
    );

    req.on('error', (err) => {
      console.error('[W-API Media] Download error:', err.message);
      reject(err);
    });
    req.setTimeout(MEDIA_DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error('Timeout downloading media'));
    });
  });
}

function shouldCacheExternally(mediaUrl) {
  if (!mediaUrl || typeof mediaUrl !== 'string') return false;
  const u = mediaUrl.trim();
  if (!u) return false;
  if (/^data:/i.test(u)) return true;
  // Se já é do nosso /uploads, não precisa cachear
  if (u.startsWith(`${API_BASE_URL}/uploads/`)) return false;
  // URLs externas: cachear para evitar expiração/CORS
  return isAbsoluteUrl(u);
}

function isWhatsAppCdnUrl(url) {
  if (!url) return false;
  return url.includes('mmg.whatsapp.net') || url.includes('media.whatsapp.net');
}

function withTimeout(promise, ms, label = 'timeout') {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function sniffExtFromBuffer(buf) {
  if (!buf || buf.length < 12) return null;

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  // WEBP (RIFF....WEBP)
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'webp';
  // PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';
  // OGG
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'ogg';
  // MP4/QuickTime: ....ftyp
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'mp4';
  // ZIP-based (xlsx, docx, pptx, zip) - PK\x03\x04
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  // MS Compound (old .xls, .doc, .ppt) - D0 CF 11 E0
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'doc';

  return null;
}

async function writeBufferToUploads(buf, messageType, hintedMime) {
  const ext = extFromMime(hintedMime) || sniffExtFromBuffer(buf) || defaultExtByType(messageType);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);
  await fs.promises.writeFile(filePath, buf);
  return { publicUrl: buildUploadsPublicUrl(filename), mime: hintedMime || null };
}

function downloadToBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': 'Whatsale/1.0',
          'Accept': '*/*',
        },
      },
      (res) => {
        const status = res.statusCode || 0;

        if (
          [301, 302, 303, 307, 308].includes(status) &&
          res.headers.location &&
          redirectCount < 3
        ) {
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(downloadToBuffer(nextUrl, redirectCount + 1));
        }

        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${status}`));
        }

        const contentType = String(res.headers['content-type'] || '').split(';')[0].trim() || null;
        const contentLength = parseInt(res.headers['content-length'] || '0', 10);
        if (contentLength && contentLength > MEDIA_MAX_BYTES) {
          res.resume();
          return reject(new Error(`Media too large: ${contentLength} bytes (max ${MEDIA_MAX_BYTES})`));
        }
        const chunks = [];
        let total = 0;
        let lastLogged = 0;

        res.on('data', (c) => {
          const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
          total += buf.length;
          if (total > MEDIA_MAX_BYTES) {
            res.destroy(new Error(`Media exceeded max size ${MEDIA_MAX_BYTES}`));
            return;
          }
          chunks.push(buf);
          // Log progress every 5MB for large downloads
          if (total - lastLogged > 5 * 1024 * 1024) {
            lastLogged = total;
            console.log(`[W-API Media] Downloading... ${(total / 1024 / 1024).toFixed(1)} MB`);
          }
        });
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType }));
        res.on('error', (err) => reject(err));
      }
    );

    req.on('error', (err) => reject(err));
    req.setTimeout(MEDIA_DOWNLOAD_TIMEOUT_MS, () => req.destroy(new Error('Timeout downloading media')));
  });
}

function decryptWhatsAppEncMedia(encBuffer, mediaKeyBase64, messageType) {
  if (!encBuffer || encBuffer.length < 32) throw new Error('Encrypted buffer too small');
  if (!mediaKeyBase64) throw new Error('Missing mediaKey');

  const infoByType = {
    image: 'WhatsApp Image Keys',
    video: 'WhatsApp Video Keys',
    audio: 'WhatsApp Audio Keys',
    document: 'WhatsApp Document Keys',
    sticker: 'WhatsApp Image Keys',
  };

  const info = infoByType[messageType] || infoByType.image;

  const mediaKey = Buffer.from(String(mediaKeyBase64).trim(), 'base64');
  if (!mediaKey || mediaKey.length < 32) throw new Error('Invalid mediaKey');

  // HKDF -> 112 bytes: iv(16) + cipherKey(32) + macKey(32) + refKey(32)
  const expanded = crypto.hkdfSync(
    'sha256',
    mediaKey,
    Buffer.alloc(32, 0),
    Buffer.from(info),
    112
  );

  const iv = Buffer.from(expanded.slice(0, 16));
  const cipherKey = Buffer.from(expanded.slice(16, 48));
  const macKey = Buffer.from(expanded.slice(48, 80));

  const mac = encBuffer.slice(encBuffer.length - 10);
  const ciphertext = encBuffer.slice(0, encBuffer.length - 10);

  const computedMac = crypto
    .createHmac('sha256', macKey)
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
    .slice(0, 10);

  if (!crypto.timingSafeEqual(mac, computedMac)) {
    throw new Error('Media MAC mismatch (encrypted data or wrong key)');
  }

  const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function cacheMedia({ messageId, mediaUrl, messageType, mediaMimetype, connection, waMediaKey }) {
  const raw = mediaUrl;

  try {
    // WhatsApp CDN URLs are encrypted .enc; if we have mediaKey, decrypt ourselves.
    if (isWhatsAppCdnUrl(raw) && waMediaKey) {
      console.log('[W-API Cache] WhatsApp CDN + mediaKey -> downloading encrypted and decrypting...');
      const { buffer: encBuf, contentType } = await downloadToBuffer(raw);
      const decBuf = decryptWhatsAppEncMedia(encBuf, waMediaKey, messageType);
      const ext = sniffExtFromBuffer(decBuf);
      console.log('[W-API Cache] Decrypted media ok. ext:', ext, 'encBytes:', encBuf.length, 'decBytes:', decBuf.length, 'encCT:', contentType);
      return await writeBufferToUploads(decBuf, messageType, mediaMimetype);
    }

    // If it's a WhatsApp CDN URL and we don't have mediaKey, try W-API download endpoint (best effort)
    if (isWhatsAppCdnUrl(raw) && connection?.instance_id && connection?.wapi_token) {
      console.log('[W-API Cache] WhatsApp CDN URL detected, using W-API download endpoint...');

      const downloadResult = await wapiDownloadMedia(connection.instance_id, connection.wapi_token, messageId);

      if (downloadResult.success && downloadResult.base64) {
        console.log('[W-API Cache] Downloaded via W-API, saving to uploads...');
        return await writeDataUrlToUploads(downloadResult.base64, messageType, downloadResult.mimetype || mediaMimetype);
      }

      if (downloadResult.success && downloadResult.url) {
        console.log('[W-API Cache] Got new URL from W-API, downloading...');
        return await downloadToUploads(downloadResult.url, messageType, downloadResult.mimetype || mediaMimetype);
      }

      console.error('[W-API Cache] W-API download failed:', downloadResult.error);
      return null;
    }

    if (/^data:/i.test(raw)) {
      console.log('[W-API Cache] Processing as data URL (base64)');
      return await writeDataUrlToUploads(raw, messageType, mediaMimetype);
    }

    console.log('[W-API Cache] Processing as HTTP URL');
    return await downloadToUploads(raw, messageType, mediaMimetype);
  } catch (err) {
    console.error('[W-API Cache] cacheMedia failed:', err?.message || err, 'Original URL:', String(mediaUrl).slice(0, 200));
    return null;
  }
}

async function cacheMediaAndUpdateMessage({ messageId, mediaUrl, messageType, mediaMimetype, connection, waMediaKey }) {
  console.log('[W-API Cache] Starting media cache for:', messageId, 'URL:', String(mediaUrl).slice(0, 200));

  const cached = await cacheMedia({ messageId, mediaUrl, messageType, mediaMimetype, connection, waMediaKey });
  if (!cached?.publicUrl) return;

  try {
    await query(
      `UPDATE chat_messages
       SET media_url = $1,
           media_mimetype = COALESCE($2, media_mimetype)
       WHERE message_id = $3`,
      [cached.publicUrl, cached.mime, messageId]
    );

    console.log('[W-API Cache] Successfully cached:', cached.publicUrl);
  } catch (err) {
    console.error('[W-API Cache] Failed to update message media_url:', err?.message || err);
  }
}

// When W-API webhook does not include a direct media URL (common for outgoing from phone),
// fetch the media by messageId via W-API and persist in /uploads.
async function cacheMediaFromWapiDownload({ messageId, messageType, mediaMimetype, connection }) {
  try {
    if (!connection?.instance_id || !connection?.wapi_token) return null;
    if (!messageId) return null;

    const downloadResult = await wapiDownloadMedia(connection.instance_id, connection.wapi_token, messageId);

    if (downloadResult?.success && downloadResult.base64) {
      return await writeDataUrlToUploads(
        downloadResult.base64,
        messageType,
        downloadResult.mimetype || mediaMimetype
      );
    }

    if (downloadResult?.success && downloadResult.url) {
      return await downloadToUploads(
        downloadResult.url,
        messageType,
        downloadResult.mimetype || mediaMimetype
      );
    }

    return null;
  } catch (err) {
    console.error('[W-API Cache] cacheMediaFromWapiDownload failed:', err?.message || err);
    return null;
  }
}

/**
 * Extract instanceId from multiple possible W-API payload shapes
 */
function extractInstanceId(payload) {
  const value =
    payload?.instanceId ||
    payload?.instance_id ||
    payload?.instance?.id ||
    payload?.instance?.instanceId ||
    payload?.data?.instanceId ||
    payload?.data?.instance_id ||
    payload?.data?.instance?.id ||
    payload?.result?.instanceId ||
    payload?.result?.instance_id ||
    payload?.instance ||
    null;

  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return null;
}

/**
 * Normalize W-API webhook payload to a flat shape consumed by handlers.
 * Some providers send data wrapped in payload/data/result objects.
 */
function normalizeWebhookPayload(rawPayload) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const nested = [source.payload, source.data, source.result, source.message, source.eventData]
    .find((v) => v && typeof v === 'object') || {};

  const merged = {
    ...nested,
    ...source,
    chat: source.chat || nested.chat || source.data?.chat || null,
    sender: source.sender || nested.sender || source.data?.sender || null,
    msgContent:
      source.msgContent ||
      nested.msgContent ||
      source.data?.msgContent ||
      nested.message ||
      source.message ||
      {},
  };

  // Keep top-level instance identifiers stable for connection lookup
  merged.instanceId =
    source.instanceId || source.instance_id || nested.instanceId || nested.instance_id || merged.instanceId || null;
  merged.instance_id =
    source.instance_id || source.instanceId || nested.instance_id || nested.instanceId || merged.instance_id || null;

  return merged;
}

/**
 * W-API Webhook handler
 * Receives messages from W-API instances
 * 
 * Configure in W-API panel:
 * - "Ao receber uma mensagem": https://your-backend/api/wapi/webhook
 */
router.post('/webhook', async (req, res) => {
  try {
    const payload = normalizeWebhookPayload(req.body);
    console.log('[W-API Webhook] Received:', JSON.stringify(payload).slice(0, 500));

    // W-API sends different payload structures depending on event type
    // Common fields: instanceId, phone, message, messageId, etc.
    const instanceId = extractInstanceId(payload);

    if (!instanceId) {
      console.log('[W-API Webhook] No instanceId in payload');
      pushWebhookEvent({ connectionId: null, instanceId: null, eventType: 'unknown', req, payload });
      return res.status(200).json({ received: true, skipped: 'no instanceId' });
    }

    // Detect event type from payload
    const eventType = detectEventType(payload);

    // Find connection by instance_id
    const connResult = await query(
      `SELECT c.*, om.organization_id
       FROM connections c
       LEFT JOIN organization_members om ON om.user_id = c.user_id
       WHERE LOWER(TRIM(c.instance_id)) = LOWER(TRIM($1)) AND c.wapi_token IS NOT NULL
       LIMIT 1`,
      [instanceId]
    );

    if (connResult.rows.length === 0) {
      console.log('[W-API Webhook] Connection not found for instance:', instanceId);
      pushWebhookEvent({ connectionId: null, instanceId, eventType, req, payload });
      return res.status(200).json({ received: true, skipped: 'connection not found' });
    }

    const connection = connResult.rows[0];

    pushWebhookEvent({ connectionId: connection.id, instanceId, eventType, req, payload });

    console.log('[W-API Webhook] Event type:', eventType, 'Instance:', instanceId, 'fromMe:', payload.fromMe, 'chat.id:', payload.chat?.id);

    switch (eventType) {
      case 'message_received':
        console.log('[W-API Webhook] Calling handleIncomingMessage...');
        await handleIncomingMessage(connection, payload);
        if (!payload.fromMe) {
          handleAutoReplies(connection, payload.chat?.id || payload.phone, payload.message?.text || payload.content || '').catch(err => {
            console.error('[W-API] Auto-reply error:', err.message);
          });
        }
        console.log('[W-API Webhook] handleIncomingMessage completed');
        break;
      case 'message_sent':
        await handleOutgoingMessage(connection, payload);
        break;
      case 'status_update':
        await handleStatusUpdate(connection, payload);
        break;
      case 'connection_update':
        await handleConnectionUpdate(connection, payload);
        break;
      default:
        console.log('[W-API Webhook] Unknown event type, payload:', JSON.stringify(payload).slice(0, 300));
    }

    res.status(200).json({ received: true, processed: eventType });
  } catch (error) {
    console.error('[W-API Webhook] Error:', error);
    // Always return 200 to prevent W-API from retrying
    res.status(200).json({ received: true, error: error.message });
  }
});

/**
 * Sync contacts from W-API getChats endpoint
 * This fetches all conversations and imports contacts into chat_contacts
 */
router.post('/:connectionId/sync-contacts', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId;

    const connection = await getAccessibleConnection(connectionId, userId);
    if (!connection) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    // Must be a W-API connection
    if (!connection.instance_id || !connection.wapi_token) {
      return res.status(400).json({ error: 'Esta conexão não é W-API' });
    }

    console.log(`[W-API] Starting contact sync for connection ${connectionId}`);

    // Try dedicated contacts endpoint first, fallback to getChats
    let result = await wapiFetchContacts(connection.instance_id, connection.wapi_token);
    if (!result.success || result.contacts.length === 0) {
      console.log('[W-API] fetchContacts returned 0, falling back to getChats');
      result = await wapiGetChats(connection.instance_id, connection.wapi_token);
    }

    if (!result.success) {
      console.error('[W-API] getChats failed:', result.error);
      return res.status(500).json({ error: result.error || 'Erro ao buscar contatos da W-API' });
    }

    const contacts = result.contacts || [];
    console.log(`[W-API] Fetched ${contacts.length} contacts from W-API`);

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const contact of contacts) {
      try {
        // Check if contact already exists
        const existing = await query(
          `SELECT id, name, is_deleted FROM chat_contacts WHERE connection_id = $1 AND phone = $2`,
          [connectionId, contact.phone]
        );

        if (existing.rows.length > 0) {
          const existingContact = existing.rows[0];
          // Update if name changed or was deleted
          if (existingContact.name !== contact.name || existingContact.is_deleted) {
            await query(
              `UPDATE chat_contacts SET name = $1, is_deleted = false, updated_at = NOW() WHERE id = $2`,
              [contact.name || contact.phone, existingContact.id]
            );
            updated++;
          } else {
            skipped++;
          }
        } else {
          // Insert new contact
          await query(
            `INSERT INTO chat_contacts (connection_id, phone, name, jid, profile_picture_url, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            [connectionId, contact.phone, contact.name || contact.phone, contact.jid || null, contact.profilePicture || null]
          );
          imported++;
        }
      } catch (err) {
        console.error('[W-API] Error importing contact:', contact.phone, err.message);
        skipped++;
      }
    }

    console.log(`[W-API] Contact sync complete: imported=${imported}, updated=${updated}, skipped=${skipped}`);

    res.json({
      success: true,
      total: contacts.length,
      imported,
      updated,
      skipped,
    });
  } catch (error) {
    console.error('[W-API] Contact sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Prepare conversation sync: fetch chat list and return total count
 */
router.post('/:connectionId/sync-conversations/prepare', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId;
    const connection = await getAccessibleConnection(connectionId, userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });
    if (!connection.instance_id || !connection.wapi_token) return res.status(400).json({ error: 'Esta conexão não é W-API' });

    const chatsResult = await wapiGetChats(connection.instance_id, connection.wapi_token);
    if (!chatsResult.success) return res.status(500).json({ error: chatsResult.error || 'Erro ao buscar conversas' });

    const allChats = chatsResult.contacts || [];
    if (!global._syncChatsCache) global._syncChatsCache = {};
    const syncId = `${connectionId}-${Date.now()}`;
    global._syncChatsCache[syncId] = { chats: allChats, connectionId, createdAt: Date.now() };

    // Cleanup old caches (>30 min)
    const now = Date.now();
    for (const key of Object.keys(global._syncChatsCache)) {
      if (now - global._syncChatsCache[key].createdAt > 30 * 60 * 1000) delete global._syncChatsCache[key];
    }

    res.json({ success: true, sync_id: syncId, total_chats: allChats.length });
  } catch (error) {
    console.error('[W-API] Conversation sync prepare error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Process a batch of chats for conversation sync
 */
router.post('/:connectionId/sync-conversations/batch', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId;
    const { sync_id, offset = 0, limit = 10 } = req.body;

    const connection = await getAccessibleConnection(connectionId, userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });
    if (!connection.instance_id || !connection.wapi_token) return res.status(400).json({ error: 'Esta conexão não é W-API' });

    const cache = global._syncChatsCache?.[sync_id];
    if (!cache) return res.status(400).json({ error: 'Sessão de sync expirada. Inicie novamente.' });

    const allChats = cache.chats;
    const batch = allChats.slice(offset, offset + limit);

    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const cutoffTimestamp = twoMonthsAgo.getTime();

    let conversationsCreated = 0, conversationsUpdated = 0, messagesImported = 0, messagesSkipped = 0, errors = 0;

    for (const chat of batch) {
      try {
        const remoteJid = chat.jid || `${chat.phone}@s.whatsapp.net`;
        const isGroup = remoteJid.includes('@g.us');

        const convResult = await query(
          `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone, is_group, last_message_at, created_at, updated_at, attendance_status)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW(), 'waiting')
           ON CONFLICT (connection_id, remote_jid) DO UPDATE SET
             contact_name = COALESCE(EXCLUDED.contact_name, conversations.contact_name), updated_at = NOW()
           RETURNING id, (xmax = 0) as is_new`,
          [connectionId, remoteJid, chat.name || chat.phone, chat.phone, isGroup]
        );

        const conversationId = convResult.rows[0]?.id;
        if (convResult.rows[0]?.is_new) conversationsCreated++;
        else conversationsUpdated++;
        if (!conversationId) continue;

        const msgsResult = await wapiGetChatMessages(connection.instance_id, connection.wapi_token, remoteJid);
        if (!msgsResult.success || !msgsResult.messages?.length) continue;

        for (const msg of msgsResult.messages) {
          try {
            let msgTimestamp = null;
            const rawTs = msg.timestamp || msg.messageTimestamp || msg.t || msg.createdAt;
            if (rawTs) {
              const ts = typeof rawTs === 'number' ? (rawTs > 1e12 ? rawTs : rawTs * 1000) : new Date(rawTs).getTime();
              if (!isNaN(ts)) msgTimestamp = ts;
            }
            if (msgTimestamp && msgTimestamp < cutoffTimestamp) { messagesSkipped++; continue; }
            const messageId = msg.id || msg.key?.id || msg.messageId || null;
            if (!messageId) { messagesSkipped++; continue; }
            const fromMe = msg.fromMe === true || msg.key?.fromMe === true || msg.from_me === true;
            const content = msg.body || msg.text || msg.message || msg.caption || msg.content || '';
            let messageType = 'text';
            if (msg.type) messageType = msg.type;
            else if (msg.hasMedia || msg.mediaUrl) messageType = msg.mediaType || 'document';
            const mediaUrl = msg.mediaUrl || msg.media || msg.fileUrl || null;

            const insertResult = await query(
              `INSERT INTO chat_messages (conversation_id, message_id, from_me, content, message_type, media_url, timestamp, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL AND message_id NOT LIKE 'temp_%' DO NOTHING
               RETURNING id`,
              [conversationId, messageId, fromMe, content, messageType, mediaUrl, msgTimestamp ? new Date(msgTimestamp) : new Date(), new Date()]
            );
            if (insertResult.rows.length > 0) messagesImported++;
            else messagesSkipped++;
          } catch { messagesSkipped++; }
        }

        await query(
          `UPDATE conversations SET last_message_at = (SELECT MAX(timestamp) FROM chat_messages WHERE conversation_id = $1), updated_at = NOW() WHERE id = $1`,
          [conversationId]
        );
      } catch (chatErr) {
        console.error(`[W-API] Error syncing chat ${chat.phone}:`, chatErr.message);
        errors++;
      }
    }

    const processed = Math.min(offset + limit, allChats.length);
    const done = processed >= allChats.length;
    if (done && global._syncChatsCache?.[sync_id]) delete global._syncChatsCache[sync_id];

    res.json({ success: true, processed, total: allChats.length, done, conversations_created: conversationsCreated, conversations_updated: conversationsUpdated, messages_imported: messagesImported, messages_skipped: messagesSkipped, errors });
  } catch (error) {
    console.error('[W-API] Conversation sync batch error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Legacy: full sync in one request
 */
router.post('/:connectionId/sync-conversations', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId;
    const connection = await getAccessibleConnection(connectionId, userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });
    if (!connection.instance_id || !connection.wapi_token) return res.status(400).json({ error: 'Esta conexão não é W-API' });

    const chatsResult = await wapiGetChats(connection.instance_id, connection.wapi_token);
    if (!chatsResult.success) return res.status(500).json({ error: chatsResult.error || 'Erro ao buscar conversas' });

    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const cutoffTimestamp = twoMonthsAgo.getTime();
    const allChats = chatsResult.contacts || [];
    let conversationsCreated = 0, conversationsUpdated = 0, messagesImported = 0, messagesSkipped = 0, errors = 0;

    for (const chat of allChats) {
      try {
        const remoteJid = chat.jid || `${chat.phone}@s.whatsapp.net`;
        const isGroup = remoteJid.includes('@g.us');
        const convResult = await query(
          `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone, is_group, last_message_at, created_at, updated_at, attendance_status)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW(), 'waiting')
           ON CONFLICT (connection_id, remote_jid) DO UPDATE SET contact_name = COALESCE(EXCLUDED.contact_name, conversations.contact_name), updated_at = NOW()
           RETURNING id, (xmax = 0) as is_new`,
          [connectionId, remoteJid, chat.name || chat.phone, chat.phone, isGroup]
        );
        const conversationId = convResult.rows[0]?.id;
        if (convResult.rows[0]?.is_new) conversationsCreated++;
        else conversationsUpdated++;
        if (!conversationId) continue;

        const msgsResult = await wapiGetChatMessages(connection.instance_id, connection.wapi_token, remoteJid);
        if (!msgsResult.success || !msgsResult.messages?.length) continue;

        for (const msg of msgsResult.messages) {
          try {
            let msgTimestamp = null;
            const rawTs = msg.timestamp || msg.messageTimestamp || msg.t || msg.createdAt;
            if (rawTs) {
              const ts = typeof rawTs === 'number' ? (rawTs > 1e12 ? rawTs : rawTs * 1000) : new Date(rawTs).getTime();
              if (!isNaN(ts)) msgTimestamp = ts;
            }
            if (msgTimestamp && msgTimestamp < cutoffTimestamp) { messagesSkipped++; continue; }
            const messageId = msg.id || msg.key?.id || msg.messageId || null;
            if (!messageId) { messagesSkipped++; continue; }
            const fromMe = msg.fromMe === true || msg.key?.fromMe === true || msg.from_me === true;
            const content = msg.body || msg.text || msg.message || msg.caption || msg.content || '';
            let messageType = 'text';
            if (msg.type) messageType = msg.type;
            else if (msg.hasMedia || msg.mediaUrl) messageType = msg.mediaType || 'document';
            const mediaUrl = msg.mediaUrl || msg.media || msg.fileUrl || null;
            const insertResult = await query(
              `INSERT INTO chat_messages (conversation_id, message_id, from_me, content, message_type, media_url, timestamp, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL AND message_id NOT LIKE 'temp_%' DO NOTHING RETURNING id`,
              [conversationId, messageId, fromMe, content, messageType, mediaUrl, msgTimestamp ? new Date(msgTimestamp) : new Date(), new Date()]
            );
            if (insertResult.rows.length > 0) messagesImported++;
            else messagesSkipped++;
          } catch { messagesSkipped++; }
        }
        await query(`UPDATE conversations SET last_message_at = (SELECT MAX(timestamp) FROM chat_messages WHERE conversation_id = $1), updated_at = NOW() WHERE id = $1`, [conversationId]);
      } catch (chatErr) {
        console.error(`[W-API] Error syncing chat ${chat.phone}:`, chatErr.message);
        errors++;
      }
    }

    res.json({ success: true, conversations_created: conversationsCreated, conversations_updated: conversationsUpdated, messages_imported: messagesImported, messages_skipped: messagesSkipped, errors });
  } catch (error) {
    console.error('[W-API] Conversation sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== Profile Picture ====================
router.post('/:connectionId/sync-profile-pictures', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId;
    const connection = await getAccessibleConnection(connectionId, userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });
    if (!connection.instance_id || !connection.wapi_token) return res.status(400).json({ error: 'Esta conexão não é W-API' });

    // Get all contacts linked to this connection that don't have a profile picture
    const contactsResult = await query(
      `SELECT c.id, c.phone
       FROM contacts c
       JOIN contact_lists cl ON cl.id = c.list_id
       WHERE cl.connection_id = $1
         AND (c.profile_picture_url IS NULL OR c.profile_picture_url = '')
       LIMIT 100`,
      [connectionId]
    );

    let updated = 0;
    let errors = 0;

    for (const contact of contactsResult.rows) {
      try {
        const result = await wapiGetProfilePicture(connection.instance_id, connection.wapi_token, contact.phone);
        if (result.success && result.url) {
          await query('UPDATE contacts SET profile_picture_url = $1 WHERE id = $2', [result.url, contact.id]);
          updated++;
        }
      } catch {
        errors++;
      }
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

    res.json({ success: true, total: contactsResult.rows.length, updated, errors });
  } catch (error) {
    console.error('[W-API] sync-profile-pictures error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== Bulk Number Validation ====================
router.post('/:connectionId/validate-numbers', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId;
    const { phones } = req.body;

    const connection = await getAccessibleConnection(connectionId, userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });
    if (!connection.instance_id || !connection.wapi_token) return res.status(400).json({ error: 'Esta conexão não é W-API' });

    if (!Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: 'Forneça uma lista de telefones' });
    }

    // Limit to 500 numbers per request
    const limitedPhones = phones.slice(0, 500);

    const result = await wapiCheckNumbersBulk(connection.instance_id, connection.wapi_token, limitedPhones);
    res.json(result);
  } catch (error) {
    console.error('[W-API] validate-numbers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validate all contacts in the database for this connection
router.post('/:connectionId/validate-all-contacts', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.userId;
    const connection = await getAccessibleConnection(connectionId, userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });
    if (!connection.instance_id || !connection.wapi_token) return res.status(400).json({ error: 'Esta conexão não é W-API' });

    // Get all contacts linked to this connection that haven't been validated yet
    const contactsResult = await query(
      `SELECT c.id, c.phone
       FROM contacts c
       JOIN contact_lists cl ON cl.id = c.list_id
       WHERE cl.connection_id = $1
         AND c.phone IS NOT NULL
         AND c.is_whatsapp IS NULL
       LIMIT 500`,
      [connectionId]
    );

    const phones = contactsResult.rows.map(c => c.phone);
    if (phones.length === 0) {
      return res.json({ success: true, total: 0, valid: 0, invalid: 0, message: 'Todos os contatos já foram validados' });
    }

    const result = await wapiCheckNumbersBulk(connection.instance_id, connection.wapi_token, phones);

    // Update contacts in DB
    let valid = 0, invalid = 0;
    for (const r of result.results) {
      const contact = contactsResult.rows.find(c => c.phone.replace(/\D/g, '') === r.phone);
      if (contact) {
        await query('UPDATE contacts SET is_whatsapp = $1 WHERE id = $2', [r.exists, contact.id]);
        if (r.exists) valid++;
        else invalid++;
      }
    }

    res.json({ success: true, total: phones.length, valid, invalid });
  } catch (error) {
    console.error('[W-API] validate-all-contacts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Diagnostics: view/clear last webhook events received by the backend
router.get('/:connectionId/webhook-events', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });

    const instanceId = connection.instance_id;
    const events = webhookEvents.filter((e) => e.instanceId === instanceId).slice(0, limit);

    res.json({ events });
  } catch (error) {
    console.error('[W-API] webhook-events GET error:', error);
    res.status(500).json({ error: 'Erro ao buscar eventos do webhook' });
  }
});

router.delete('/:connectionId/webhook-events', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });

    const instanceId = connection.instance_id;
    let removed = 0;
    for (let i = webhookEvents.length - 1; i >= 0; i--) {
      if (webhookEvents[i]?.instanceId === instanceId) {
        webhookEvents.splice(i, 1);
        removed++;
      }
    }

    res.json({ success: true, removed });
  } catch (error) {
    console.error('[W-API] webhook-events DELETE error:', error);
    res.status(500).json({ error: 'Erro ao limpar eventos do webhook' });
  }
});

// Diagnostics: view/clear last send attempts from backend -> W-API
router.get('/:connectionId/send-attempts', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });

    const attempts = getSendAttempts({ instanceId: connection.instance_id, limit });
    res.json({ attempts });
  } catch (error) {
    console.error('[W-API] send-attempts GET error:', error);
    res.status(500).json({ error: 'Erro ao buscar tentativas de envio' });
  }
});

router.delete('/:connectionId/send-attempts', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });

    clearSendAttempts(connection.instance_id);
    res.json({ success: true });
  } catch (error) {
    console.error('[W-API] send-attempts DELETE error:', error);
    res.status(500).json({ error: 'Erro ao limpar tentativas de envio' });
  }
});

// Diagnostics: view/clear endpoint discovery attempts
router.get('/:connectionId/endpoint-discovery', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 200));

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });

    const attempts = getEndpointDiscoveryAttempts({ instanceId: connection.instance_id, limit });
    res.json({ attempts });
  } catch (error) {
    console.error('[W-API] endpoint-discovery GET error:', error);
    res.status(500).json({ error: 'Erro ao buscar tentativas de descoberta' });
  }
});

router.delete('/:connectionId/endpoint-discovery', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });

    clearEndpointDiscoveryAttempts(connection.instance_id);
    res.json({ success: true });
  } catch (error) {
    console.error('[W-API] endpoint-discovery DELETE error:', error);
    res.status(500).json({ error: 'Erro ao limpar tentativas de descoberta' });
  }
});


router.post('/:connectionId/sync-group-name/:conversationId', authenticate, async (req, res) => {
  try {
    const { connectionId, conversationId } = req.params;

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });

    if (connection.provider !== 'wapi') {
      return res.status(400).json({ error: 'Esta função é apenas para conexões W-API' });
    }

    // Get conversation
    const convResult = await query(
      `SELECT remote_jid, is_group, group_name FROM conversations WHERE id = $1 AND connection_id = $2`,
      [conversationId, connectionId]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const conversation = convResult.rows[0];
    if (!conversation.is_group) {
      return res.status(400).json({ error: 'Esta conversa não é um grupo' });
    }

    // Try to get group info from W-API
    const groupInfo = await wapiGetGroupInfo(connection.instance_id, connection.wapi_token, conversation.remote_jid);

    if (!groupInfo.success || !groupInfo.name) {
      return res.json({ 
        success: false, 
        message: 'Não foi possível obter o nome do grupo da W-API',
        current_name: conversation.group_name 
      });
    }

    // Update the conversation with the group name
    await query(
      `UPDATE conversations SET group_name = $1 WHERE id = $2`,
      [groupInfo.name, conversationId]
    );

    console.log('[W-API] Synced group name:', conversation.remote_jid, '->', groupInfo.name);

    res.json({
      success: true,
      group_name: groupInfo.name,
      message: 'Nome do grupo atualizado com sucesso'
    });
  } catch (error) {
    console.error('[W-API] sync-group-name error:', error);
    res.status(500).json({ error: 'Erro ao sincronizar nome do grupo' });
  }
});

/**
 * Sync all group names from W-API for a connection
 * Updates all conversations that are groups but have no group_name
 */
router.post('/:connectionId/sync-all-groups', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) return res.status(404).json({ error: 'Conexão não encontrada' });

    if (connection.provider !== 'wapi') {
      return res.status(400).json({ error: 'Esta função é apenas para conexões W-API' });
    }

    // Get all group conversations without names
    const groupsResult = await query(
      `SELECT id, remote_jid, group_name FROM conversations 
       WHERE connection_id = $1 AND is_group = true AND (group_name IS NULL OR group_name = '' OR group_name = 'Grupo')`,
      [connectionId]
    );

    if (groupsResult.rows.length === 0) {
      return res.json({ success: true, updated: 0, message: 'Todos os grupos já têm nome' });
    }

    console.log(`[W-API] Syncing ${groupsResult.rows.length} groups without names`);

    // Try to get all groups from W-API first
    const groupsData = await wapiGetGroups(connection.instance_id, connection.wapi_token);
    
    let updated = 0;
    const groupsMap = new Map();
    
    if (groupsData.success && groupsData.groups?.length > 0) {
      // Build a map of JID -> name
      for (const g of groupsData.groups) {
        if (g.jid && g.name) {
          groupsMap.set(g.jid, g.name);
        }
      }
      console.log(`[W-API] Got ${groupsMap.size} group names from bulk fetch`);
    }

    // Update each group
    for (const conv of groupsResult.rows) {
      let groupName = groupsMap.get(conv.remote_jid);
      
      // If not found in bulk, try individual fetch
      if (!groupName) {
        const groupInfo = await wapiGetGroupInfo(connection.instance_id, connection.wapi_token, conv.remote_jid);
        if (groupInfo.success && groupInfo.name) {
          groupName = groupInfo.name;
        }
      }

      if (groupName) {
        await query(
          `UPDATE conversations SET group_name = $1 WHERE id = $2`,
          [groupName, conv.id]
        );
        updated++;
        console.log(`[W-API] Updated group name: ${conv.remote_jid} -> ${groupName}`);
      }
    }

    res.json({
      success: true,
      updated,
      total: groupsResult.rows.length,
      message: `${updated} de ${groupsResult.rows.length} grupos atualizados`
    });
  } catch (error) {
    console.error('[W-API] sync-all-groups error:', error);
    res.status(500).json({ error: 'Erro ao sincronizar nomes dos grupos' });
  }
});

/**
 * Detect event type from W-API payload
 * W-API uses specific event names like:
 * - webhookReceived: incoming message
 * - webhookDelivery: outgoing message confirmation (fromApi)
 * - webhookStatus: delivery/read/server updates
 * - webhookConnected / webhookDisconnected: connection status
 */
function detectEventType(payload) {
  const rawEvent = payload?.event || payload?.type || payload?.webhookType || payload?.eventName || '';
  const event = String(rawEvent).trim().toLowerCase();

  const isTrue = (v) => v === true || v === 'true' || v === 1 || v === '1';
  const isFalse = (v) => v === false || v === 'false' || v === 0 || v === '0';
  const fromMe = payload?.fromMe ?? payload?.isFromMe ?? payload?.from_me ?? payload?.key?.fromMe;

  // W-API specific event types (and common aliases)
  if (['webhookreceived', 'received', 'message_received', 'incoming_message', 'message.received', 'message_upsert'].includes(event)) {
    if (isTrue(fromMe) || isTrue(payload.fromApi)) {
      return 'message_sent';
    }
    return 'message_received';
  }

  if (['webhookdelivery', 'delivery', 'message_delivery', 'message_sent', 'message.sent'].includes(event)) {
    return 'message_sent';
  }

  if (['webhookstatus', 'message_status', 'status', 'message.ack', 'message_status_update'].includes(event)) {
    return 'status_update';
  }

  if (['webhookconnected', 'webhookdisconnected', 'connection.update', 'connection_update'].includes(event)) {
    return 'connection_update';
  }

  // Legacy/fallback: Evolution-style events
  if (event === 'message' || event === 'messages.upsert') {
    if (isFalse(fromMe)) return 'message_received';
    return 'message_sent';
  }

  // Check by presence of message fields (msgContent is W-API specific)
  if (payload.msgContent || payload.message || payload.text || payload.body) {
    if (isTrue(fromMe) || isTrue(payload.fromApi)) {
      return 'message_sent';
    }
    return 'message_received';
  }

  // Status update (legacy ack)
  if (payload.ack !== undefined) return 'status_update';

  // Connection status (be strict: avoid treating delivery status as connection)
  if (
    payload.connected !== undefined ||
    payload.status === 'connected' ||
    payload.status === 'disconnected' ||
    payload.state === 'open' ||
    payload.state === 'close'
  ) {
    return 'connection_update';
  }

  return 'unknown';
}

/**
 * Check if incoming message matches any flow keywords and trigger flow execution
 */
async function checkAndTriggerFlow(connection, conversationId, messageContent) {
  try {
    if (!messageContent || typeof messageContent !== 'string') return false;
    
    const messageLower = messageContent.trim().toLowerCase();
    if (!messageLower) return false;

    console.log('[Flow Trigger] Checking keywords for message:', messageLower.slice(0, 50));

    // Find active flows with trigger enabled for this connection
    const flowsResult = await query(
      `SELECT f.id, f.name, f.trigger_keywords, f.trigger_match_mode
       FROM flows f
       WHERE f.is_active = true
         AND f.trigger_enabled = true
         AND f.trigger_keywords IS NOT NULL
         AND array_length(f.trigger_keywords, 1) > 0
         AND (
           f.connection_ids IS NULL 
           OR f.connection_ids = '{}'
           OR $1 = ANY(f.connection_ids)
         )
       ORDER BY f.created_at`,
      [connection.id]
    );

    if (flowsResult.rows.length === 0) {
      console.log('[Flow Trigger] No active flows with triggers for this connection');
      return false;
    }

    // Check each flow for keyword match
    for (const flow of flowsResult.rows) {
      const keywords = (flow.trigger_keywords || []).map(k => String(k).toLowerCase().trim());
      const matchMode = flow.trigger_match_mode || 'exact';
      
      let matched = false;
      
      for (const keyword of keywords) {
        if (!keyword) continue;
        
        switch (matchMode) {
          case 'exact':
            matched = messageLower === keyword;
            break;
          case 'contains':
            matched = messageLower.includes(keyword);
            break;
          case 'starts_with':
            matched = messageLower.startsWith(keyword);
            break;
          default:
            matched = messageLower === keyword;
        }
        
        if (matched) break;
      }

      if (matched) {
        console.log('[Flow Trigger] Keyword matched! Starting flow:', flow.name, 'for conversation:', conversationId);
        
        // Execute the flow
        const result = await executeFlow(flow.id, conversationId, 'start');
        
        if (result.success) {
          console.log('[Flow Trigger] Flow executed successfully:', flow.name, 'Nodes processed:', result.nodesProcessed);
        } else {
          console.error('[Flow Trigger] Flow execution failed:', result.error);
        }
        
        // Only trigger the first matching flow
        return true;
      }
    }

    console.log('[Flow Trigger] No keyword match found');
    return false;
  } catch (error) {
    console.error('[Flow Trigger] Error checking/triggering flow:', error);
  }
}

/**
 * Check if there's an active flow session and continue it with user input
 */
async function continueActiveFlow(connection, conversationId, userInput) {
  try {
    // Check if there's an active flow session for this conversation
    const sessionResult = await query(
      `SELECT fs.id, fs.flow_id, fs.current_node_id
       FROM flow_sessions fs
       WHERE fs.conversation_id = $1 AND fs.is_active = true
       LIMIT 1`,
      [conversationId]
    );

    if (sessionResult.rows.length === 0) {
      console.log('[Flow Continue] No active session for conversation:', conversationId);
      return { continued: false };
    }

    const session = sessionResult.rows[0];
    console.log('[Flow Continue] Found active session, node:', session.current_node_id);

    // Continue the flow with user input
    const result = await continueFlowWithInput(conversationId, userInput);

    if (result.success) {
      console.log('[Flow Continue] Flow continued successfully');
      return { continued: true, result };
    } else {
      console.error('[Flow Continue] Error continuing flow:', result.error);
      return { continued: false, error: result.error };
    }
  } catch (error) {
    console.error('[Flow Continue] Error:', error);
    return { continued: false, error: error.message };
  }
}

/**
 * Handle incoming message from W-API
 * W-API payload structure:
 * {
 *   event: "webhookReceived",
 *   instanceId, connectedPhone, messageId, fromMe: false,
 *   chat: { id: "5517991308048" },
 *   sender: { id, pushName },
 *   msgContent: { conversation: "..." } | { imageMessage: {...} } | etc.
 * }
 */
async function handleIncomingMessage(connection, payload) {
  try {
    // W-API format: chat.id is the chat identifier (can be phone or group JID)
    let chatId = payload.chat?.id || payload.phone || payload.from || payload.remoteJid;
    const messageId = payload.messageId || payload.id || payload.key?.id || crypto.randomUUID();

    if (!chatId) {
      console.log('[W-API] No chatId in incoming message, payload:', JSON.stringify(payload).slice(0, 300));
      return;
    }

    // Check if this is a group message
      const isGroup = String(chatId).includes('@g.us') || (String(chatId).includes('-') && !String(chatId).match(/^\d+$/));

    // If the provider addressed the message via @lid (linked-device id) instead
    // of the real phone JID, try to resolve the real phone from auxiliary fields
    // to avoid creating a duplicate conversation for the same contact.
    if (!isGroup && String(chatId).includes('@lid')) {
      const realPhone = digitsOnly(
        payload.senderPn || payload.sender_pn || payload.lidPn ||
        payload.participant_pn || payload.participantPn || payload.pn ||
        payload.phoneNumber ||
        payload.sender?.pn || payload.sender?.phoneNumber ||
        payload.chat?.pn || payload.chat?.phoneNumber ||
        ''
      );
      if (realPhone) {
        chatId = `${realPhone}@s.whatsapp.net`;
      }
    }
    
    // Check if connection allows group messages
    if (isGroup && !connection.show_groups) {
      console.log('[W-API] Skipping group message (show_groups disabled):', chatId);
      return;
    }

    // For individual chats, get the sender info
    const senderId = payload.sender?.id || payload.from || chatId;
    
    // Normalize to JID format
    let remoteJid;
    let cleanPhone = null;
    
    if (isGroup) {
      // Keep group JID as-is
      remoteJid = String(chatId).includes('@') ? chatId : `${chatId}@g.us`;
    } else {
      // Individual chat - normalize phone
      cleanPhone = digitsOnly(chatId);
      remoteJid = cleanPhone ? `${cleanPhone}@s.whatsapp.net` : null;
    }
    
    if (!remoteJid) {
      console.log('[W-API] Invalid chat format:', chatId);
      return;
    }

    // Handle protocolMessage (edits/deletes) before content extraction
    const msgContentRaw = payload.msgContent || payload.message || {};
    if (msgContentRaw.protocolMessage) {
      const proto = msgContentRaw.protocolMessage;
      const editedMsg = proto.editedMessage;
      const protoType = proto.type;
      
      console.log('[W-API] protocolMessage detected. type:', protoType, 'hasEditedMsg:', !!editedMsg, 'proto.key:', JSON.stringify(proto.key));
      
      // Handle message edit
      if (editedMsg) {
        const editedMessageId = proto.key?.id;
        if (editedMessageId) {
          const newContent = editedMsg?.message?.conversation 
            || editedMsg?.message?.extendedTextMessage?.text 
            || editedMsg?.conversation
            || editedMsg?.extendedTextMessage?.text
            || '';
          console.log('[W-API] Message edited:', editedMessageId, 'new content:', newContent?.slice(0, 100));
          if (newContent) {
            await query(
              `UPDATE chat_messages SET content = $1, is_edited = true WHERE message_id = $2 RETURNING id`,
              [newContent, editedMessageId]
            );
          }
        }
        return;
      }
      
      // Handle message deletion (REVOKE)
      if (protoType === 0 || protoType === 'REVOKE' || proto.key?.id) {
        const deletedMessageId = proto.key?.id;
        if (deletedMessageId) {
          console.log('[W-API] Message deleted by sender:', deletedMessageId);
          const delResult = await query(
            `UPDATE chat_messages SET is_deleted = true WHERE message_id = $1 RETURNING id`,
            [deletedMessageId]
          );
          console.log('[W-API] Delete matched', delResult.rowCount, 'rows');
          if (delResult.rowCount === 0) {
            // Broad match
            await query(
              `UPDATE chat_messages SET is_deleted = true WHERE message_id LIKE $1 RETURNING id`,
              [`%${deletedMessageId}%`]
            );
          }
        }
        return;
      }
      
      // Other protocol messages - skip
      return;
    }

    // IMPORTANT: Extract message content BEFORE creating conversation
    // This prevents creating empty conversations when message is invalid/empty
    const { messageType, content, mediaUrl: rawMediaUrl, mediaMimetype, waMediaKey, linkPreview } = extractMessageContent(payload);

    console.log('[W-API] Pre-check extracted content:', {
      messageType,
      contentLen: content?.length,
      rawMediaUrl: rawMediaUrl?.slice?.(0, 100),
      mediaMimetype,
      hasMediaKey: Boolean(waMediaKey),
    });

    // Skip if message has no content - don't create empty conversations
    if (!content && !rawMediaUrl) {
      console.log('[W-API] Empty message content, skipping before conversation creation. Full msgContent:', JSON.stringify(payload.msgContent || {}).slice(0, 500));
      return;
    }

    // Get or create conversation
    // First try by remote_jid, then fallback to contact_phone for individual chats
    // This handles cases where remote_jid format changes (@lid vs @s.whatsapp.net)
    console.log('[W-API] Looking for conversation with remote_jid:', remoteJid, 'connection_id:', connection.id);
    
    let conversationResult = await findExistingConversationForWapi(connection.id, remoteJid, cleanPhone, isGroup);

    console.log('[W-API] JID search result:', conversationResult.rows.length > 0 ? conversationResult.rows[0] : 'NOT FOUND');

    let conversationId;
    if (conversationResult.rows.length === 0) {
      // Create new conversation
      // Try multiple sources for group name - W-API sends it in various ways
      const groupName = isGroup
        ? (payload.chat?.name || payload.chat?.groupName || payload.chat?.subject || 
           payload.groupName || payload.groupSubject || payload.subject || 
           payload.group?.name || payload.group?.subject || null)
        : null;

      if (isGroup) {
        console.log('[W-API] Group name extraction - chatId:', chatId, 
          'name:', payload.chat?.name, 
          'groupName:', payload.chat?.groupName,
          'subject:', payload.chat?.subject,
          'payload.groupName:', payload.groupName,
          'extracted:', groupName);
      }

      const contactName = isGroup 
        ? (groupName || 'Grupo')
        : (payload.sender?.pushName || payload.pushName || payload.name || payload.senderName || cleanPhone);

      console.log('[W-API] Creating NEW conversation for:', { 
        remoteJid, 
        cleanPhone, 
        contactName, 
        isGroup,
        connectionId: connection.id 
      });

      try {
        const newConv = await query(
          `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone, is_group, group_name, last_message_at, unread_count, attendance_status)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
           RETURNING id`,
          [connection.id, remoteJid, contactName, isGroup ? null : cleanPhone, isGroup, isGroup ? groupName : null, payload.fromMe ? 0 : 1, payload.fromMe ? 'attending' : 'waiting']
        );
        conversationId = newConv.rows[0].id;
        console.log('[W-API] Created new', isGroup ? 'group' : 'conversation:', conversationId, isGroup ? `name: ${groupName}` : '', 'phone:', cleanPhone);
        
        // Auto-fetch group name in background if missing
        if (isGroup && (!groupName || groupName === 'Grupo')) {
          (async () => {
            try {
              const groupInfo = await wapiGetGroupInfo(connection.instance_id, connection.wapi_token, remoteJid);
              if (groupInfo.success && groupInfo.name) {
                await query(
                  `UPDATE conversations SET group_name = $1, contact_name = $1 WHERE id = $2`,
                  [groupInfo.name, conversationId]
                );
                console.log('[W-API] Auto-fetched group name:', groupInfo.name, 'for conv:', conversationId);
              }
            } catch (e) {
              console.log('[W-API] Failed to auto-fetch group name:', e.message);
            }
          })();
        }
      } catch (insertError) {
        console.error('[W-API] ERROR creating conversation:', insertError.message);
        console.error('[W-API] Insert params:', { connectionId: connection.id, remoteJid, contactName, cleanPhone, isGroup, groupName });
        throw insertError;
      }
      } else {
      conversationId = conversationResult.rows[0].id;

      // Update conversation
      if (isGroup) {
        // For groups, update group_name if we have a new name
        const groupName = payload.chat?.name || payload.chat?.groupName || payload.chat?.subject || 
                         payload.groupName || payload.groupSubject || payload.subject ||
                         payload.group?.name || payload.group?.subject || null;
        
        if (groupName) {
          console.log('[W-API] Updating group name for conversation', conversationId, 'to:', groupName);
        }
        
        await query(
          `UPDATE conversations 
           SET last_message_at = NOW(), 
               unread_count = CASE WHEN $4::boolean THEN unread_count ELSE unread_count + 1 END,
               group_name = COALESCE($2, group_name),
               is_group = true,
                 attendance_status = CASE
                   WHEN $4::boolean AND attendance_status = 'waiting' THEN 'attending'
                   WHEN NOT $4::boolean AND attendance_status = 'finished' THEN 'waiting'
                   ELSE attendance_status
                 END,
                 accepted_at = CASE WHEN $4::boolean AND attendance_status = 'waiting' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
                 connection_id = COALESCE($3, connection_id)
            WHERE id = $1`,
            [conversationId, groupName, connection.id, payload.fromMe === true]
        );
      } else {
        // For individual chats, update contact_name with sender's pushName
        await query(
          `UPDATE conversations 
           SET last_message_at = NOW(), 
                unread_count = CASE WHEN $4::boolean THEN unread_count ELSE unread_count + 1 END,
               contact_name = COALESCE($2, contact_name),
                 attendance_status = CASE
                   WHEN $4::boolean AND attendance_status = 'waiting' THEN 'attending'
                   WHEN NOT $4::boolean AND attendance_status = 'finished' THEN 'waiting'
                   ELSE attendance_status
                 END,
                 accepted_at = CASE WHEN $4::boolean AND attendance_status = 'waiting' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
                 connection_id = COALESCE($3, connection_id)
            WHERE id = $1`,
            [conversationId, payload.sender?.pushName || payload.pushName || payload.name, connection.id, payload.fromMe === true]
        );
      }
    }

    // Use already extracted content from above (before conversation creation)
    // messageType, content, rawMediaUrl, mediaMimetype, waMediaKey are already defined

    // Normalize media URL and try to make it locally accessible BEFORE AI processing
    const normalizedMediaUrl = normalizeUploadsUrl(rawMediaUrl);
    let effectiveMediaUrl = normalizedMediaUrl;
    let effectiveMediaMimetype = mediaMimetype || null;

    if (messageType !== 'text') {
      // 1) If we have an external/encrypted URL, cache eagerly
      // For documents/videos, give more time (large files like PPTX can take 30-60s)
      if (effectiveMediaUrl && shouldCacheExternally(effectiveMediaUrl)) {
        const isLargeKind = messageType === 'document' || messageType === 'video';
        const eagerTimeout = isLargeKind ? 60000 : 12000;
        const eager = await withTimeout(
          cacheMedia({
            messageId,
            mediaUrl: effectiveMediaUrl,
            messageType,
            mediaMimetype: effectiveMediaMimetype,
            connection,
            waMediaKey,
          }),
          eagerTimeout,
          'eager_incoming_media_cache_timeout'
        ).catch((err) => {
          console.error('[W-API] Eager media cache failed:', err?.message || err);
          return null;
        });

        if (eager?.publicUrl) {
          effectiveMediaUrl = eager.publicUrl;
          effectiveMediaMimetype = eager.mime || effectiveMediaMimetype;
          console.log('[W-API] Eager cache ok ->', effectiveMediaUrl);
        }
      }

      // 2) If we still don't have media URL (common for audio), fetch by messageId
      if (!effectiveMediaUrl) {
        const eagerById = await withTimeout(
          cacheMediaFromWapiDownload({
            messageId,
            messageType,
            mediaMimetype: effectiveMediaMimetype,
            connection,
          }),
          8000,
          'eager_incoming_media_download_timeout'
        ).catch((err) => {
          console.error('[W-API] Eager media download by id failed:', err?.message || err);
          return null;
        });

        if (eagerById?.publicUrl) {
          effectiveMediaUrl = eagerById.publicUrl;
          effectiveMediaMimetype = eagerById.mime || effectiveMediaMimetype;
          console.log('[W-API] Eager download by id ok ->', effectiveMediaUrl);
        }
      }
    }

    // Content was already validated before conversation creation, but check effectiveMediaUrl
    if (!content && !effectiveMediaUrl) {
      console.log('[W-API] Empty message after media processing, skipping. Full msgContent:', JSON.stringify(payload.msgContent || {}).slice(0, 500));
      return;
    }

    // Check for duplicate message in chat_messages table
    const existingMsg = await query(
      `SELECT id FROM chat_messages WHERE message_id = $1`,
      [messageId]
    );

    if (existingMsg.rows.length > 0) {
      console.log('[W-API] Duplicate message, skipping:', messageId);
      return;
    }

    // Get sender info for group messages
    const senderName = isGroup 
      ? (payload.sender?.pushName || payload.pushName || payload.senderName || null)
      : null;
    const senderPhoneRaw = isGroup 
      ? (payload.sender?.id || senderId)
      : null;
    const senderPhone = senderPhoneRaw 
      ? String(senderPhoneRaw).replace(/@.*$/, '').replace(/\D/g, '')
      : null;

    // Insert message into chat_messages table
    try {
      await query(
        `INSERT INTO chat_messages (conversation_id, message_id, content, message_type, media_url, media_mimetype, wa_media_key, from_me, sender_name, sender_phone, status, timestamp, link_preview)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)`,
        [conversationId, messageId, content, messageType, effectiveMediaUrl, effectiveMediaMimetype, waMediaKey, payload.fromMe === true, senderName, senderPhone, payload.fromMe === true ? 'sent' : 'received', linkPreview ? JSON.stringify(linkPreview) : null]
      );

      console.log('[W-API] Message saved. Type:', messageType, 'ConvID:', conversationId, 'MsgID:', messageId, 'MediaURL:', effectiveMediaUrl?.slice?.(0, 100));
    } catch (insertError) {
      console.error('[W-API] CRITICAL: Failed to insert message into chat_messages:', insertError.message);
      console.error('[W-API] Insert params:', { conversationId, messageId, content: content?.slice?.(0, 50), messageType, effectiveMediaUrl: effectiveMediaUrl?.slice?.(0, 80) });
      // Reset unread_count since the message wasn't saved
      await query(`UPDATE conversations SET unread_count = GREATEST(unread_count - 1, 0) WHERE id = $1`, [conversationId]).catch(() => {});
      throw insertError;
    }

    // ====== PUSH NOTIFICATION on incoming message ======
    // Fire-and-forget; respects per-conversation mute flag.
    if (connection.organization_id) {
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
          const senderPrefix = conv.is_group && senderName ? `${senderName}: ` : '';
          let preview = '';
          if (messageType === 'text') preview = (content || '').slice(0, 120);
          else if (messageType === 'image') preview = '📷 Foto';
          else if (messageType === 'audio') preview = '🎤 Áudio';
          else if (messageType === 'video') preview = '🎥 Vídeo';
          else if (messageType === 'document') preview = '📎 Documento';
          else if (messageType === 'sticker') preview = 'Figurinha';
          else preview = 'Nova mensagem';

          await sendPushToOrgUsers(connection.organization_id, {
            title: titleName,
            body: `${senderPrefix}${preview}`,
            url: '/chat',
            tag: `conv-${conversationId}`,
            data: { conversation_id: conversationId, type: 'new_message', is_group: !!conv.is_group },
          });
        } catch (e) {
          console.error('[W-API] push notify error:', e.message);
        }
      })();
    }

    // Pause nurturing sequences on incoming message (fromMe is always false here)
    if (cleanPhone && connection.organization_id) {
      pauseNurturingOnReply(cleanPhone, connection.organization_id, conversationId)
        .catch(err => console.error('[W-API] Error pausing nurturing:', err.message));

      // Emit lead_replied so CRM automations stop / advance via the event bus.
      // Async fire-and-forget — webhook latency must stay low.
      (async () => {
        try {
          const dealRow = await query(
            `SELECT cd.deal_id FROM crm_deal_contacts cd
             JOIN contacts c ON c.id = cd.contact_id
             WHERE RIGHT(REGEXP_REPLACE(c.phone, '\\D', '', 'g'), 9) = RIGHT($1, 9)
             ORDER BY cd.is_primary DESC NULLS LAST
             LIMIT 1`,
            [cleanPhone]
          );
          await emitLeadEvent({
            organizationId: connection.organization_id,
            dealId: dealRow.rows[0]?.deal_id || null,
            contactPhone: cleanPhone,
            eventType: 'lead_replied',
            payload: { conversation_id: conversationId, message_id: messageId },
            source: 'chat',
          });
        } catch (e) {
          console.error('[W-API] emit lead_replied failed:', e.message);
        }
      })();
    }

    // ======= GROUP SECRETARY: AI analysis for group messages =======
    if (isGroup && content && connection.organization_id) {
      const convForGroup = await query(`SELECT group_name FROM conversations WHERE id = $1`, [conversationId]);
      const groupNameForSecretary = convForGroup.rows[0]?.group_name || 'Grupo';
      // Extract mentionedJids from ALL possible locations
      const msgContentObj = payload?.message || payload?.msgContent || {};
      const extractMentionedJids = () => {
        const sources = [
          msgContentObj?.extendedTextMessage?.contextInfo?.mentionedJid,
          msgContentObj?.extendedTextMessage?.contextInfo?.mentionedJids,
          msgContentObj?.contextInfo?.mentionedJid,
          msgContentObj?.contextInfo?.mentionedJids,
          payload?.contextInfo?.mentionedJid,
          payload?.contextInfo?.mentionedJids,
          payload?.mentionedJids,
          payload?.mentionedJid,
        ];
        for (const src of sources) {
          if (Array.isArray(src) && src.length > 0) return src;
        }
        return [];
      };
      const mentionedJids = extractMentionedJids();
      console.log('[W-API][GroupSecretary] mentionedJids:', JSON.stringify(mentionedJids));
      analyzeGroupMessage({
        organizationId: connection.organization_id,
        conversationId,
        messageContent: content,
        senderName: senderName || 'Desconhecido',
        senderPhone: senderPhone || null,
        groupName: groupNameForSecretary,
        mentionedJids,
      }).catch(err => console.error('[W-API][GroupSecretary] Error:', err.message));
    }

    // Check for active flow sessions first (priority over keywords)
    let flowHandled = false;
    if (messageType === 'text' && content) {
      console.log('[W-API] Checking for active flow sessions...');
      const continueResult = await continueActiveFlow(connection, conversationId, content);
      
      if (continueResult?.continued) {
        console.log('[W-API] Flow continued successfully');
        flowHandled = true;
      }
      
      if (!flowHandled) {
        // If no active flow, check for keyword-triggered flows
        console.log('[W-API] No active flow, checking keywords...');
        const flowTriggered = await checkAndTriggerFlow(connection, conversationId, content);
        if (flowTriggered) flowHandled = true;
      }
    }

    // AI agent processing - supports text, audio, image, document, video, sticker
    if (!flowHandled) {
      const aiSupportedTypes = ['text', 'image', 'audio', 'video', 'document', 'sticker'];
      if (aiSupportedTypes.includes(messageType) && (content || effectiveMediaUrl)) {
        console.log('[W-API] Checking AI agent for message type:', messageType);
        processIncomingWithAgent({
          connection,
          conversationId,
          contactPhone: cleanPhone,
          contactName: payload.sender?.pushName || payload.pushName || payload.name || cleanPhone,
          messageContent: content,
          messageType,
          mediaUrl: effectiveMediaUrl || null,
          mediaMimetype: effectiveMediaMimetype || null,
          mediaFilename: payload.msgContent?.documentMessage?.fileName || null,
        }).then(result => {
          if (result.handled) {
            console.log('[W-API] AI Agent handled message, agent:', result.agentId, 'type:', messageType);
          }
        }).catch(err => {
          console.error('[W-API] AI Agent processing error:', err.message);
        });
      }
    }

    // Cache media in background for reliability (CORS/expiração de URL)
    if (effectiveMediaUrl && shouldCacheExternally(effectiveMediaUrl)) {
      console.log('[W-API] Starting background media cache...');
      cacheMediaAndUpdateMessage({
        messageId,
        mediaUrl: effectiveMediaUrl,
        messageType,
        mediaMimetype: effectiveMediaMimetype,
        connection,
        waMediaKey,
      });
    } else if (messageType !== 'text' && !effectiveMediaUrl) {
      console.log('[W-API] WARNING: Non-text message without mediaUrl! Type:', messageType);
    }
    console.log('[W-API] Incoming message saved:', messageId, 'Type:', messageType, 'From:', cleanPhone);
  } catch (error) {
    console.error('[W-API] Error handling incoming message:', error);
  }
}

/**
 * Handle outgoing message (sent by us, confirmed by W-API webhook)
 * W-API payload structure for webhookDelivery:
 * {
 *   event: "webhookDelivery",
 *   instanceId, connectedPhone, messageId, fromMe: true, fromApi: true,
 *   chat: { id: "5517991308048" },  // destination phone
 *   msgContent: { conversation: "..." }
 * }
 */
async function handleOutgoingMessage(connection, payload) {
  try {
    // W-API format: chat.id is the destination phone/group for outgoing
    const chatId = payload.chat?.id || payload.phone || payload.to || payload.remoteJid;
    const messageId = payload.messageId || payload.id || payload.key?.id;

    if (!chatId || !messageId) {
      console.log('[W-API] Missing chatId or messageId in outgoing:', { chatId, messageId });
      return;
    }

    // Check if this is a group message
    const isGroup = String(chatId).includes('@g.us') || (String(chatId).includes('-') && !String(chatId).match(/^\d+$/));
    
    let remoteJid;
    let cleanPhone = null;
    
    if (isGroup) {
      // Keep group JID as-is
      remoteJid = String(chatId).includes('@') ? chatId : `${chatId}@g.us`;
    } else {
      // Individual chat - normalize phone
      cleanPhone = digitsOnly(chatId);
      remoteJid = cleanPhone ? `${cleanPhone}@s.whatsapp.net` : null;
    }

    if (!remoteJid) {
      console.log('[W-API] Invalid chat format for outgoing:', chatId);
      return;
    }

    // Find conversation
    const convResult = await findExistingConversationForWapi(connection.id, remoteJid, cleanPhone, isGroup);

    if (convResult.rows.length === 0) {
      // For outgoing messages from phone, we might need to create the conversation
      console.log('[W-API] Conversation not found for outgoing message to:', remoteJid, '- creating...');
      
      const contactName = isGroup 
        ? (payload.chat?.name || payload.groupName || 'Grupo')
        : (payload.chat?.pushName || cleanPhone);
      
      const newConv = await query(
        `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone, is_group, group_name, last_message_at, unread_count, attendance_status)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), 0, 'attending')
         RETURNING id`,
        [connection.id, remoteJid, contactName, isGroup ? null : cleanPhone, isGroup, isGroup ? contactName : null]
      );
      
      var conversationId = newConv.rows[0].id;
      console.log('[W-API] Created new conversation for outgoing:', conversationId);
    } else {
      var conversationId = convResult.rows[0].id;
      // Modo híbrido: se atendente respondeu pelo WhatsApp diretamente,
      // muda a conversa de 'waiting' para 'attending' automaticamente.
      await query(
        `UPDATE conversations
         SET attendance_status = 'attending',
             accepted_at = COALESCE(accepted_at, NOW()),
             updated_at = NOW()
         WHERE id = $1 AND attendance_status = 'waiting'`,
        [conversationId]
      );
    }

    // Handle protocolMessage (edits/deletes) for outgoing
    const outMsgContent = payload.msgContent || payload.message || {};
    if (outMsgContent.protocolMessage) {
      const proto = outMsgContent.protocolMessage;
      const editedMsg = proto.editedMessage;
      const protoType = proto.type;
      
      if (editedMsg) {
        const editedMessageId = proto.key?.id;
        if (editedMessageId) {
          const newContent = editedMsg?.message?.conversation 
            || editedMsg?.message?.extendedTextMessage?.text 
            || editedMsg?.conversation
            || editedMsg?.extendedTextMessage?.text
            || '';
          if (newContent) {
            await query(
              `UPDATE chat_messages SET content = $1, is_edited = true WHERE message_id = $2 RETURNING id`,
              [newContent, editedMessageId]
            );
          }
        }
        return;
      }
      
      if (protoType === 0 || protoType === 'REVOKE' || proto.key?.id) {
        const deletedMessageId = proto.key?.id;
        if (deletedMessageId) {
          await query(
            `UPDATE chat_messages SET is_deleted = true WHERE message_id = $1 RETURNING id`,
            [deletedMessageId]
          );
        }
        return;
      }
      return;
    }

    const { messageType, content, mediaUrl: rawMediaUrl, mediaMimetype, waMediaKey } = extractMessageContent(payload);
    let effectiveMediaUrl = normalizeUploadsUrl(rawMediaUrl);
    let effectiveMediaMimetype = mediaMimetype || null;

    // Outgoing media sent from the phone often comes WITHOUT a direct URL.
    // In this case, we must download by messageId to make it renderable in the web UI.
    if (messageType !== 'text') {
      // 1) If we already have a URL but it's external/encrypted, try eager cache (best effort)
      if (effectiveMediaUrl && shouldCacheExternally(effectiveMediaUrl)) {
        const eager = await withTimeout(
          cacheMedia({
            messageId,
            mediaUrl: effectiveMediaUrl,
            messageType,
            mediaMimetype: effectiveMediaMimetype,
            connection,
            waMediaKey,
          }),
          8000,
          'eager_outgoing_media_cache_timeout'
        ).catch(() => null);

        if (eager?.publicUrl) {
          effectiveMediaUrl = eager.publicUrl;
          effectiveMediaMimetype = eager.mime || effectiveMediaMimetype;
        }
      }

      // 2) If we still don't have a usable URL, try downloading by messageId (W-API)
      if (!effectiveMediaUrl) {
        const eagerById = await withTimeout(
          cacheMediaFromWapiDownload({
            messageId,
            messageType,
            mediaMimetype: effectiveMediaMimetype,
            connection,
          }),
          8000,
          'eager_outgoing_media_download_timeout'
        ).catch(() => null);

        if (eagerById?.publicUrl) {
          effectiveMediaUrl = eagerById.publicUrl;
          effectiveMediaMimetype = eagerById.mime || effectiveMediaMimetype;
        }
      }
    }

    // Check for duplicate or pending message (optimistic UI pattern).
    // W-API can return one id from the send endpoint and another id in the webhook echo,
    // so also reconcile a recent message sent from the web chat with same content/type.
    const existingMsg = await query(
      `SELECT id, message_id FROM chat_messages
       WHERE message_id = $1
          OR (
            conversation_id = $2
            AND from_me = true
            AND COALESCE(is_deleted, false) = false
            AND timestamp > NOW() - INTERVAL '180 seconds'
            AND message_type = $3
            AND (
              -- ONLY optimistic rows created by the web chat may be reconciled.
              -- Rows with a real (or NULL) provider id are distinct messages,
              -- e.g. several files sent directly from the phone.
              message_id LIKE 'temp_%'
              AND sender_id IS NOT NULL
              AND status IN ('pending','sent')
              AND (
                ($3 = 'text' AND COALESCE(content,'') = COALESCE($4,''))
                OR ($3 <> 'text' AND timestamp > NOW() - INTERVAL '180 seconds')
              )
            )
          )
       ORDER BY
         CASE WHEN message_id = $1 THEN 0 ELSE 1 END,
         timestamp ASC
       LIMIT 1`,
      [messageId, conversationId, messageType, content || '']
    );

    if (existingMsg.rows.length > 0) {
      const existing = existingMsg.rows[0];
      if (existing.message_id === messageId) {
        console.log('[W-API] Outgoing message already exists:', messageId);
        return;
      }
      // Update only temp/pending rows with the real webhook ID; if it already has a real ID,
      // keep it and skip inserting the webhook echo.
      if (!existing.message_id || String(existing.message_id).startsWith('temp_')) {
        await query(
          `UPDATE chat_messages
           SET message_id = $1,
               status = 'sent',
               content = COALESCE($3, content),
               media_url = COALESCE($4, media_url),
               media_mimetype = COALESCE($5, media_mimetype)
           WHERE id = $2`,
          [messageId, existing.id, content || null, effectiveMediaUrl || null, effectiveMediaMimetype || null]
        );
      }
      console.log('[W-API] Updated pending message with real ID:', messageId);
      return;
    }

    // Insert sent message if not found (e.g., sent from W-API panel directly)
    await query(
      `INSERT INTO chat_messages (conversation_id, message_id, content, message_type, media_url, media_mimetype, from_me, status, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, true, 'sent', NOW())`,
      [conversationId, messageId, content, messageType, effectiveMediaUrl, effectiveMediaMimetype]
    );

    // Background cache as a fallback (so even if eager caching times out, the media will appear later)
    if (effectiveMediaUrl && shouldCacheExternally(effectiveMediaUrl)) {
      cacheMediaAndUpdateMessage({
        messageId,
        mediaUrl: effectiveMediaUrl,
        messageType,
        mediaMimetype: effectiveMediaMimetype,
        connection,
        waMediaKey,
      });
    } else if (messageType !== 'text' && !effectiveMediaUrl) {
      // If there's no URL at all, we still try to fill it later using the messageId.
      cacheMediaFromWapiDownload({ messageId, messageType, mediaMimetype: effectiveMediaMimetype, connection })
        .then((cached) => {
          if (!cached?.publicUrl) return;
          return query(
            `UPDATE chat_messages
             SET media_url = $1,
                 media_mimetype = COALESCE($2, media_mimetype)
             WHERE message_id = $3`,
            [cached.publicUrl, cached.mime || effectiveMediaMimetype, messageId]
          );
        })
        .catch((err) => console.error('[W-API Cache] background download by id failed:', err?.message || err));
    }

    // Update conversation timestamp
    await query(
      `UPDATE conversations SET last_message_at = NOW() WHERE id = $1`,
      [conversationId]
    );

    console.log('[W-API] Outgoing message saved:', messageId, 'To:', remoteJid);
  } catch (error) {
    console.error('[W-API] Error handling outgoing message:', error);
  }
}

/**
 * Handle message status update
 */
async function handleStatusUpdate(connection, payload) {
  try {
    const messageId = payload.messageId || payload.id || payload.key?.id;
    if (!messageId) return;

    let status = 'sent';

    // W-API status event
    if (payload.event === 'webhookStatus' && typeof payload.status === 'string') {
      const s = payload.status.toUpperCase();
      if (s === 'SERVER') status = 'sent';
      else if (s === 'DELIVERY' || s === 'DELIVERED') status = 'delivered';
      else if (s === 'READ') status = 'read';
      else if (s === 'FAILED' || s === 'ERROR') status = 'failed';
    } else {
      // Legacy ack mapping
      const ack = payload.ack;
      if (ack === 1) status = 'sent';
      else if (ack === 2) status = 'delivered';
      else if (ack === 3) status = 'read';
      else if (ack === -1 || ack === 0) status = 'failed';
    }

    await query(
      `UPDATE chat_messages SET status = $1 WHERE message_id = $2`,
      [status, messageId]
    );

    console.log('[W-API] Status updated:', messageId, status);
  } catch (error) {
    console.error('[W-API] Error handling status update:', error);
  }
}

/**
 * Handle connection status update
 */
async function handleConnectionUpdate(connection, payload) {
  try {
    const connected = payload.connected === true || payload.status === 'connected' || payload.state === 'open';
    const phoneNumber = payload.phoneNumber || payload.phone || payload.wid?.split('@')[0];

    await query(
      `UPDATE connections SET status = $1, phone_number = COALESCE($2, phone_number), updated_at = NOW() WHERE id = $3`,
      [connected ? 'connected' : 'disconnected', phoneNumber, connection.id]
    );

    console.log('[W-API] Connection status updated:', connected ? 'connected' : 'disconnected');
  } catch (error) {
    console.error('[W-API] Error handling connection update:', error);
  }
}

/**
 * Extract message content from W-API payload
 * W-API uses msgContent object:
 * - msgContent.conversation: text message
 * - msgContent.imageMessage: image with caption
 * - msgContent.audioMessage: audio
 * - msgContent.videoMessage: video with caption
 * - msgContent.documentMessage: document with filename
 * - msgContent.stickerMessage: sticker
 * 
 * IMPORTANT: W-API may send media WITHOUT a direct URL.
 * In that case, we need to use the W-API download endpoint.
 */
function extractMessageContent(payload) {
  let messageType = 'text';
  let content = '';
  let mediaUrl = null;
  let mediaMimetype = null;
  let waMediaKey = null; // For encrypted WhatsApp media

  let msgContent = payload.msgContent || payload.message || {};

  // Skip protocol messages (system-level: edits, deletes, ephemeral settings, reactions, etc.)
  if (msgContent.protocolMessage || msgContent.reactionMessage || msgContent.pollUpdateMessage || msgContent.pollCreationMessage) {
    const skipType = msgContent.protocolMessage ? 'protocolMessage' 
      : msgContent.reactionMessage ? 'reactionMessage'
      : msgContent.pollUpdateMessage ? 'pollUpdateMessage'
      : 'pollCreationMessage';
    console.log(`[W-API Extract] Skipping ${skipType} - not a user message`);
    return { messageType: 'protocol', content: '', mediaUrl: null, mediaMimetype: null, waMediaKey: null };
  }

  // Log raw msgContent keys for debugging document issues
  const rawKeys = Object.keys(msgContent);
  if (rawKeys.length > 0) {
    console.log('[W-API Extract] msgContent keys:', rawKeys.join(', '));
  }

  // Unwrap ALL known nested wrappers recursively
  // WhatsApp/Baileys wraps messages in various containers
  const unwrappers = [
    'documentWithCaptionMessage',
    'viewOnceMessageV2',
    'viewOnceMessage',
    'viewOnceMessageV2Extension',
    'ephemeralMessage',
    'templateMessage',
    'buttonsMessage',
    'listMessage',
    'editedMessage',
  ];
  
  for (const wrapper of unwrappers) {
    if (msgContent[wrapper]?.message) {
      console.log(`[W-API Extract] Unwrapping ${wrapper}`);
      msgContent = { ...msgContent, ...msgContent[wrapper].message };
    }
  }
  
  // Some wrappers nest deeper (e.g., ephemeralMessage > viewOnceMessageV2 > message)
  for (const wrapper of unwrappers) {
    if (msgContent[wrapper]?.message) {
      console.log(`[W-API Extract] Unwrapping nested ${wrapper} (2nd pass)`);
      msgContent = { ...msgContent, ...msgContent[wrapper].message };
    }
  }

  // ---- Template message handling (official WhatsApp Business API) ----
  // Templates arrive as templateMessage with hydratedTemplate containing the rendered content
  const hydratedTemplate = msgContent.hydratedTemplate 
    || msgContent.hydratedFourRowTemplate 
    || msgContent.templateMessage?.hydratedTemplate
    || msgContent.templateMessage?.hydratedFourRowTemplate
    || null;

  if (hydratedTemplate) {
    const parts = [];
    if (hydratedTemplate.hydratedContentText) parts.push(hydratedTemplate.hydratedContentText);
    if (hydratedTemplate.hydratedTitleText) parts.unshift(hydratedTemplate.hydratedTitleText);
    if (hydratedTemplate.hydratedFooterText) parts.push(hydratedTemplate.hydratedFooterText);
    
    // Some templates have buttons – append button labels
    const buttons = hydratedTemplate.hydratedButtons || [];
    for (const btn of buttons) {
      const label = btn.quickReplyButton?.displayText 
        || btn.urlButton?.displayText 
        || btn.callButton?.displayText 
        || null;
      if (label) parts.push(`[${label}]`);
    }

    // Check for media in the template (header image/video/document)
    if (hydratedTemplate.imageMessage) {
      console.log('[W-API Extract] Template with image header');
      return {
        messageType: 'image',
        content: parts.join('\n') || '',
        mediaUrl: hydratedTemplate.imageMessage.url || hydratedTemplate.imageMessage.fileUrl || null,
        mediaMimetype: hydratedTemplate.imageMessage.mimetype || null,
        waMediaKey: hydratedTemplate.imageMessage.mediaKey || null,
      };
    }
    if (hydratedTemplate.videoMessage) {
      console.log('[W-API Extract] Template with video header');
      return {
        messageType: 'video',
        content: parts.join('\n') || '',
        mediaUrl: hydratedTemplate.videoMessage.url || hydratedTemplate.videoMessage.fileUrl || null,
        mediaMimetype: hydratedTemplate.videoMessage.mimetype || null,
        waMediaKey: hydratedTemplate.videoMessage.mediaKey || null,
      };
    }
    if (hydratedTemplate.documentMessage) {
      console.log('[W-API Extract] Template with document header');
      return {
        messageType: 'document',
        content: hydratedTemplate.documentMessage.fileName || parts.join('\n') || '[Documento]',
        mediaUrl: hydratedTemplate.documentMessage.url || hydratedTemplate.documentMessage.fileUrl || null,
        mediaMimetype: hydratedTemplate.documentMessage.mimetype || null,
        waMediaKey: hydratedTemplate.documentMessage.mediaKey || null,
      };
    }

    const templateText = parts.join('\n').trim();
    if (templateText) {
      console.log('[W-API Extract] Template message extracted:', templateText.slice(0, 100));
      return { messageType: 'text', content: templateText, mediaUrl: null, mediaMimetype: null, waMediaKey: null };
    }
  }

  // Also handle highlyStructuredMessage (older template format)
  if (msgContent.highlyStructuredMessage) {
    const hsm = msgContent.highlyStructuredMessage;
    const namespace = hsm.namespace || '';
    const elementName = hsm.elementName || '';
    const params = (hsm.params || []).map(p => p.default || p).join(', ');
    const hsmText = hsm.hydratedHsm?.hydratedTemplate?.hydratedContentText 
      || `[Template: ${elementName || namespace}${params ? ' - ' + params : ''}]`;
    console.log('[W-API Extract] HSM template message:', hsmText.slice(0, 100));
    return { messageType: 'text', content: hsmText, mediaUrl: null, mediaMimetype: null, waMediaKey: null };
  }

  // Helper to extract mediaKey from various locations
  const extractMediaKey = (obj) => {
    if (!obj) return null;
    return obj.mediaKey || obj.media_key || obj.key || null;
  };

  const pickFirstString = (obj, keys) => {
    if (!obj) return null;
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  };

  const pickMime = (obj) => {
    const m = pickFirstString(obj, ['mimetype', 'mimeType', 'type', 'contentType']);
    return m || null;
  };
  
  // Check for direct media URL at payload level (some W-API versions)
  const payloadMediaUrl = pickFirstString(payload, ['mediaUrl', 'url', 'fileUrl', 'downloadUrl', 'media', 'base64', 'data']);

  // Text message (W-API uses msgContent.conversation)
  if (typeof msgContent.conversation === 'string' && msgContent.conversation) {
    content = msgContent.conversation;
    messageType = 'text';
    return { messageType, content, mediaUrl, mediaMimetype, waMediaKey };
  }

  // Interactive message responses
  if (msgContent.buttonsResponseMessage) {
    const btnResp = msgContent.buttonsResponseMessage;
    content = btnResp.selectedDisplayText || btnResp.selectedId || '';
    return { messageType: 'text', content, mediaUrl, mediaMimetype, waMediaKey };
  }
  if (msgContent.templateButtonReplyMessage) {
    const btnResp = msgContent.templateButtonReplyMessage;
    content = btnResp.selectedDisplayText || btnResp.selectedId || '';
    return { messageType: 'text', content, mediaUrl, mediaMimetype, waMediaKey };
  }
  if (msgContent.listResponseMessage) {
    const listResp = msgContent.listResponseMessage;
    content = listResp.title || listResp.singleSelectReply?.selectedRowId || '';
    return { messageType: 'text', content, mediaUrl, mediaMimetype, waMediaKey };
  }
  if (msgContent.interactiveResponseMessage) {
    const interactiveResp = msgContent.interactiveResponseMessage;
    const bodyText = interactiveResp.body?.text || '';
    const nativeFlow = interactiveResp.nativeFlowResponseMessage;
    if (nativeFlow) {
      try {
        const params = JSON.parse(nativeFlow.paramsJson || '{}');
        content = params.title || params.id || bodyText || '[Resposta]';
      } catch {
        content = bodyText || '[Resposta]';
      }
    } else {
      content = bodyText || '[Resposta]';
    }
    return { messageType: 'text', content, mediaUrl, mediaMimetype, waMediaKey };
  }
  if (msgContent.interactiveMessage || msgContent.interactive) {
    const interactive = msgContent.interactiveMessage || msgContent.interactive;
    const reply = interactive.button_reply || interactive.list_reply || interactive.native_flow_response;
    if (reply) {
      content = reply.title || reply.name || reply.id;
    } else if (interactive.header || interactive.body || interactive.footer) {
      const body = interactive.body?.text || '';
      const footer = interactive.footer?.text ? `\n_${interactive.footer.text}_` : '';
      content = `${body}${footer}`.trim() || '[Mensagem interativa]';
    } else {
      content = '[Mensagem interativa]';
    }
    return { messageType: 'text', content, mediaUrl, mediaMimetype, waMediaKey };
  }

  // Extended text message (with link preview data)
  if (msgContent.extendedTextMessage) {
    const ext = msgContent.extendedTextMessage;
    content = ext.text || '';
    messageType = 'text';
    // Extract WhatsApp-provided link preview metadata
    let linkPreview = null;
    if (ext.matchedText || ext.canonicalUrl || ext.title || ext.description) {
      linkPreview = {};
      if (ext.matchedText) linkPreview.url = ext.matchedText;
      if (ext.canonicalUrl) linkPreview.canonicalUrl = ext.canonicalUrl;
      if (ext.title) linkPreview.title = ext.title;
      if (ext.description) linkPreview.description = ext.description;
      if (ext.jpegThumbnail) {
        const thumb = typeof ext.jpegThumbnail === 'string' ? ext.jpegThumbnail : null;
        if (thumb) linkPreview.thumbnail = thumb.startsWith('data:') ? thumb : `data:image/jpeg;base64,${thumb}`;
      }
      if (ext.previewType !== undefined) linkPreview.previewType = ext.previewType;
    }
    return { messageType, content, mediaUrl, mediaMimetype, waMediaKey, linkPreview };
  }

  // Image message
  if (msgContent.imageMessage) {
    messageType = 'image';
    mediaMimetype = pickMime(msgContent.imageMessage) || payload.mediaMimetype || payload.mimetype || null;
    mediaUrl =
      pickFirstString(msgContent.imageMessage, ['url', 'fileUrl', 'mediaUrl', 'link', 'downloadUrl', 'base64', 'data']) ||
      payloadMediaUrl;
    content = msgContent.imageMessage.caption || '';
    waMediaKey = extractMediaKey(msgContent.imageMessage) || extractMediaKey(payload);
    console.log('[W-API Extract] Image message found. MediaURL:', mediaUrl?.slice?.(0, 100), 'MIME:', mediaMimetype, 'hasMediaKey:', Boolean(waMediaKey));
    return { messageType, content, mediaUrl, mediaMimetype, waMediaKey };
  }

  // Audio message
  if (msgContent.audioMessage) {
    messageType = 'audio';
    mediaMimetype = pickMime(msgContent.audioMessage) || payload.mediaMimetype || payload.mimetype || null;
    mediaUrl =
      pickFirstString(msgContent.audioMessage, ['url', 'fileUrl', 'mediaUrl', 'link', 'downloadUrl', 'base64', 'data']) ||
      pickFirstString(payload, ['mediaUrl', 'url', 'fileUrl', 'downloadUrl', 'base64', 'data']);
    content = '[Áudio]';
    waMediaKey = extractMediaKey(msgContent.audioMessage) || extractMediaKey(payload);
    return { messageType, content, mediaUrl, mediaMimetype, waMediaKey };
  }

  // Video message
  if (msgContent.videoMessage) {
    messageType = 'video';
    mediaMimetype = pickMime(msgContent.videoMessage) || payload.mediaMimetype || payload.mimetype || null;
    mediaUrl =
      pickFirstString(msgContent.videoMessage, ['url', 'fileUrl', 'mediaUrl', 'link', 'downloadUrl', 'base64', 'data']) ||
      pickFirstString(payload, ['mediaUrl', 'url', 'fileUrl', 'downloadUrl', 'base64', 'data']);
    content = msgContent.videoMessage.caption || '';
    waMediaKey = extractMediaKey(msgContent.videoMessage) || extractMediaKey(payload);
    return { messageType, content, mediaUrl, mediaMimetype, waMediaKey };
  }

  // Document message
  if (msgContent.documentMessage) {
    messageType = 'document';
    mediaMimetype = pickMime(msgContent.documentMessage) || payload.mediaMimetype || payload.mimetype || null;
    mediaUrl =
      pickFirstString(msgContent.documentMessage, ['url', 'fileUrl', 'mediaUrl', 'link', 'downloadUrl', 'base64', 'data']) ||
      pickFirstString(payload, ['mediaUrl', 'url', 'fileUrl', 'downloadUrl', 'base64', 'data']);
    content = msgContent.documentMessage.fileName || '[Documento]';
    waMediaKey = extractMediaKey(msgContent.documentMessage) || extractMediaKey(payload);
    return { messageType, content, mediaUrl, mediaMimetype, waMediaKey };
  }

  // Sticker message
  if (msgContent.stickerMessage) {
    messageType = 'sticker';
    mediaMimetype = pickMime(msgContent.stickerMessage) || payload.mediaMimetype || payload.mimetype || null;
    mediaUrl =
      pickFirstString(msgContent.stickerMessage, ['url', 'fileUrl', 'mediaUrl', 'link', 'downloadUrl', 'base64', 'data']) ||
      pickFirstString(payload, ['mediaUrl', 'url', 'fileUrl', 'downloadUrl', 'base64', 'data']);
    content = '[Figurinha]';
    waMediaKey = extractMediaKey(msgContent.stickerMessage) || extractMediaKey(payload);
    return { messageType, content, mediaUrl, mediaMimetype, waMediaKey };
  }

  // Fallback: legacy format (payload.text, payload.body, etc.)
  if (payload.text || payload.body || payload.message) {
    content = payload.text || payload.body || payload.message;
    if (typeof content === 'object') {
      content = content.text || content.body || content.conversation || JSON.stringify(content);
    }
    messageType = 'text';
  }

  if (payload.image || payload.imageMessage) {
    messageType = 'image';
    mediaMimetype = mediaMimetype || payload.imageMessage?.mimetype || payload.mimetype || null;
    mediaUrl = payload.image || payload.imageMessage?.url || payload.mediaUrl || payload.url || null;
    content = payload.caption || payload.imageMessage?.caption || '';
    waMediaKey = extractMediaKey(payload.imageMessage) || extractMediaKey(payload);
  }

  if (payload.audio || payload.audioMessage) {
    messageType = 'audio';
    mediaMimetype = mediaMimetype || payload.audioMessage?.mimetype || payload.mimetype || null;
    mediaUrl = payload.audio || payload.audioMessage?.url || payload.mediaUrl || payload.url || null;
    content = '[Áudio]';
    waMediaKey = extractMediaKey(payload.audioMessage) || extractMediaKey(payload);
  }

  if (payload.video || payload.videoMessage) {
    messageType = 'video';
    mediaMimetype = mediaMimetype || payload.videoMessage?.mimetype || payload.mimetype || null;
    mediaUrl = payload.video || payload.videoMessage?.url || payload.mediaUrl || payload.url || null;
    content = payload.caption || payload.videoMessage?.caption || '';
    waMediaKey = extractMediaKey(payload.videoMessage) || extractMediaKey(payload);
  }

  if (payload.document || payload.documentMessage) {
    messageType = 'document';
    mediaMimetype = mediaMimetype || payload.documentMessage?.mimetype || payload.mimetype || null;
    mediaUrl = payload.document || payload.documentMessage?.url || payload.mediaUrl || payload.url || null;
    content = payload.fileName || payload.documentMessage?.fileName || '[Documento]';
    waMediaKey = extractMediaKey(payload.documentMessage) || extractMediaKey(payload);
  }

  if (payload.sticker || payload.stickerMessage) {
    messageType = 'sticker';
    mediaMimetype = mediaMimetype || payload.stickerMessage?.mimetype || payload.mimetype || null;
    mediaUrl = payload.sticker || payload.stickerMessage?.url || payload.mediaUrl || payload.url || null;
    content = '[Figurinha]';
    waMediaKey = extractMediaKey(payload.stickerMessage) || extractMediaKey(payload);
  }

  // FINAL FALLBACK: If we still have no content/media, check for any media indicators
  // This catches unknown wrapper formats and edge cases
  if (!content && !mediaUrl && messageType === 'text') {
    // Check if payload has media indicators we missed
    const hasMediaIndicator = payload.hasMedia || payload.mediaUrl || payload.url || payload.fileUrl || 
                               payload.downloadUrl || payload.media || payload.base64 || payload.data;
    const payloadMime = payload.mimetype || payload.mediaMimetype || payload.mimeType || null;
    
    if (hasMediaIndicator || payloadMime) {
      // Detect type from mimetype
      const mimeStr = (payloadMime || '').toLowerCase();
      if (mimeStr.startsWith('image/')) messageType = 'image';
      else if (mimeStr.startsWith('audio/')) messageType = 'audio';
      else if (mimeStr.startsWith('video/')) messageType = 'video';
      else messageType = 'document';
      
      mediaUrl = typeof hasMediaIndicator === 'string' ? hasMediaIndicator : null;
      mediaMimetype = payloadMime;
      content = payload.fileName || payload.caption || (messageType === 'audio' ? '[Áudio]' : '[Documento]');
      waMediaKey = extractMediaKey(payload);
      
      console.log('[W-API Extract] FALLBACK media detection:', { messageType, mediaMimetype, hasUrl: Boolean(mediaUrl), content });
    }
    
    // Also scan msgContent for any *Message key we might have missed
    if (!content && !mediaUrl) {
      const msgKeys = Object.keys(msgContent);
      const mediaKey = msgKeys.find(k => k.endsWith('Message') && typeof msgContent[k] === 'object' && msgContent[k] !== null);
      if (mediaKey) {
        const mediaObj = msgContent[mediaKey];
        messageType = 'document';
        mediaMimetype = pickMime(mediaObj) || payloadMime;
        mediaUrl = pickFirstString(mediaObj, ['url', 'fileUrl', 'mediaUrl', 'link', 'downloadUrl', 'base64', 'data']);
        content = mediaObj.fileName || mediaObj.caption || `[${mediaKey.replace('Message', '')}]`;
        waMediaKey = extractMediaKey(mediaObj);
        
        console.log(`[W-API Extract] FALLBACK caught unknown message type via key "${mediaKey}":`, { messageType, mediaMimetype, content });
      }
    }
  }

  return { messageType, content, mediaUrl, mediaMimetype, waMediaKey };
}

// ==========================================
// PROFILE PICTURE
// ==========================================

// Fetch and cache profile picture from W-API
router.get('/profile-picture/:connectionId/:phone', authenticate, async (req, res) => {
  try {
    const { connectionId, phone } = req.params;
    
    // Get connection
    const conn = await getAccessibleConnection(connectionId, req.userId);
    if (!conn) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    // Only works for W-API connections
    if (!conn.instance_id || !conn.wapi_token) {
      return res.status(400).json({ error: 'Apenas conexões W-API suportam fotos de perfil' });
    }

    // Clean phone number
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Número de telefone inválido' });
    }

    // Check if we already have a cached version
    const cacheDir = path.join(UPLOADS_DIR, 'profile-pictures');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cacheFile = path.join(cacheDir, `${conn.instance_id}_${cleanPhone}.jpg`);
    const cacheMetaFile = path.join(cacheDir, `${conn.instance_id}_${cleanPhone}.meta`);
    
    // Check cache (valid for 24 hours)
    const cacheMaxAge = 24 * 60 * 60 * 1000; // 24 hours
    if (fs.existsSync(cacheFile) && fs.existsSync(cacheMetaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(cacheMetaFile, 'utf8'));
        const age = Date.now() - meta.fetchedAt;
        if (age < cacheMaxAge) {
          // Return cached URL
          return res.json({ 
            url: `${API_BASE_URL}/uploads/profile-pictures/${conn.instance_id}_${cleanPhone}.jpg`,
            cached: true 
          });
        }
      } catch (e) {
        // Ignore meta read errors
      }
    }

    // Fetch from W-API
    const apiUrl = `https://api.w-api.app/v1/contacts/profile-picture?instanceId=${conn.instance_id}&phoneNumber=${cleanPhone}`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${conn.wapi_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`W-API profile picture failed: ${response.status}`);
      return res.json({ url: null, error: 'Foto não disponível' });
    }

    const data = await response.json();
    const pictureUrl = data.profilePicture || data.url || data.picture || null;

    if (!pictureUrl) {
      return res.json({ url: null, error: 'Sem foto de perfil' });
    }

    // Download and cache the image
    try {
      const imgResponse = await fetch(pictureUrl);
      if (imgResponse.ok) {
        const buffer = await imgResponse.arrayBuffer();
        fs.writeFileSync(cacheFile, Buffer.from(buffer));
        fs.writeFileSync(cacheMetaFile, JSON.stringify({ fetchedAt: Date.now(), originalUrl: pictureUrl }));
        
        return res.json({ 
          url: `${API_BASE_URL}/uploads/profile-pictures/${conn.instance_id}_${cleanPhone}.jpg`,
          cached: false 
        });
      }
    } catch (downloadError) {
      console.warn('Failed to cache profile picture:', downloadError.message);
      // Return the original URL if caching fails
      return res.json({ url: pictureUrl, cached: false });
    }

    return res.json({ url: pictureUrl, cached: false });
  } catch (error) {
    console.error('Profile picture error:', error);
    res.status(500).json({ error: 'Erro ao buscar foto de perfil' });
  }
});

// Bulk fetch profile pictures for multiple conversations
router.post('/profile-pictures', authenticate, async (req, res) => {
  try {
    const { conversations } = req.body;
    
    if (!Array.isArray(conversations) || conversations.length === 0) {
      return res.json({ pictures: {} });
    }

    // Limit to 20 at a time
    const limited = conversations.slice(0, 20);
    const pictures = {};

    for (const conv of limited) {
      if (!conv.connection_id || !conv.contact_phone || conv.is_group) continue;

      try {
        // Get connection
        const conn = await getAccessibleConnection(conv.connection_id, req.userId);
        if (!conn || !conn.instance_id || !conn.wapi_token) continue;

        const cleanPhone = conv.contact_phone.replace(/\D/g, '');
        if (!cleanPhone || cleanPhone.length < 10) continue;

        // Check cache
        const cacheDir = path.join(UPLOADS_DIR, 'profile-pictures');
        const cacheFile = path.join(cacheDir, `${conn.instance_id}_${cleanPhone}.jpg`);
        const cacheMetaFile = path.join(cacheDir, `${conn.instance_id}_${cleanPhone}.meta`);
        
        const cacheMaxAge = 24 * 60 * 60 * 1000;
        if (fs.existsSync(cacheFile) && fs.existsSync(cacheMetaFile)) {
          try {
            const meta = JSON.parse(fs.readFileSync(cacheMetaFile, 'utf8'));
            const age = Date.now() - meta.fetchedAt;
            if (age < cacheMaxAge) {
              pictures[conv.id] = `${API_BASE_URL}/uploads/profile-pictures/${conn.instance_id}_${cleanPhone}.jpg`;
              continue;
            }
          } catch (e) { /* ignore */ }
        }

        // Fetch from W-API (with short timeout)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        
        try {
          const apiUrl = `https://api.w-api.app/v1/contacts/profile-picture?instanceId=${conn.instance_id}&phoneNumber=${cleanPhone}`;
          const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${conn.wapi_token}`,
              'Accept': 'application/json',
            },
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (response.ok) {
            const data = await response.json();
            const pictureUrl = data.profilePicture || data.url || data.picture || null;
            
            if (pictureUrl) {
              // Try to cache
              try {
                if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
                const imgController = new AbortController();
                const imgTimeout = setTimeout(() => imgController.abort(), 3000);
                const imgResponse = await fetch(pictureUrl, { signal: imgController.signal });
                clearTimeout(imgTimeout);
                
                if (imgResponse.ok) {
                  const buffer = await imgResponse.arrayBuffer();
                  fs.writeFileSync(cacheFile, Buffer.from(buffer));
                  fs.writeFileSync(cacheMetaFile, JSON.stringify({ fetchedAt: Date.now() }));
                  pictures[conv.id] = `${API_BASE_URL}/uploads/profile-pictures/${conn.instance_id}_${cleanPhone}.jpg`;
                } else {
                  pictures[conv.id] = pictureUrl;
                }
              } catch (e) {
                pictures[conv.id] = pictureUrl;
              }
            }
          }
        } catch (fetchError) {
          clearTimeout(timeout);
          // Ignore individual fetch errors
        }
      } catch (e) {
        // Skip this conversation
      }
    }

    res.json({ pictures });
  } catch (error) {
    console.error('Bulk profile pictures error:', error);
    res.status(500).json({ error: 'Erro ao buscar fotos de perfil' });
  }
});

export default router;
