import 'dotenv/config'; // Preload — side-effect import, loads .env BEFORE other modules

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import crypto from 'crypto';
import authRoutes from './routes/auth.js';
import connectionsRoutes from './routes/connections.js';
import messagesRoutes from './routes/messages.js';
import contactsRoutes from './routes/contacts.js';
import campaignsRoutes from './routes/campaigns.js';
import organizationsRoutes from './routes/organizations.js';
import asaasRoutes from './routes/asaas.js';
import adminRoutes from './routes/admin.js';
import uploadsRoutes from './routes/uploads.js';
import notificationsRoutes from './routes/notifications.js';
import evolutionRoutes from './routes/evolution.js';
import wapiRoutes from './routes/wapi.js';
import uazapiRoutes from './routes/uazapi.js';
import chatRoutes from './routes/chat.js';
import quickRepliesRoutes from './routes/quick-replies.js';
import chatbotsRoutes from './routes/chatbots.js';
import departmentsRoutes from './routes/departments.js';
import flowsRoutes from './routes/flows.js';
import crmRoutes from './routes/crm.js';
import crmAutomationRoutes from './routes/crm-automation.js';
import emailRoutes from './routes/email.js';
import googleCalendarRoutes from './routes/google-calendar.js';
import billingQueueRoutes from './routes/billing-queue.js';
import transcribeRoutes from './routes/transcribe.js';
import aiAgentsRoutes from './routes/ai-agents.js';
import externalFormsRoutes from './routes/external-forms.js';
import leadDistributionRoutes from './routes/lead-distribution.js';
import leadWebhooksRoutes from './routes/lead-webhooks.js';
import leadScoringRoutes from './routes/lead-scoring.js';
import conversationSummaryRoutes from './routes/conversation-summary.js';
import nurturingRoutes from './routes/nurturing.js';
import ctwaAnalyticsRoutes from './routes/ctwa-analytics.js';
import groupSecretaryRoutes from './routes/group-secretary.js';
import ghostRoutes from './routes/ghost.js';
import projectsRoutes from './routes/projects.js';
import devWorkspaceRoutes from './routes/dev-workspace.js';
import pushRoutes from './routes/push.js';
import taskBoardsRoutes from './routes/task-boards.js';
import leadGleegoRoutes from './routes/lead-gleego.js';
import globalAgentsRoutes from './routes/global-agents.js';
import metaTemplatesRoutes from './routes/meta-templates.js';
import metaLeadAdsRoutes, { webhookRouter as metaWebhookRouter } from './routes/meta-lead-ads.js';
import docSignaturesRoutes from './routes/doc-signatures.js';
import telehealthRoutes from './routes/telehealth.js';
import linkPreviewRoutes from './routes/link-preview.js';
import salesSeoRoutes from './routes/sales-seo.js';
import { handleAutoReplies } from './lib/auto-reply-service.js';
import { executeFlow, continueFlowWithInput } from './lib/flow-executor.js';
import { processIncomingWithAgent } from './lib/ai-agent-processor.js';
import supervisorRoutes from './routes/supervisor.js';
import agentModesRoutes from './routes/agent-modes.js';
import { startAgentModesScheduler } from './agent-modes-scheduler.js';

import { initDatabase } from './init-db.js';
import { executeNotifications } from './scheduler.js';
import { executeCampaignMessages } from './campaign-scheduler.js';
import { executeScheduledMessages } from './scheduled-messages.js';
import { syncTodaysDueBoletos, checkPaymentStatusUpdates } from './asaas-auto-sync.js';
import { executeCRMAutomations } from './crm-automation-scheduler.js';
import { processEmailQueue } from './email-scheduler.js';
import { executeNurturing } from './nurturing-scheduler.js';
import { executeTaskReminders } from './task-reminder-scheduler.js';
import { executeSecretaryFollowups } from './secretary-followup-scheduler.js';
import { executeSecretaryDigest } from './secretary-digest-scheduler.js';
import { executeWaitReplyTimeouts } from './wait-reply-scheduler.js';
import { checkInactivityTimeouts } from './lib/ai-agent-processor.js';
import { requestContext } from './request-context.js';
import { log, logError } from './logger.js';

// dotenv already loaded via 'dotenv/config' import at top

const app = express();
const PORT = process.env.PORT || 3001;

// Add CORS headers to EVERY response (must be absolute first)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Max-Age', '86400');
  
  // Handle preflight immediately
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// CORS configuration - belt and suspenders
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: false,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));


app.use(express.json({
  limit: '200mb',
  verify: (req, _res, buf) => {
    // capture raw body for webhook signature verification (Meta etc.)
    if (req.originalUrl && req.originalUrl.startsWith('/api/meta/webhook')) {
      req.rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Request-scoped context + correlation id for structured logs
app.use((req, res, next) => {
  const startedAt = Date.now();
  const rawHeader = req.headers['x-request-id'];
  const incomingRequestId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const requestId = (incomingRequestId && String(incomingRequestId).trim()) || crypto.randomUUID();

  requestContext.run(
    {
      request_id: requestId,
      http_method: req.method,
      http_path: req.originalUrl,
    },
    () => {
      req.requestId = requestId;
      res.setHeader('X-Request-Id', requestId);

      log('info', 'http.request', {
        http_method: req.method,
        http_path: req.originalUrl,
      });

      res.on('finish', () => {
        log('info', 'http.response', {
          http_method: req.method,
          http_path: req.originalUrl,
          status_code: res.statusCode,
          duration_ms: Date.now() - startedAt,
        });
      });

      next();
    }
  );
});

// Serve uploaded files statically with CORS headers
const uploadsDir = path.join(process.cwd(), 'uploads');

// Legacy compatibility: some records still point to /uploads/public/... instead of /api/uploads/public/...
app.get('/uploads/public/:stored/:downloadName', (req, res) => {
  const stored = String(req.params.stored || '');
  const downloadName = String(req.params.downloadName || '');
  const safe = /^[a-zA-Z0-9._-]+$/;

  if (!safe.test(stored) || !safe.test(downloadName)) {
    return res.status(400).json({ error: 'Nome de arquivo inválido' });
  }

  let filePath = path.join(uploadsDir, stored);
  // If stored name not found, try downloadName (records that duplicate the name)
  if (!fs.existsSync(filePath) && downloadName !== stored) {
    filePath = path.join(uploadsDir, downloadName);
  }

  const ext = path.extname(downloadName) || path.extname(stored);
  if (ext) {
    res.type(ext);
  }
  res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
  return res.sendFile(filePath, (error) => {
    if (error && !res.headersSent) {
      return res.status(error.statusCode || 404).json({ error: 'Arquivo não encontrado' });
    }
  });
});

app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    // Set correct MIME types for audio/video
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.ogg') {
      res.setHeader('Content-Type', 'audio/ogg');
    } else if (ext === '.mp3') {
      res.setHeader('Content-Type', 'audio/mpeg');
    } else if (ext === '.m4a') {
      res.setHeader('Content-Type', 'audio/mp4');
    } else if (ext === '.wav') {
      res.setHeader('Content-Type', 'audio/wav');
    } else if (ext === '.aac') {
      res.setHeader('Content-Type', 'audio/aac');
    } else if (ext === '.mp4') {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (ext === '.webm') {
      // Many voice notes are stored as .webm; prefer audio/webm for broad compatibility
      res.setHeader('Content-Type', 'audio/webm');
    }
  }
}));


// ===========================
// Meta Cloud API Webhook (public - no auth)
// ===========================
import { query as dbQuery } from './db.js';

// In-memory buffer for Meta webhook debug
const metaWebhookLog = [];
const MAX_META_LOG = 500;
const META_LOG_PREVIEW_LIMIT = 2500;

function maskMetaValue(value, visibleChars = 6) {
  const normalized = String(value || '');
  if (!normalized) return null;
  if (normalized.length <= visibleChars) return normalized;
  return `${normalized.slice(0, visibleChars)}…${normalized.slice(-visibleChars)}`;
}

function toPreview(value, limit = META_LOG_PREVIEW_LIMIT) {
  if (value == null) return null;

  const serialized = typeof value === 'string'
    ? value
    : (() => {
        try {
          return JSON.stringify(value);
        } catch {
          return '[unserializable]';
        }
      })();

  return serialized.length > limit ? `${serialized.slice(0, limit)}…` : serialized;
}

function getMetaRequestHeaders(req) {
  return {
    user_agent: req.get('user-agent') || null,
    content_type: req.get('content-type') || null,
    x_hub_signature_256: maskMetaValue(req.get('x-hub-signature-256'), 10),
    x_forwarded_for: req.get('x-forwarded-for') || null,
  };
}

function summarizeMetaPayload(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const changes = entries.flatMap((entry) => Array.isArray(entry?.changes) ? entry.changes : []);

  return {
    object: body?.object || null,
    entry_count: entries.length,
    entry_ids: entries.map((entry) => entry?.id).filter(Boolean),
    field_names: changes.map((change) => change?.field).filter(Boolean),
    phone_number_ids: changes.map((change) => change?.value?.metadata?.phone_number_id).filter(Boolean),
    has_messages: changes.some((change) => (change?.value?.messages?.length || 0) > 0),
    has_statuses: changes.some((change) => (change?.value?.statuses?.length || 0) > 0),
    message_count: changes.reduce((total, change) => total + (change?.value?.messages?.length || 0), 0),
    status_count: changes.reduce((total, change) => total + (change?.value?.statuses?.length || 0), 0),
  };
}

function logMetaEvent(type, data = {}) {
  metaWebhookLog.unshift({
    type,
    level: data.level || (type.includes('error') || type.includes('rejected') || type.includes('not_found') ? 'error' : 'info'),
    connectionId: data.connection_id || data.connectionId || null,
    requestId: data.request_id || data.requestId || null,
    data,
    timestamp: new Date().toISOString(),
  });

  if (metaWebhookLog.length > MAX_META_LOG) metaWebhookLog.length = MAX_META_LOG;
}

// GET: Meta webhook verification (hub.verify_token challenge)
app.get('/api/meta/webhook', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyContext = {
    request_id: req.requestId || null,
    method: req.method,
    headers: getMetaRequestHeaders(req),
    query: {
      mode: mode || null,
      verify_token: maskMetaValue(token),
      challenge_size: String(challenge || '').length,
    },
  };

  logMetaEvent('verify_request_received', verifyContext);

  if (mode !== 'subscribe' || !token) {
    logMetaEvent('verify_request_rejected', {
      ...verifyContext,
      reason: 'invalid_mode_or_missing_verify_token',
      status_code: 403,
    });
    return res.sendStatus(403);
  }

  try {
    const result = await dbQuery(
      `SELECT id FROM connections WHERE provider = 'meta' AND meta_webhook_verify_token = $1 LIMIT 1`,
      [token]
    );

    if (result.rows.length === 0) {
      logMetaEvent('verify_token_not_found', {
        ...verifyContext,
        reason: 'verify_token_not_found',
        status_code: 403,
      });
      console.log('[Meta Webhook] Verify token not found:', token);
      return res.sendStatus(403);
    }

    logMetaEvent('verify_success', {
      ...verifyContext,
      connection_id: result.rows[0].id,
      status_code: 200,
    });
    console.log('[Meta Webhook] Verification successful for connection:', result.rows[0].id);
    return res.status(200).send(challenge);
  } catch (err) {
    logMetaEvent('verify_error', {
      ...verifyContext,
      error: err.message,
      status_code: 500,
    });
    console.error('[Meta Webhook] Verification error:', err.message);
    return res.sendStatus(500);
  }
});

// GET: Meta webhook debug log
app.get('/api/meta/webhook-log', async (req, res) => {
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 200, 1), MAX_META_LOG);
  const connectionId = typeof req.query.connectionId === 'string' && req.query.connectionId.trim()
    ? req.query.connectionId.trim()
    : null;
  const includeUnassigned = req.query.includeUnassigned !== 'false';

  const events = metaWebhookLog
    .filter((entry) => {
      if (!connectionId) return true;
      if (entry.connectionId === connectionId) return true;
      return includeUnassigned && !entry.connectionId;
    })
    .slice(0, limit);

  res.json({ events });
});

app.delete('/api/meta/webhook-log', async (req, res) => {
  const connectionId = typeof req.query.connectionId === 'string' && req.query.connectionId.trim()
    ? req.query.connectionId.trim()
    : null;
  const previousLength = metaWebhookLog.length;

  if (!connectionId) {
    metaWebhookLog.length = 0;
  } else {
    for (let index = metaWebhookLog.length - 1; index >= 0; index -= 1) {
      if (metaWebhookLog[index].connectionId === connectionId) {
        metaWebhookLog.splice(index, 1);
      }
    }
  }

  res.json({ success: true, removed: previousLength - metaWebhookLog.length });
});

// GET: Meta unsupported message types log (filtered view)
app.get('/api/meta/unsupported-log', async (req, res) => {
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), MAX_META_LOG);
  const connectionId = typeof req.query.connectionId === 'string' && req.query.connectionId.trim()
    ? req.query.connectionId.trim()
    : null;

  const events = metaWebhookLog
    .filter((entry) => {
      if (entry.event !== 'unsupported_message_type') return false;
      if (connectionId && entry.connectionId !== connectionId) return false;
      return true;
    })
    .slice(0, limit);

  res.json({ events, total: events.length });
});

// POST: Meta webhook incoming messages
app.post('/api/meta/webhook', async (req, res) => {
  const body = req.body;
  const payloadSummary = summarizeMetaPayload(body);

  logMetaEvent('delivery_request_received', {
    request_id: req.requestId || null,
    method: req.method,
    headers: getMetaRequestHeaders(req),
    payload_summary: payloadSummary,
    body_preview: toPreview(body),
  });

  // Always respond 200 immediately to Meta
  res.sendStatus(200);
  logMetaEvent('delivery_acknowledged', {
    request_id: req.requestId || null,
    method: req.method,
    status_code: 200,
    payload_summary: payloadSummary,
  });

  try {
    logMetaEvent('received', {
      request_id: req.requestId || null,
      object: body?.object,
      entry_count: body?.entry?.length,
      entry_ids: body?.entry?.map(e => e.id),
      has_messages: body?.entry?.some(e => e.changes?.some(c => c.value?.messages?.length > 0)),
      has_statuses: body?.entry?.some(e => e.changes?.some(c => c.value?.statuses?.length > 0)),
      raw_fields: body?.entry?.flatMap(e => (e.changes || []).map(c => c.field)),
    });

    // Detailed logging for debugging
    console.log('[Meta Webhook] Received payload:', JSON.stringify({
      object: body?.object,
      entry_count: body?.entry?.length,
      entry_ids: body?.entry?.map(e => e.id),
    }));

    if (!body?.object || body.object !== 'whatsapp_business_account') {
      logMetaEvent('ignored', {
        request_id: req.requestId || null,
        reason: 'not_whatsapp_business_account',
        object: body?.object,
      });
      console.log('[Meta Webhook] Ignored: object is not whatsapp_business_account:', body?.object);
      return;
    }

    for (const entry of (body.entry || [])) {
      const wabaId = entry.id; // This is the WABA ID from Meta
      
      for (const change of (entry.changes || [])) {
        if (change.field !== 'messages') {
          logMetaEvent('change_ignored', {
            request_id: req.requestId || null,
            waba_id: wabaId,
            field: change?.field || null,
            reason: 'field_not_messages',
          });
          continue;
        }
        const value = change.value;
        if (!value) {
          logMetaEvent('change_ignored', {
            request_id: req.requestId || null,
            waba_id: wabaId,
            field: change?.field || null,
            reason: 'empty_change_value',
          });
          continue;
        }

        const phoneNumberId = value.metadata?.phone_number_id;
        const displayPhone = value.metadata?.display_phone_number;
        let connectionMatchStrategy = 'meta_phone_number_id';

        logMetaEvent('change_received', {
          request_id: req.requestId || null,
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          display_phone: displayPhone,
          message_count: value.messages?.length || 0,
          status_count: value.statuses?.length || 0,
        });
        
        console.log('[Meta Webhook] Processing change:', JSON.stringify({
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          display_phone: displayPhone,
          messages_count: value.messages?.length || 0,
          statuses_count: value.statuses?.length || 0,
          contacts: value.contacts?.map(c => ({ name: c.profile?.name, wa_id: c.wa_id })),
        }));

        if (!phoneNumberId) {
          logMetaEvent('change_ignored', {
            request_id: req.requestId || null,
            waba_id: wabaId,
            display_phone: displayPhone,
            reason: 'missing_phone_number_id',
          });
          console.log('[Meta Webhook] No phone_number_id in metadata, skipping');
          continue;
        }

        // Find the connection - try by phone_number_id first, then fallback to waba_id
        let connResult = await dbQuery(
          `SELECT c.*, COALESCE(c.organization_id, om.organization_id) AS organization_id
             FROM connections c
             LEFT JOIN organization_members om ON om.user_id = c.user_id
            WHERE c.provider = 'meta' AND c.meta_phone_number_id = $1
            LIMIT 1`,
          [phoneNumberId]
        );
        
        // Fallback: match by WABA ID if phone_number_id doesn't match
        if (connResult.rows.length === 0 && wabaId) {
          connectionMatchStrategy = 'meta_waba_id';
          console.log('[Meta Webhook] No match by phone_number_id, trying waba_id:', wabaId);
          connResult = await dbQuery(
            `SELECT c.*, COALESCE(c.organization_id, om.organization_id) AS organization_id
               FROM connections c
               LEFT JOIN organization_members om ON om.user_id = c.user_id
              WHERE c.provider = 'meta' AND c.meta_waba_id = $1
              LIMIT 1`,
            [wabaId]
          );
          
          // Auto-update the phone_number_id if we found by waba_id
          if (connResult.rows.length > 0) {
            logMetaEvent('connection_identifiers_synced', {
              request_id: req.requestId || null,
              connection_id: connResult.rows[0].id,
              match_strategy: connectionMatchStrategy,
              previous_phone_number_id: connResult.rows[0].meta_phone_number_id || null,
              phone_number_id: phoneNumberId,
              waba_id: wabaId,
            });
            console.log('[Meta Webhook] Found by waba_id! Auto-updating meta_phone_number_id from', connResult.rows[0].meta_phone_number_id, 'to', phoneNumberId);
            await dbQuery(
              `UPDATE connections SET meta_phone_number_id = $1 WHERE id = $2`,
              [phoneNumberId, connResult.rows[0].id]
            );
          }
        }

        // Last resort: if only one meta connection exists, use it
        if (connResult.rows.length === 0) {
          connectionMatchStrategy = 'single_meta_connection';
          console.log('[Meta Webhook] No match by phone_number_id or waba_id, trying single meta connection fallback');
          connResult = await dbQuery(
            `SELECT c.*, COALESCE(c.organization_id, om.organization_id) AS organization_id
               FROM connections c
               LEFT JOIN organization_members om ON om.user_id = c.user_id
              WHERE c.provider = 'meta'
              LIMIT 2`
          );
          if (connResult.rows.length === 1) {
            logMetaEvent('connection_identifiers_synced', {
              request_id: req.requestId || null,
              connection_id: connResult.rows[0].id,
              match_strategy: connectionMatchStrategy,
              previous_phone_number_id: connResult.rows[0].meta_phone_number_id || null,
              phone_number_id: phoneNumberId,
              waba_id: wabaId,
            });
            console.log('[Meta Webhook] Single meta connection found, auto-updating phone_number_id and waba_id');
            await dbQuery(
              `UPDATE connections SET meta_phone_number_id = $1, meta_waba_id = COALESCE(meta_waba_id, $2) WHERE id = $3`,
              [phoneNumberId, wabaId, connResult.rows[0].id]
            );
          } else {
            logMetaEvent('connection_not_found', { phone_number_id: phoneNumberId, waba_id: wabaId, meta_connections_count: connResult.rows.length });
            console.log('[Meta Webhook] Cannot determine connection. Found', connResult.rows.length, 'meta connections. phone_number_id:', phoneNumberId, 'waba_id:', wabaId);
            continue;
          }
        }

        const connection = connResult.rows[0];
        logMetaEvent('connection_matched', {
          request_id: req.requestId || null,
          connection_id: connection.id,
          match_strategy: connectionMatchStrategy,
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          display_phone: displayPhone,
        });

        // Process incoming messages
        for (const message of (value.messages || [])) {
          try {
            const from = message.from; // sender phone
            const msgType = message.type;
            let content = '';
            let mediaUrl = null;
            let effectiveType = msgType;

            switch (msgType) {
              case 'text':
                content = message.text?.body || '';
                break;
              case 'image':
                content = message.image?.caption || '[Imagem]';
                mediaUrl = message.image?.id;
                break;
              case 'video':
                content = message.video?.caption || '[Vídeo]';
                mediaUrl = message.video?.id;
                break;
              case 'audio':
                content = '[Áudio]';
                mediaUrl = message.audio?.id;
                break;
              case 'document':
                content = message.document?.caption || message.document?.filename || '[Documento]';
                mediaUrl = message.document?.id;
                break;
              case 'sticker':
                content = '[Sticker]';
                mediaUrl = message.sticker?.id;
                break;
              case 'location':
                content = `[Localização: ${message.location?.latitude}, ${message.location?.longitude}]`;
                break;
              case 'contacts':
                content = `[Contato: ${message.contacts?.[0]?.name?.formatted_name || ''}]`;
                break;
              case 'reaction':
                content = message.reaction?.emoji || '👍';
                break;
              case 'interactive':
                // Replies to template buttons / list messages
                content = message.interactive?.button_reply?.title
                  || message.interactive?.list_reply?.title
                  || message.interactive?.list_reply?.description
                  || message.interactive?.nfm_reply?.body
                  || JSON.stringify(message.interactive || {});
                effectiveType = 'text';
                break;
              case 'button':
                // Quick-reply button responses
                content = message.button?.text || message.button?.payload || '[Botão]';
                effectiveType = 'text';
                break;
              case 'order':
                content = `[Pedido: ${message.order?.product_items?.length || 0} itens]`;
                break;
              default:
                content = `[${msgType}]`;
                // Log full payload for unsupported types so we can diagnose what Meta sent
                logMetaEvent('unsupported_message_type', {
                  request_id: req.requestId || null,
                  connection_id: connection.id,
                  from: message.from,
                  message_id: message.id,
                  type: msgType,
                  raw_message: JSON.parse(JSON.stringify(message)),
                });
                console.warn(`[Meta Webhook] UNSUPPORTED message type "${msgType}" from ${message.from}. Full payload:`, JSON.stringify(message));
            }

            // Persist a stable internal URL by Meta media id.
            // This avoids 404s when temporary lookaside URLs expire or local files are missing.
            let finalMediaUrl = mediaUrl ? `/api/uploads/meta/${mediaUrl}` : null;
            let mediaMimetype = null;
            if (mediaUrl && connection.meta_token) {
              try {
                const mediaInfoRes = await fetch(`https://graph.facebook.com/v21.0/${mediaUrl}`, {
                  headers: { Authorization: `Bearer ${connection.meta_token}` }
                });
                if (mediaInfoRes.ok) {
                  const mediaInfo = await mediaInfoRes.json();
                  mediaMimetype = mediaInfo.mime_type || null;
                  console.log(`[Meta Webhook] Media linked by id: ${mediaUrl} (${mediaMimetype || 'mime desconhecido'})`);
                } else {
                  console.error(`[Meta Webhook] Media info lookup failed: ${mediaInfoRes.status}`);
                }
              } catch (mediaErr) {
                console.error('[Meta Webhook] Media download error:', mediaErr.message);
              }
            }

            // Normalize phone
            const normalizedPhone = from.replace(/\D/g, '');
            const contactName = value.contacts?.[0]?.profile?.name || normalizedPhone;
            const remoteJid = `${normalizedPhone}@s.whatsapp.net`;

            // Find or create conversation (using conversations table with contact_phone/remote_jid)
            let convResult = await dbQuery(
              `SELECT id FROM conversations 
               WHERE connection_id = $1 AND (contact_phone = $2 OR remote_jid = $3)
               LIMIT 1`,
              [connection.id, normalizedPhone, remoteJid]
            );

            if (convResult.rows.length === 0) {
              convResult = await dbQuery(
                `INSERT INTO conversations 
                  (connection_id, remote_jid, contact_phone, contact_name, is_archived, unread_count, attendance_status, created_at, updated_at, last_message_at)
                 VALUES ($1, $2, $3, $4, false, 0, 'waiting', NOW(), NOW(), NOW())
                 RETURNING id`,
                [connection.id, remoteJid, normalizedPhone, contactName]
              );
            }
            const conversationId = convResult.rows[0].id;

            // Save message to chat_messages (matching the schema used by the chat system)
            const messageId = message.id || `meta_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await dbQuery(
              `INSERT INTO chat_messages 
                (conversation_id, message_id, from_me, content, message_type, media_url, media_mimetype, sender_name, sender_phone, status, timestamp)
               VALUES ($1, $2, false, $3, $4, $5, $6, $7, $8, 'received', NOW())
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL AND message_id NOT LIKE 'temp_%' DO NOTHING`,
              [conversationId, messageId, content, effectiveType, finalMediaUrl, mediaMimetype, contactName, normalizedPhone]
            );

            // Update conversation
            await dbQuery(
              `UPDATE conversations SET last_message_at = NOW(), unread_count = unread_count + 1, updated_at = NOW(), 
               contact_name = COALESCE(NULLIF(contact_name, ''), $2)
               WHERE id = $1`,
              [conversationId, contactName]
            );

            // If conversation was finished, reopen to waiting
            await dbQuery(
              `UPDATE conversations SET attendance_status = 'waiting' 
               WHERE id = $1 AND attendance_status = 'finished'`,
              [conversationId]
            );

            logMetaEvent('message_saved', {
              request_id: req.requestId || null,
              connection_id: connection.id,
              type: msgType,
              effectiveType,
              from: normalizedPhone,
              conversationId,
              messageId,
            });
            console.log(`[Meta Webhook] Message saved: ${msgType} (as ${effectiveType}) from ${normalizedPhone} in conversation ${conversationId}`);

            handleAutoReplies(connection, remoteJid, content).catch(err => {
              console.error('[Meta] Auto-reply error:', err.message);
            });

            // === Continue/trigger flows for Meta inbound messages ===
            // Only for text-like content (text, interactive replies, button responses)
            if ((effectiveType === 'text' || msgType === 'text') && content) {
              (async () => {
                try {
                  let flowHandled = false;
                  // 1) Continue active flow session if any
                  const activeSess = await dbQuery(
                    `SELECT id, flow_id, current_node_id FROM flow_sessions
                     WHERE conversation_id = $1 AND is_active = true LIMIT 1`,
                    [conversationId]
                  );
                  if (activeSess.rows.length > 0) {
                    console.log('[Meta][Flow] Continuing active flow session for conversation', conversationId);
                    const r = await continueFlowWithInput(conversationId, content);
                    console.log('[Meta][Flow] continueFlowWithInput result:', JSON.stringify(r));
                    flowHandled = !!r?.success;
                  }

                  // 2) No active session - check keyword-triggered flows
                  if (!flowHandled && connection.organization_id) {
                    const flowsRes = await dbQuery(
                      `SELECT id, name, trigger_keywords FROM flows
                       WHERE organization_id = $1 AND is_active = true
                         AND trigger_keywords IS NOT NULL AND array_length(trigger_keywords, 1) > 0`,
                      [connection.organization_id]
                    );
                    const lc = String(content).trim().toLowerCase();
                    for (const flow of flowsRes.rows) {
                      const kws = (flow.trigger_keywords || []).map(k => String(k).trim().toLowerCase()).filter(Boolean);
                      if (kws.some(k => lc === k || lc.includes(k))) {
                        console.log(`[Meta][Flow] Keyword match -> triggering flow ${flow.id} (${flow.name})`);
                        await executeFlow(flow.id, conversationId, 'start');
                        flowHandled = true;
                        break;
                      }
                    }
                  }

                  if (!flowHandled) {
                    processIncomingWithAgent({
                      connection,
                      conversationId,
                      contactPhone: normalizedPhone,
                      contactName,
                      messageContent: content,
                      messageType: effectiveType,
                      mediaUrl: finalMediaUrl || null,
                      mediaMimetype: mediaMimetype || null,
                      mediaFilename: msgType === 'document' ? message.document?.filename || null : null,
                    }).then(result => {
                      if (result.handled) {
                        console.log('[Meta] AI Agent handled message, agent:', result.agentId, 'type:', effectiveType);
                      }
                    }).catch(err => {
                      console.error('[Meta] AI Agent processing error:', err.message);
                    });
                  }
                } catch (flowErr) {
                  console.error('[Meta][Flow/AI] Error continuing flow or processing AI:', flowErr.message);
                }
              })();
            }
          } catch (msgErr) {
            logMetaEvent('message_error', {
              request_id: req.requestId || null,
              connection_id: connection.id,
              error: msgErr.message,
              from: message?.from,
            });
            console.error('[Meta Webhook] Error processing message:', msgErr.message);
          }
        }

        // Process status updates
        for (const status of (value.statuses || [])) {
          try {
            const wamid = status.id;
            const statusValue = status.status; // sent, delivered, read, failed
            logMetaEvent('status_received', {
              request_id: req.requestId || null,
              connection_id: connection.id,
              message_id: wamid,
              status: statusValue,
              recipient_id: status.recipient_id || null,
            });
            
            if (statusValue === 'read') {
              await dbQuery(
                `UPDATE chat_messages SET status = 'read' WHERE message_id = $1 AND status != 'read'`,
                [wamid]
              );
            } else if (statusValue === 'delivered') {
              await dbQuery(
                `UPDATE chat_messages SET status = 'delivered' WHERE message_id = $1 AND status = 'sent'`,
                [wamid]
              );
            } else if (statusValue === 'sent') {
              await dbQuery(
                `UPDATE chat_messages SET status = 'sent' WHERE message_id = $1 AND status = 'pending'`,
                [wamid]
              );
            } else if (statusValue === 'failed') {
              await dbQuery(
                `UPDATE chat_messages SET status = 'failed' WHERE message_id = $1`,
                [wamid]
              );
            }
          } catch (statusErr) {
            logMetaEvent('status_error', {
              request_id: req.requestId || null,
              connection_id: connection.id,
              error: statusErr.message,
              status: status?.status || null,
              message_id: status?.id || null,
            });
            console.error('[Meta Webhook] Error processing status:', statusErr.message);
          }
        }
      }
    }
  } catch (error) {
    logMetaEvent('delivery_processing_error', {
      request_id: req.requestId || null,
      error: error.message,
      body_preview: toPreview(body),
    });
    console.error('[Meta Webhook] General error:', error.message);
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/asaas', asaasRoutes);
app.use('/api/admin', adminRoutes);
// Mount admin routes also at /api/public for public endpoints (pre-register, branding)
app.use('/api/public', adminRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/evolution', evolutionRoutes);
app.use('/api/wapi', wapiRoutes);
app.use('/api/uazapi', uazapiRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/quick-replies', quickRepliesRoutes);
app.use('/api/chatbots', chatbotsRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/flows', flowsRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/crm/automation', crmAutomationRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/google-calendar', googleCalendarRoutes);
app.use('/api/billing-queue', billingQueueRoutes);
app.use('/api/transcribe-audio', transcribeRoutes);
app.use('/api/ai-agents', aiAgentsRoutes);
app.use('/api/external-forms', externalFormsRoutes);
app.use('/api/lead-distribution', leadDistributionRoutes);
app.use('/api/lead-webhooks', leadWebhooksRoutes);
app.use('/api/lead-scoring', leadScoringRoutes);
app.use('/api/conversation-summary', conversationSummaryRoutes);
app.use('/api/nurturing', nurturingRoutes);
app.use('/api/ctwa', ctwaAnalyticsRoutes);
app.use('/api/group-secretary', groupSecretaryRoutes);
app.use('/api/ghost', ghostRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/dev-workspace', devWorkspaceRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/task-boards', taskBoardsRoutes);
app.use('/api/lead-gleego', leadGleegoRoutes);
app.use('/api/global-agents', globalAgentsRoutes);
app.use('/api/meta', metaTemplatesRoutes);
app.use('/api/meta/lead-ads', metaLeadAdsRoutes);
app.use('/api/meta/webhook', metaWebhookRouter);
app.use('/api/doc-signatures', docSignaturesRoutes);
app.use('/api/telehealth', telehealthRoutes);
app.use('/api/sales-seo', salesSeoRoutes);
app.use('/api/link-preview', linkPreviewRoutes);
app.use('/api/supervisor', supervisorRoutes);
app.use('/api/agent-modes', agentModesRoutes);


app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Diagnostic endpoint to check Google Calendar env vars
app.get('/api/debug/google-config', (req, res) => {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const frontendUrl = process.env.FRONTEND_URL;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  res.json({
    GOOGLE_CLIENT_ID: clientId ? `${clientId.substring(0, 15)}...` : 'NOT SET',
    GOOGLE_REDIRECT_URI: redirectUri || 'NOT SET (will use localhost fallback)',
    FRONTEND_URL: frontendUrl || 'NOT SET (will use localhost fallback)',
  });
});

// Global error handler with CORS headers
app.use((err, req, res, next) => {
  if (req.originalUrl?.startsWith('/api/meta/webhook')) {
    logMetaEvent('delivery_parse_error', {
      request_id: req.requestId || null,
      method: req.method,
      headers: getMetaRequestHeaders(req),
      status_code: err?.status || 500,
      error: err?.message || 'Unknown Meta webhook error',
      body_preview: toPreview(req.body),
    });
  }

  logError('http.unhandled_error', err, {
    status_code: err?.status || 500,
  });
  
  // Ensure CORS headers are set even on errors
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    requestId: req.requestId || null,
  });
});

// Start server FIRST so the health check passes immediately (EasyPanel SIGTERMs slow-starting containers).
// Then run database initialization in the background. Cron jobs only start AFTER init succeeds.
let dbReady = false;
app.get('/ready', (req, res) => {
  res.status(dbReady ? 200 : 503).json({ ready: dbReady });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Whatsale API listening on port ${PORT} (db init running in background)`);
});

initDatabase().then((ok) => {
  if (!ok) {
    console.error('🛑 Database initialization failed (critical step). Server stays up for diagnostics, but features will be broken.');
    return;
  }
  dbReady = true;
  console.log('✅ Database ready — starting schedulers');
  (() => {

    // Agent Modes scheduler (Copilot/AutoReply window + expiration)
    try { startAgentModesScheduler(); } catch (e) { console.error('agent-modes scheduler error', e); }

    // Schedule billing notifications - runs every hour to check rules with matching send_time
    // Each rule has its own send_time, the scheduler only executes rules matching current hour
    cron.schedule('0 * * * *', async () => {
      console.log('⏰ [CRON] Hourly notification check triggered at', new Date().toISOString());
      try {
        await executeNotifications();
      } catch (error) {
        console.error('⏰ [CRON] Error executing notifications:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // Schedule campaign messages - runs every 30 seconds to check for pending messages
    cron.schedule('*/30 * * * * *', async () => {
      try {
        await executeCampaignMessages();
      } catch (error) {
        console.error('📤 [CRON] Error executing campaign messages:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // Schedule message sender - runs every minute to check for due scheduled messages
    cron.schedule('* * * * *', async () => {
      try {
        await executeScheduledMessages();
      } catch (error) {
        console.error('📅 [CRON] Error executing scheduled messages:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // ============================================
    // ASAAS AUTO-SYNC JOBS
    // ============================================

    // 02:00 AM - Sync today's due boletos from Asaas
    // This ensures all boletos that are due TODAY are in the local DB
    // before the notification rules run
    cron.schedule('0 2 * * *', async () => {
      console.log('🌙 [CRON] 2AM Asaas auto-sync triggered at', new Date().toISOString());
      try {
        await syncTodaysDueBoletos();
      } catch (error) {
        console.error('🌙 [CRON] Error in 2AM Asaas sync:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // 08:00 AM - Check payment status updates
    // This verifies if any PENDING/OVERDUE payments have been paid
    // and updates their status (catches missed webhooks)
    cron.schedule('0 8 * * *', async () => {
      console.log('☀️ [CRON] 8AM Asaas status check triggered at', new Date().toISOString());
      try {
        await checkPaymentStatusUpdates();
      } catch (error) {
        console.error('☀️ [CRON] Error in 8AM status check:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // ============================================
    // CRM FUNNEL AUTOMATION
    // ============================================

    // Schedule CRM automations - runs every 2 minutes to process flows and timeouts
    cron.schedule('*/2 * * * *', async () => {
      try {
        await executeCRMAutomations();
      } catch (error) {
        console.error('🤖 [CRON] Error executing CRM automations:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // ============================================
    // EMAIL QUEUE PROCESSOR
    // ============================================

    // Schedule email queue processing - runs every minute
    cron.schedule('* * * * *', async () => {
      try {
        await processEmailQueue();
      } catch (error) {
        console.error('📧 [CRON] Error processing email queue:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // ============================================
    // NURTURING SEQUENCES SCHEDULER
    // ============================================

    // Schedule nurturing sequences - runs every 2 minutes
    cron.schedule('*/2 * * * *', async () => {
      try {
        await executeNurturing();
      } catch (error) {
        console.error('🔄 [CRON] Error executing nurturing sequences:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // Schedule task reminders - runs every minute to check for due reminders
    cron.schedule('* * * * *', async () => {
      try {
        await executeTaskReminders();
      } catch (error) {
        console.error('⏰ [CRON] Error executing task reminders:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // Secretary follow-up - checks every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      try {
        await executeSecretaryFollowups();
      } catch (error) {
        console.error('📌 [CRON] Error executing secretary follow-ups:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // Secretary daily digest - checks every minute (matches digest_hour and digest_minute config)
    cron.schedule('* * * * *', async () => {
      try {
        await executeSecretaryDigest();
      } catch (error) {
        console.error('📊 [CRON] Error executing secretary digest:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    console.log('⏰ Notification scheduler started - checks every hour (timezone: America/Sao_Paulo)');
    console.log('📤 Campaign scheduler started - checks every 30 seconds');
    console.log('📅 Scheduled messages started - checks every minute');
    console.log('🌙 Asaas auto-sync started - runs at 2:00 AM daily');
    console.log('☀️ Asaas status check started - runs at 8:00 AM daily');
    console.log('🤖 CRM automation started - checks every 2 minutes');
    console.log('📧 Email queue processor started - checks every minute');
    console.log('🔄 Nurturing sequences started - checks every 2 minutes');
    console.log('⏰ Task reminders started - checks every minute');
    console.log('📌 Secretary follow-up started - checks every 30 minutes');
    console.log('📊 Secretary daily digest started - checks every hour');

    // AI Agent inactivity timeout - checks every minute
    cron.schedule('* * * * *', async () => {
      try {
        await checkInactivityTimeouts();
      } catch (error) {
        console.error('🤖 AI inactivity check error:', error.message);
      }
    });
    console.log('🤖 AI agent inactivity checker started - checks every minute');

    // Wait reply timeout checker - checks every minute
    cron.schedule('* * * * *', async () => {
      try {
        await executeWaitReplyTimeouts();
      } catch (error) {
        console.error('⏳ [CRON] Error checking wait_reply timeouts:', error);
      }
    });
    console.log('⏳ Wait reply timeout checker started - checks every minute');

    // Supervisor IA Daily Audit - runs at 19:00
    cron.schedule('0 19 * * *', async () => {
      try {
        const { executeDailyAudit } = await import('./supervisor-audit-scheduler.js');
        await executeDailyAudit();
      } catch (error) {
        console.error('🛡️ [CRON] Error executing supervisor daily audit:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });
    console.log('🛡️ Supervisor IA daily audit scheduled - runs at 19:00 daily');
  })();
}).catch((err) => {
  console.error('🛑 Unexpected error during database initialization:', err);
});
