import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as whatsappProvider from '../lib/whatsapp-provider.js';
import { executeFlow, continueFlowWithInput } from '../lib/flow-executor.js';
import { logError, logInfo } from '../logger.js';
import { pauseNurturingOnReply } from './nurturing.js';
import { emitLeadEvent } from '../lib/event-bus.js';
import { analyzeGroupMessage } from '../lib/group-secretary.js';
import { processIncomingWithAgent } from '../lib/ai-agent-processor.js';
import { detectSalesSeoLead, updateSalesSeoEvolution } from '../lib/sales-seo-service.js';
import { handleAutoReplies } from '../lib/auto-reply-service.js';
import { sendPushToOrgUsers } from './push.js';


const router = Router();

// In-memory cache for typing status (cleared after 10 seconds)
const typingStatus = new Map(); // Map<conversationId, { isTyping: boolean, timestamp: number }>

/**
 * Public helper so other modules (e.g. AI agent processor) can flag a conversation
 * as "typing" in the chat UI without going through Evolution webhooks.
 */
export function setLocalTypingStatus(conversationId, isTyping) {
  if (!conversationId) return;
  typingStatus.set(String(conversationId), { isTyping: !!isTyping, timestamp: Date.now() });
}

// Lightweight in-memory diagnostics: last webhook received per instance
const lastWebhookByInstance = new Map(); // Map<instanceName, { at: string, event: string|null, dataKeys: string[] }>

// Lightweight in-memory webhook event buffer for debugging (not persisted)
const WEBHOOK_EVENTS_MAX = 200;
const webhookEvents = []; // Array<{ at: string, instanceName: string|null, event: string|null, normalizedEvent: string|null, headers: any, preview: string }>

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || process.env.API_BASE_URL || '';
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const API_BASE_URL = process.env.API_BASE_URL || '';

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Helper to get a connection with organization-based access control
 * Allows access if user owns the connection OR it belongs to their organization
 */
async function getAccessibleConnection(connectionId, userId) {
  // Get user's organization
  const orgResult = await query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  const userOrgId = orgResult.rows[0]?.organization_id || null;

  // Get connection - allow access if user owns it OR it belongs to their organization
  const connResult = await query(
    `SELECT * FROM connections 
     WHERE id = $1 
     AND (user_id = $2 OR organization_id = $3)`,
    [connectionId, userId, userOrgId]
  );

  return connResult.rows[0] || null;
}

// Download media from Evolution API and save locally
async function downloadAndSaveMedia(connection, messageObj, messageType) {
  try {
    const messageId = messageObj?.key?.id || messageObj?.message?.key?.id;
    if (!messageId) {
      console.log('downloadAndSaveMedia: missing messageId');
      return null;
    }

    console.log('Downloading media for message:', messageId, 'type:', messageType);

    // Send the full message object when available (Evolution usually needs remoteJid + other fields)
    const payload = {
      message: messageObj?.message ? messageObj : { key: messageObj?.key, message: messageObj?.message },
      convertToMp4: messageType === 'video',
    };

    const mediaResponse = await fetch(
      `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${connection.instance_name}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: EVOLUTION_API_KEY,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!mediaResponse.ok) {
      const text = await mediaResponse.text().catch(() => '');
      console.error('Failed to get media from Evolution:', mediaResponse.status, text);
      return null;
    }

    const mediaData = await mediaResponse.json().catch(() => null);
    const rawBase64 =
      mediaData?.base64 ||
      mediaData?.data ||
      mediaData?.base64Data ||
      null;

    if (!rawBase64 || typeof rawBase64 !== 'string') {
      console.log('No base64 data in response');
      return null;
    }

    // Some responses come as data URL: "data:audio/ogg;base64,AAAA..."
    let base64 = rawBase64.trim();
    const dataUrlIdx = base64.indexOf('base64,');
    if (base64.startsWith('data:') && dataUrlIdx !== -1) {
      base64 = base64.slice(dataUrlIdx + 'base64,'.length);
    }
    base64 = base64.replace(/\s/g, '');

    const rawMimetype = (mediaData?.mimetype || mediaData?.mimeType || mediaData?.type || 'application/octet-stream');
    const mimetype = String(rawMimetype).toLowerCase();

    // Determine file extension based on mimetype
    let ext = '.bin';
    if (mimetype.includes('image/jpeg') || mimetype.includes('image/jpg')) ext = '.jpg';
    else if (mimetype.includes('image/png')) ext = '.png';
    else if (mimetype.includes('image/gif')) ext = '.gif';
    else if (mimetype.includes('image/webp')) ext = '.webp';
    else if (mimetype.includes('audio/ogg')) ext = '.ogg';
    else if (mimetype.includes('audio/mpeg') || mimetype.includes('audio/mp3')) ext = '.mp3';
    else if (mimetype.includes('audio/mp4') || mimetype.includes('audio/m4a')) ext = '.m4a';
    else if (mimetype.includes('audio/')) ext = '.ogg';
    else if (mimetype.includes('video/mp4')) ext = '.mp4';
    else if (mimetype.includes('video/webm')) ext = '.webm';
    else if (mimetype.includes('video/')) ext = '.mp4';
    else if (mimetype.includes('application/pdf')) ext = '.pdf';
    else if (mimetype.includes('spreadsheetml') || mimetype.includes('excel') || mimetype.includes('ms-excel')) ext = '.xlsx';
    else if (mimetype.includes('wordprocessingml') || mimetype.includes('msword')) ext = '.docx';
    else if (mimetype.includes('presentationml') || mimetype.includes('powerpoint') || mimetype.includes('ms-powerpoint')) ext = '.pptx';
    else if (mimetype.includes('text/plain')) ext = '.txt';
    else if (mimetype.includes('text/csv') || mimetype.includes('application/csv')) ext = '.csv';
    else if (mimetype.includes('application/zip') || mimetype.includes('x-zip')) ext = '.zip';
    else if (mimetype.includes('application/rar') || mimetype.includes('x-rar')) ext = '.rar';

    // For documents, try to use the original filename from the message if available
    const msgContent = messageObj?.message?.message || messageObj?.message || messageObj;
    const originalFileName = msgContent?.documentMessage?.fileName;
    let filename;
    if (originalFileName && messageType === 'document') {
      // Use original filename with a unique prefix to avoid collisions
      const safeName = String(originalFileName).replace(/[^a-zA-Z0-9._-]/g, '_');
      filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`;
    } else {
      filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    }
    const filePath = path.join(UPLOADS_DIR, filename);

    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buffer);

    console.log('Media saved:', filename, 'size:', buffer.length, 'mimetype:', mimetype);

    return {
      url: `${API_BASE_URL}/uploads/${filename}`,
      mimetype,
    };
  } catch (error) {
    console.error('Error downloading media:', error.message);
    return null;
  }
}

// Helper to make Evolution API requests
async function evolutionRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': EVOLUTION_API_KEY,
    },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${EVOLUTION_API_URL}${endpoint}`, options);
  
  if (!response.ok) {
    const text = await response.text();
    console.error('Evolution API error:', response.status, text, 'endpoint:', endpoint);
    const err = new Error(`Evolution API error: ${response.status} - ${text}`);
    err.status = response.status;
    err.responseBody = text;
    throw err;
  }

  return response.json();
}

// Generate unique instance name
function generateInstanceName(orgId, oddsStr) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `ws_${(orgId || oddsStr || 'default').substring(0, 8)}_${timestamp}${random}`;
}

// Check plan limits for connections
async function checkConnectionLimit(userId, organizationId) {
  if (organizationId) {
    // Check organization's plan limits
    const result = await query(
      `SELECT 
         p.max_connections,
         p.name as plan_name,
         (SELECT COUNT(*) FROM connections WHERE organization_id = o.id) as current_connections
       FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id
       WHERE o.id = $1`,
      [organizationId]
    );

    if (result.rows.length === 0) {
      throw new Error('Organização não encontrada');
    }

    const { max_connections, current_connections, plan_name } = result.rows[0];
    const limit = max_connections || 1;
    
    if (current_connections >= limit) {
      throw new Error(`Limite de conexões atingido (${current_connections}/${limit}). Plano: ${plan_name || 'Sem plano'}. Faça upgrade.`);
    }

    return { allowed: true, current: current_connections, limit };
  } else {
    // Fallback: check user's own connections (for users without organization)
    const result = await query(
      `SELECT COUNT(*) as current_connections FROM connections WHERE user_id = $1`,
      [userId]
    );

    const currentConnections = parseInt(result.rows[0].current_connections) || 0;
    const defaultLimit = 1; // Default limit for users without organization

    if (currentConnections >= defaultLimit) {
      throw new Error(`Limite de conexões atingido (${currentConnections}/${defaultLimit}). Associe-se a uma organização.`);
    }

    return { allowed: true, current: currentConnections, limit: defaultLimit };
  }
}

// Get plan limits for connections
router.get('/limits', authenticate, async (req, res) => {
  try {
    // Get user's organization
    const orgResult = await query(
      `SELECT om.organization_id 
       FROM organization_members om 
       WHERE om.user_id = $1 
       LIMIT 1`,
      [req.userId]
    );

    if (orgResult.rows.length === 0) {
      return res.json({
        max_connections: 1,
        current_connections: 0,
        plan_name: 'Sem organização'
      });
    }

    const organizationId = orgResult.rows[0].organization_id;

    // Get plan limits
    const limitsResult = await query(
      `SELECT 
         p.max_connections,
         p.name as plan_name,
         (SELECT COUNT(*) FROM connections WHERE organization_id = o.id) as current_connections
       FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id
       WHERE o.id = $1`,
      [organizationId]
    );

    if (limitsResult.rows.length === 0) {
      return res.json({
        max_connections: 1,
        current_connections: 0,
        plan_name: 'Organização não encontrada'
      });
    }

    const { max_connections, current_connections, plan_name } = limitsResult.rows[0];

    res.json({
      max_connections: max_connections || 1,
      current_connections: parseInt(current_connections) || 0,
      plan_name: plan_name || 'Sem plano'
    });
  } catch (error) {
    console.error('Get limits error:', error);
    res.status(500).json({ error: 'Erro ao buscar limites' });
  }
});

// Webhook URL base - configured at the top of the file

// Configure webhook for an instance
async function configureInstanceWebhook(instanceName, webhookUrl) {
  try {
    const webhookConfig = {
      enabled: true,
      url: webhookUrl,
      // Compatibility: some Evolution builds expect camelCase, others expect snake_case.
      webhookByEvents: true,
      webhook_by_events: true,
      webhookBase64: false,
      webhook_base64: false,
      events: [
        'APPLICATION_STARTUP',
        'QRCODE_UPDATED',
        'MESSAGES_SET',
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'MESSAGES_DELETE',
        'SEND_MESSAGE',
        'CONTACTS_SET',
        'CONTACTS_UPSERT',
        'CONTACTS_UPDATE',
        'PRESENCE_UPDATE',
        'CHATS_SET',
        'CHATS_UPSERT',
        'CHATS_UPDATE',
        'CHATS_DELETE',
        'GROUPS_UPSERT',
        'GROUPS_UPDATE',
        'GROUP_PARTICIPANTS_UPDATE',
        'CONNECTION_UPDATE',
        'CALL',
        'LABELS_EDIT',
        'LABELS_ASSOCIATION'
      ]
    };

    await evolutionRequest(`/webhook/set/${instanceName}`, 'POST', webhookConfig);
    console.log('Webhook configured for instance:', instanceName);
    return true;
  } catch (error) {
    console.error('Failed to configure webhook for instance:', instanceName, error.message);
    return false;
  }
}

// Configure RabbitMQ for an instance (optional)
async function configureInstanceRabbitMQ(instanceName) {
  try {
    const rabbitConfig = {
      enabled: false // Disable by default, can be enabled later
    };
    await evolutionRequest(`/rabbitmq/set/${instanceName}`, 'POST', rabbitConfig);
    return true;
  } catch (error) {
    console.log('RabbitMQ config skipped:', error.message);
    return false;
  }
}

// Configure instance settings
async function configureInstanceSettings(instanceName) {
  try {
    const settings = {
      reject_call: false,
      msg_call: '',
      groups_ignore: false,
      always_online: false,
      read_messages: false,
      read_status: false,
      sync_full_history: false
    };
    await evolutionRequest(`/settings/set/${instanceName}`, 'POST', settings);
    console.log('Settings configured for instance:', instanceName);
    return true;
  } catch (error) {
    console.log('Settings config skipped:', error.message);
    return false;
  }
}

// Create new Evolution instance
router.post('/create', authenticate, async (req, res) => {
  try {
    const { name, webhookUrl: customWebhookUrl } = req.body;
    let { organization_id } = req.body;

    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return res.status(500).json({ error: 'Evolution API não configurada' });
    }

    // If no organization_id provided, get user's first organization
    if (!organization_id) {
      const orgResult = await query(
        `SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1`,
        [req.userId]
      );
      if (orgResult.rows.length > 0) {
        organization_id = orgResult.rows[0].organization_id;
      }
    }

    // Verify user belongs to organization
    if (organization_id) {
      const memberCheck = await query(
        `SELECT id, role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
        [organization_id, req.userId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Você não pertence a esta organização' });
      }
      // Only owner, admin, manager can create connections
      if (!['owner', 'admin', 'manager'].includes(memberCheck.rows[0].role)) {
        return res.status(403).json({ error: 'Sem permissão para criar conexões' });
      }
    }

    // Check plan limits
    await checkConnectionLimit(req.userId, organization_id);

    // Generate unique instance name
    const instanceName = generateInstanceName(organization_id, req.userId);

    // Determine webhook URL
    const webhookUrl = customWebhookUrl || (WEBHOOK_BASE_URL ? `${WEBHOOK_BASE_URL}/api/evolution/webhook` : null);

    // Create instance on Evolution API with webhook configuration
    const createPayload = {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      reject_call: false,
      groupsIgnore: true,
    };

    console.log('[Evolution] Creating instance with payload:', JSON.stringify(createPayload), 'URL:', EVOLUTION_API_URL);

    // If webhook URL is available, include it in creation
    if (webhookUrl) {
      createPayload.webhook = {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: true,
        webhook_by_events: true,
        webhookBase64: false,
        webhook_base64: false,
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'CONNECTION_UPDATE',
          'QRCODE_UPDATED',
          'SEND_MESSAGE'
        ]
      };
    }

    let createResult;
    try {
      createResult = await evolutionRequest('/instance/create', 'POST', createPayload);
      console.log('Evolution create result:', createResult);
    } catch (createError) {
      console.error('Evolution create error:', createError.message, createError.responseBody);
      // If instance already exists (409 or 400 with "already exists"), try to connect to it
      const bodyLower = (createError.responseBody || '').toLowerCase();
      if (bodyLower.includes('already') || bodyLower.includes('exist') || createError.status === 409) {
        console.log('Instance may already exist, continuing with connect...');
        createResult = { instanceName };
      } else {
        return res.status(createError.status || 500).json({ 
          error: 'Erro ao criar instância na Evolution API',
          details: createError.responseBody || createError.message
        });
      }
    }

    // Save connection to database
    const dbResult = await query(
      `INSERT INTO connections (user_id, organization_id, name, instance_name, api_url, api_key, status, webhook_url)
       VALUES ($1, $2, $3, $4, $5, $6, 'disconnected', $7)
       RETURNING *`,
      [req.userId, organization_id || null, name || 'WhatsApp', instanceName, EVOLUTION_API_URL, EVOLUTION_API_KEY, webhookUrl]
    );

    const connection = dbResult.rows[0];

    // Configure webhook separately (in case it wasn't included in creation)
    let webhookConfigured = false;
    if (webhookUrl) {
      webhookConfigured = await configureInstanceWebhook(instanceName, webhookUrl);
    }

    // Configure instance settings
    await configureInstanceSettings(instanceName);

    // Get QR code
    let qrCode = null;
    try {
      const qrResult = await evolutionRequest(`/instance/connect/${instanceName}`, 'GET');
      qrCode = qrResult.base64 || qrResult.qrcode?.base64 || null;
    } catch (e) {
      console.log('QR code not ready yet');
    }

    res.status(201).json({
      ...connection,
      qrCode,
      webhookConfigured,
      webhookUrl,
    });
  } catch (error) {
    console.error('Create Evolution instance error:', error);
    res.status(400).json({ error: error.message || 'Erro ao criar instância' });
  }
});

// Get QR Code for connection (supports both Evolution API and W-API)
router.get('/:connectionId/qrcode', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const provider = whatsappProvider.detectProvider(connection);
    const startedAt = Date.now();
    logInfo('connection.qrcode_check_started', {
      connection_id: connectionId,
      provider,
    });

    // Use unified provider to get QR code
    const qrCode = await whatsappProvider.getQRCode(connection);

    logInfo('connection.qrcode_check_finished', {
      connection_id: connectionId,
      provider,
      duration_ms: Date.now() - startedAt,
      has_qrcode: Boolean(qrCode),
    });
    
    res.json({
      qrCode: qrCode || null,
      pairingCode: null, // W-API doesn't support pairing code yet
    });
  } catch (error) {
    logError('connection.qrcode_check_failed', error, {
      connection_id: req.params.connectionId,
    });
    res.status(500).json({
      error: 'Erro ao buscar QR Code',
      requestId: req.requestId || null,
    });
  }
});

// Get pairing code for phone-based connection (W-API only)
router.post('/:connectionId/pairing-code', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Número de telefone é obrigatório' });
    }

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const provider = whatsappProvider.detectProvider(connection);
    if (provider !== 'wapi') {
      return res.status(400).json({ error: 'Código de pareamento só é suportado para conexões W-API' });
    }

    // Resolve token: connection-level or global from system_settings
    let token = connection.wapi_token;
    if (!token) {
      const tokenResult = await query(`SELECT value FROM system_settings WHERE key = 'wapi_token' LIMIT 1`);
      token = tokenResult.rows[0]?.value || null;
    }
    if (!token) {
      return res.status(400).json({ error: 'Token W-API não configurado' });
    }

    const wapiProvider = await import('../lib/wapi-provider.js');
    const result = await wapiProvider.getPairingCode(connection.instance_id, token, phoneNumber);

    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Erro ao gerar código de pareamento' });
    }

    res.json({ code: result.code });
  } catch (error) {
    logError('connection.pairing_code_failed', error, { connection_id: req.params.connectionId });
    res.status(500).json({ error: 'Erro ao gerar código de pareamento' });
  }
});

// Check connection status (supports both Evolution API and W-API)
router.get('/:connectionId/status', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const provider = whatsappProvider.detectProvider(connection);
    const startedAt = Date.now();
    logInfo('connection.status_check_started', {
      connection_id: connectionId,
      provider,
    });

    // Use unified provider to check status
    const statusResult = await whatsappProvider.checkStatus(connection);

    const rawStatus = statusResult?.status || 'disconnected';
    const phoneNumber = statusResult?.phoneNumber || null;
    const shouldPreserveConnected =
      connection.status === 'connected' &&
      rawStatus === 'disconnected' &&
      Boolean(statusResult?.transient);

    const effectiveStatus = shouldPreserveConnected ? 'connected' : rawStatus;

    // Update status in database if changed
    if (connection.status !== effectiveStatus || connection.phone_number !== phoneNumber) {
      await query(
        'UPDATE connections SET status = $1, phone_number = $2, updated_at = NOW() WHERE id = $3',
        [effectiveStatus, phoneNumber, connectionId]
      );
    }

    logInfo('connection.status_check_finished', {
      connection_id: connectionId,
      provider,
      duration_ms: Date.now() - startedAt,
      status: effectiveStatus,
      has_phone: Boolean(phoneNumber),
      has_error: Boolean(statusResult?.error),
      transient: Boolean(statusResult?.transient),
    });

    res.json({
      status: effectiveStatus,
      phoneNumber,
      provider,
      error: statusResult?.error || null,
    });
  } catch (error) {
    // Keep endpoint stable for the UI: return disconnected + error (HTTP 200)
    logError('connection.status_check_failed', error, {
      connection_id: req.params.connectionId,
    });
    res.json({
      status: 'disconnected',
      phoneNumber: null,
      provider: null,
      error: 'Erro interno ao verificar o status da instância.',
      requestId: req.requestId || null,
    });
  }
});

// Disconnect/Logout from WhatsApp (supports both Evolution API and W-API)
router.post('/:connectionId/logout', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    // Use unified provider to disconnect
    await whatsappProvider.disconnect(connection);

    // Update status in database
    await query(
      'UPDATE connections SET status = $1, phone_number = NULL, updated_at = NOW() WHERE id = $2',
      ['disconnected', connectionId]
    );

    res.json({ success: true, message: 'Desconectado com sucesso' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Erro ao desconectar' });
  }
});

// Restart instance (reconnect) - supports Evolution API, W-API and UAZAPI
router.post('/:connectionId/restart', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connection = await getAccessibleConnection(connectionId, req.userId);
    if (!connection) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const provider = whatsappProvider.detectProvider(connection);

    // Update status in database
    await query(
      'UPDATE connections SET status = $1, updated_at = NOW() WHERE id = $2',
      ['disconnected', connectionId]
    );

    if (provider === 'wapi' || provider === 'uazapi') {
      // Non-Evolution providers: disconnect first, then fetch a fresh QR code via unified provider
      try {
        await whatsappProvider.disconnect(connection);
      } catch (e) {
        // Ignore disconnect errors - instance may already be disconnected
      }

      const qrCode = await whatsappProvider.getQRCode(connection);

      return res.json({
        success: true,
        qrCode: qrCode || null,
      });
    }

    // Evolution API flow
    try {
      await evolutionRequest(`/instance/restart/${connection.instance_name}`, 'PUT');
    } catch (e) {
      // If restart fails, try to create the instance again
      await evolutionRequest('/instance/create', 'POST', {
        instanceName: connection.instance_name,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      });
    }

    // Get new QR code
    const qrResult = await evolutionRequest(`/instance/connect/${connection.instance_name}`, 'GET');

    res.json({
      success: true,
      qrCode: qrResult.base64 || qrResult.qrcode?.base64 || null,
    });
  } catch (error) {
    console.error('Restart error:', error);
    res.status(500).json({ error: 'Erro ao reiniciar instância' });
  }
});

// Delete instance completely
router.delete('/:connectionId', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    // Get user's organization for org-level access
    const orgResult = await query(
      `SELECT om.organization_id, om.role FROM organization_members om WHERE om.user_id = $1 LIMIT 1`,
      [req.userId]
    );
    const org = orgResult.rows[0] || null;

    // Allow delete if user owns connection OR belongs to same org (admin/owner/manager)
    let connResult;
    if (org && ['owner', 'admin', 'manager'].includes(org.role)) {
      connResult = await query(
        'SELECT * FROM connections WHERE id = $1 AND organization_id = $2',
        [connectionId, org.organization_id]
      );
    } else {
      connResult = await query(
        'SELECT * FROM connections WHERE id = $1 AND user_id = $2',
        [connectionId, req.userId]
      );
    }

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];

    // Delete instance from Evolution
    try {
      await evolutionRequest(`/instance/delete/${connection.instance_name}`, 'DELETE');
    } catch (e) {
      console.log('Instance may not exist on Evolution:', e.message);
    }

    // Delete from database
    await query('DELETE FROM connections WHERE id = $1', [connectionId]);

    res.json({ success: true, message: 'Conexão excluída com sucesso' });
  } catch (error) {
    console.error('Delete instance error:', error);
    res.status(500).json({ error: 'Erro ao excluir conexão' });
  }
});

// Send test message (supports both Evolution API and W-API)
router.post('/:connectionId/test', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { phone, message, mediaUrl, mediaType, fileName } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Número de telefone é obrigatório' });
    }

    const connection = await getAccessibleConnection(connectionId, req.userId);

    if (!connection) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    // Check if connection is active (prefer live status over stale DB value)
    const provider = whatsappProvider.detectProvider(connection);
    let isConnected = connection.status === 'connected' ||
      (provider === 'wapi' && connection.instance_id) ||
      (provider === 'uazapi' && connection.instance_id);

    if (!isConnected) {
      try {
        const liveStatus = await whatsappProvider.checkStatus(connection);
        const rawStatus = liveStatus?.status || 'disconnected';
        const phoneNumber = liveStatus?.phoneNumber || null;
        const resolvedStatus =
          connection.status === 'connected' && rawStatus === 'disconnected' && liveStatus?.transient
            ? 'connected'
            : rawStatus;

        if (connection.status !== resolvedStatus || connection.phone_number !== phoneNumber) {
          await query(
            'UPDATE connections SET status = $1, phone_number = $2, updated_at = NOW() WHERE id = $3',
            [resolvedStatus, phoneNumber, connectionId]
          );
        }

        isConnected = resolvedStatus === 'connected' ||
          (provider === 'wapi' && connection.instance_id) ||
          (provider === 'uazapi' && connection.instance_id);
      } catch (statusError) {
        console.warn('[Test Message] Live status check failed:', statusError?.message || statusError);
      }
    }

    if (!isConnected) {
      return res.status(400).json({ error: 'Conexão não está ativa. Conecte primeiro.' });
    }

    console.log(`[Test Message] Provider: ${provider}, Connection: ${connectionId}, Phone: ${phone}`);

    // Format phone number (remove non-digits)
    const formattedPhone = phone.replace(/\D/g, '');

    let result;

    // Use unified whatsappProvider for all message types
    if (mediaUrl) {
      // Determine message type based on mediaType
      const msgType = mediaType || 'document';
      result = await whatsappProvider.sendMessage(connection, formattedPhone, message || fileName || '', msgType, mediaUrl);
    } else if (message) {
      // Send text message using unified provider
      result = await whatsappProvider.sendMessage(connection, formattedPhone, message, 'text', null);
    } else {
      return res.status(400).json({ error: 'Mensagem ou mídia é obrigatório' });
    }

    console.log(`[Test Message] Result:`, result);

    if (result.success === false) {
      return res.status(400).json({ 
        error: result.error || 'Falha ao enviar mensagem',
        details: result
      });
    }

    res.json({ success: true, result, provider });
  } catch (error) {
    console.error('Send test message error:', error);
    res.status(500).json({ error: error.message || 'Erro ao enviar mensagem de teste' });
  }
});

// Get instance info
router.get('/:connectionId/info', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    // Get connection
    const connResult = await query(
      'SELECT * FROM connections WHERE id = $1 AND user_id = $2',
      [connectionId, req.userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];

    // Get instance info from Evolution
    const infoResult = await evolutionRequest(`/instance/fetchInstances?instanceName=${connection.instance_name}`, 'GET');

    res.json({
      connection,
      instanceInfo: infoResult[0] || null,
    });
  } catch (error) {
    console.error('Get instance info error:', error);
    res.status(500).json({ error: 'Erro ao buscar informações' });
  }
});

// ==========================================
// WEBHOOK - Receive messages from Evolution API
// ==========================================

// Evolution API Webhook - receives real-time messages
// This endpoint should be public (no authentication)
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(payload, null, 2));

    // Evolution API can send events in different formats
    // Format 1: { event: "messages.upsert", instance: "name", data: {...} }
    // Format 2: { instance: "name", data: {...}, event: "messages.upsert" }
    // Format 3: { apikey: "...", event: "MESSAGES_UPSERT", instance: "name", data: {...} }
    
    const event = payload.event?.toLowerCase?.() || payload.event;
    const instanceName = payload.instance || payload.instanceName;
    const data = payload.data || payload;

    const normalizedEvent = typeof event === 'string'
      ? event.replace(/_/g, '.').toLowerCase()
      : null;

    console.log('Parsed - Event:', event, 'Instance:', instanceName);
    console.log('Webhook: Normalized event:', normalizedEvent);

    // Track last webhook received + keep small buffer for UI debugging
    try {
      const safeData = payload?.data && typeof payload.data === 'object' ? payload.data : null;
      const dataKeys = safeData ? Object.keys(safeData).slice(0, 15) : [];
      lastWebhookByInstance.set(instanceName || 'unknown', {
        at: new Date().toISOString(),
        event: normalizedEvent || (typeof event === 'string' ? event : null),
        dataKeys,
      });

      const safeHeaders = {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-real-ip': req.headers['x-real-ip'],
      };

      let safePayload = payload;
      if (safePayload && typeof safePayload === 'object') {
        safePayload = { ...safePayload };
        delete safePayload.apikey;
      }

      let preview = '';
      try {
        preview = JSON.stringify(safePayload);
      } catch {
        preview = '';
      }
      if (preview.length > 4000) preview = `${preview.slice(0, 4000)}…`;

      webhookEvents.push({
        at: new Date().toISOString(),
        instanceName: instanceName || null,
        event: typeof event === 'string' ? event : null,
        normalizedEvent,
        headers: safeHeaders,
        preview,
      });
      if (webhookEvents.length > WEBHOOK_EVENTS_MAX) {
        webhookEvents.splice(0, webhookEvents.length - WEBHOOK_EVENTS_MAX);
      }
    } catch {
      // ignore diagnostics errors
    }

    if (!instanceName) {
      console.log('Webhook: Missing instance name');
      return res.status(200).json({ received: true });
    }

    // Find the connection by instance name
    const connResult = await query(
      'SELECT * FROM connections WHERE instance_name = $1',
      [instanceName]
    );

    if (connResult.rows.length === 0) {
      console.log('Webhook: Connection not found for instance:', instanceName);
      return res.status(200).json({ received: true });
    }

    const connection = connResult.rows[0];
    console.log('Webhook: Found connection:', connection.id, connection.name);


    // Handle different event types
    switch (normalizedEvent) {
      case 'messages.upsert':
      case 'send.message':
        await handleMessageUpsert(connection, data);
        break;
      
      case 'messages.update':
        await handleMessageUpdate(connection, data);
        break;
      
      case 'connection.update':
        await handleConnectionUpdate(connection, data);
        break;
      
      case 'presence.update':
        await handlePresenceUpdate(connection, data);
        break;
      
      case 'qrcode.updated':
        console.log('QR Code updated for instance:', instanceName);
        break;
      
      default:
        console.log('Webhook: Event type:', normalizedEvent, '- not handled');
    }

    res.status(200).json({ received: true, event: normalizedEvent });
  } catch (error) {
    console.error('Webhook error:', error);
    // Always return 200 to acknowledge receipt
    res.status(200).json({ received: true, error: error.message });
  }
});

// Test webhook endpoint (GET for easy testing)
router.get('/webhook', async (req, res) => {
  console.log('Webhook test GET received');
  res.json({ status: 'ok', message: 'Webhook endpoint is working', timestamp: new Date().toISOString() });
});

// Diagnose webhook configuration for a connection
router.get('/:connectionId/webhook-diagnostic', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    // Get connection
    const connResult = await query(
      'SELECT * FROM connections WHERE id = $1 AND user_id = $2',
      [connectionId, req.userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];
    const diagnostics = {
      connection: {
        id: connection.id,
        name: connection.name,
        instanceName: connection.instance_name,
        status: connection.status,
        webhookUrl: connection.webhook_url,
      },
      evolutionApi: {
        configured: !!EVOLUTION_API_URL && !!EVOLUTION_API_KEY,
        url: EVOLUTION_API_URL || 'NOT SET',
      },
      webhookBase: {
        configured: !!WEBHOOK_BASE_URL,
        url: WEBHOOK_BASE_URL || 'NOT SET',
        expectedEndpoint: WEBHOOK_BASE_URL ? `${WEBHOOK_BASE_URL}/api/evolution/webhook` : 'NOT SET',
      },
      // Shows if THIS backend is actually receiving events from Evolution
      lastWebhookReceived: lastWebhookByInstance.get(connection.instance_name) || null,
      evolutionWebhook: null,
      instanceStatus: null,
      errors: [],
    };

    // Check Evolution API instance status
    try {
      const statusResult = await evolutionRequest(`/instance/connectionState/${connection.instance_name}`, 'GET');
      diagnostics.instanceStatus = {
        state: statusResult.instance?.state || 'unknown',
        phoneNumber: statusResult.instance?.phoneNumber || null,
      };
    } catch (e) {
      diagnostics.errors.push(`Instance status check failed: ${e.message}`);
    }

    // Get webhook configuration from Evolution API
    try {
      const webhookResult = await evolutionRequest(`/webhook/find/${connection.instance_name}`, 'GET');
      const rawWebhook = webhookResult?.webhook?.webhook || webhookResult?.webhook || webhookResult;
      diagnostics.evolutionWebhook = {
        url: rawWebhook?.url || webhookResult?.url || null,
        enabled: rawWebhook?.enabled !== false,
        events: rawWebhook?.events || webhookResult?.events || [],
        webhookBase64:
          rawWebhook?.webhookBase64 ??
          rawWebhook?.webhook_base64 ??
          webhookResult?.webhookBase64 ??
          webhookResult?.webhook_base64 ??
          null,
      };

      // Check if URL matches expected - use the actual configured URL or construct from base
      const baseExpectedUrl = WEBHOOK_BASE_URL ? `${WEBHOOK_BASE_URL}/api/evolution/webhook` : null;
      // The connection.webhook_url already contains the full URL, so use it directly for comparison
      const expectedUrl = baseExpectedUrl;
      if (expectedUrl && diagnostics.evolutionWebhook.url !== expectedUrl) {
        diagnostics.errors.push(`Webhook URL mismatch! Evolution has: "${diagnostics.evolutionWebhook.url}", expected: "${expectedUrl}"`);
      }
      
      // Check if MESSAGES_UPSERT event is enabled
      const events = diagnostics.evolutionWebhook.events || [];
      const hasMessageEvent = events.some(e => 
        e.toLowerCase().includes('messages_upsert') || 
        e.toLowerCase().includes('messages.upsert')
      );
      if (!hasMessageEvent && events.length > 0) {
        diagnostics.errors.push('MESSAGES_UPSERT event not found in webhook events');
      }
    } catch (e) {
      diagnostics.errors.push(`Webhook config check failed: ${e.message}`);
    }

    // Test if webhook endpoint is reachable
    if (WEBHOOK_BASE_URL) {
      try {
        const testUrl = `${WEBHOOK_BASE_URL}/api/evolution/webhook`;
        const testResponse = await fetch(testUrl, { 
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000)
        });
        diagnostics.webhookReachability = {
          url: testUrl,
          reachable: testResponse.ok,
          status: testResponse.status,
        };
      } catch (e) {
        diagnostics.webhookReachability = {
          url: `${WEBHOOK_BASE_URL}/api/evolution/webhook`,
          reachable: false,
          error: e.message,
        };
        diagnostics.errors.push(`Webhook endpoint not reachable: ${e.message}`);
      }
    }

    // Summary
    diagnostics.healthy = diagnostics.errors.length === 0 && 
                          diagnostics.instanceStatus?.state === 'open' &&
                          diagnostics.evolutionWebhook?.url;

    res.json(diagnostics);
  } catch (error) {
    console.error('Webhook diagnostic error:', error);
    res.status(500).json({ error: 'Erro ao diagnosticar webhook', details: error.message });
  }
});

// View what the backend has received on the webhook (in-memory, debug only)
router.get('/:connectionId/webhook-events', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    const allowedIds = await getUserConnectionIds(req.userId);
    if (!allowedIds.includes(connectionId)) {
      return res.status(403).json({ error: 'Sem permissão para acessar esta conexão' });
    }

    const connResult = await query('SELECT id, instance_name, name FROM connections WHERE id = $1', [connectionId]);
    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];
    const events = webhookEvents
      .filter(e => e.instanceName === connection.instance_name)
      .slice(-limit)
      .reverse();

    res.json({
      connection: { id: connection.id, name: connection.name, instanceName: connection.instance_name },
      events,
    });
  } catch (error) {
    console.error('Webhook events error:', error);
    res.status(500).json({ error: 'Erro ao buscar eventos do webhook' });
  }
});

router.delete('/:connectionId/webhook-events', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const allowedIds = await getUserConnectionIds(req.userId);
    if (!allowedIds.includes(connectionId)) {
      return res.status(403).json({ error: 'Sem permissão para acessar esta conexão' });
    }

    const connResult = await query('SELECT id, instance_name FROM connections WHERE id = $1', [connectionId]);
    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const instanceName = connResult.rows[0].instance_name;
    for (let i = webhookEvents.length - 1; i >= 0; i--) {
      if (webhookEvents[i]?.instanceName === instanceName) webhookEvents.splice(i, 1);
    }
    lastWebhookByInstance.delete(instanceName);

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook events clear error:', error);
    res.status(500).json({ error: 'Erro ao limpar eventos do webhook' });
  }
});

// Reconfigure webhook for a connection
router.post('/:connectionId/reconfigure-webhook', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { webhookUrl: customWebhookUrl } = req.body;

    // Get connection
    const connResult = await query(
      'SELECT * FROM connections WHERE id = $1 AND user_id = $2',
      [connectionId, req.userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];
    const webhookUrl = customWebhookUrl || connection.webhook_url || (WEBHOOK_BASE_URL ? `${WEBHOOK_BASE_URL}/api/evolution/webhook` : null);

    if (!webhookUrl) {
      return res.status(400).json({ error: 'Nenhuma URL de webhook configurada' });
    }

    // Configure webhook on Evolution API
    const success = await configureInstanceWebhook(connection.instance_name, webhookUrl);

    if (success) {
      // Update database
      await query(
        'UPDATE connections SET webhook_url = $1, updated_at = NOW() WHERE id = $2',
        [webhookUrl, connectionId]
      );

      res.json({ 
        success: true, 
        message: 'Webhook reconfigurado com sucesso',
        webhookUrl 
      });
    } else {
      res.status(500).json({ error: 'Falha ao reconfigurar webhook na Evolution API' });
    }
  } catch (error) {
    console.error('Reconfigure webhook error:', error);
    res.status(500).json({ error: 'Erro ao reconfigurar webhook', details: error.message });
  }
});

// Normalize remoteJid to avoid duplicates (handles @lid, @s.whatsapp.net, @c.us)
// IMPORTANT: group JIDs (@g.us) and broadcast must be preserved as-is.
function normalizeRemoteJid(remoteJid) {
  if (!remoteJid) return null;

  // Keep group/broadcast identifiers untouched
  if (remoteJid === 'status@broadcast' || String(remoteJid).includes('@g.us')) {
    return remoteJid;
  }

  // Extract the phone number part
  const phone = String(remoteJid)
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace('@lid', '')
    .replace(/[^0-9]/g, ''); // Remove any non-numeric characters

  // Return normalized JID with standard suffix
  return phone ? `${phone}@s.whatsapp.net` : remoteJid;
}

// Extract phone from any JID format
function extractPhoneFromJid(remoteJid) {
  if (!remoteJid) return '';

  // For groups/broadcast we don't treat it as a phone
  if (remoteJid === 'status@broadcast' || String(remoteJid).includes('@g.us')) {
    return '';
  }

  return String(remoteJid)
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace('@lid', '')
    .replace(/[^0-9]/g, '');
}

function isLocalUploadsUrl(url) {
  return typeof url === 'string' && url.includes('/uploads/');
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
        
        // Execute the flow (fire-and-forget, don't block webhook)
        executeFlow(flow.id, conversationId, 'start').then(result => {
          if (result.success) {
            console.log('[Flow Trigger] Flow executed successfully:', flow.name, 'Nodes processed:', result.nodesProcessed);
          } else {
            console.error('[Flow Trigger] Flow execution failed:', result.error);
          }
        }).catch(err => {
          console.error('[Flow Trigger] Flow execution error:', err);
        });
        
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

// Handle incoming/outgoing messages
async function handleMessageUpsert(connection, data) {
  try {
    // Evolution sometimes wraps messages in arrays/containers depending on version/config.
    const candidates =
      Array.isArray(data) ? data :
      Array.isArray(data?.messages) ? data.messages :
      Array.isArray(data?.data?.messages) ? data.data.messages :
      Array.isArray(data?.data) ? data.data :
      null;

    if (candidates) {
      for (const item of candidates) {
        await handleMessageUpsert(connection, item);
      }
      return;
    }

    const message = data?.message || data;
    const key = data?.key || message?.key;

    if (!key) {
      console.log('Webhook: No message key found', {
        topLevelKeys: Object.keys(data || {}).slice(0, 15),
      });
      return;
    }

    // Evolution v2 sends remoteJidAlt with the real phone JID when remoteJid is @lid
    const remoteJidAlt = key.remoteJidAlt || data?.remoteJidAlt || null;
    const rawRemoteJid = (String(key.remoteJid || '').includes('@lid') && remoteJidAlt)
      ? remoteJidAlt
      : key.remoteJid;
    const messageId = key.id;
    const fromMe = key.fromMe || false;
    const pushName = message.pushName || data.pushName;

    // Skip status messages (broadcast)
    if (rawRemoteJid === 'status@broadcast') {
      console.log('Webhook: Skipping broadcast message');
      return;
    }

    const isGroup = typeof rawRemoteJid === 'string' && rawRemoteJid.includes('@g.us');

    // Check if connection allows group messages
    if (isGroup && !connection.show_groups) {
      console.log('Webhook: Skipping group message (show_groups disabled):', rawRemoteJid);
      return;
    }

    // For group messages, extract participant info
    const groupParticipant = isGroup ? (key.participant || data.participant || message.participant) : null;
    const groupParticipantPhone = groupParticipant ? String(groupParticipant).replace(/@.*$/, '').replace(/\D/g, '') : null;

    // === EARLY CHECK: Skip messages that have no real content BEFORE creating conversation ===
    const msgContent = message.message || message;
    
    // Check for message types we should ignore
    if (msgContent.reactionMessage) {
      console.log('Webhook: Ignoring reaction message (early check)');
      return;
    }
    if (msgContent.senderKeyDistributionMessage) {
      console.log('Webhook: Ignoring senderKeyDistribution message (early check)');
      return;
    }
    // Handle edited/deleted messages via protocolMessage
    if (msgContent.protocolMessage) {
      const proto = msgContent.protocolMessage;
      const editedMsg = proto.editedMessage;
      const protoType = proto.type;
      
      console.log('Webhook: protocolMessage detected. type:', protoType, 'hasEditedMsg:', !!editedMsg, 'proto.key:', JSON.stringify(proto.key));
      
      // Handle message edit FIRST (check editedMsg before type/revoke)
      if (editedMsg) {
        const editedMessageId = proto.key?.id;
        const newContent = editedMsg.message?.conversation || 
                          editedMsg.message?.extendedTextMessage?.text || 
                          editedMsg.conversation || 
                          editedMsg.extendedTextMessage?.text || '';
        if (newContent && editedMessageId) {
          console.log('Webhook: Message edited:', editedMessageId, 'New content:', newContent.substring(0, 50));
          const editResult = await query(
            `UPDATE chat_messages SET content = $1, is_edited = true WHERE message_id = $2 RETURNING id`,
            [newContent, editedMessageId]
          );
          console.log('Webhook: Edit update matched', editResult.rowCount, 'rows for message_id:', editedMessageId);
          if (editResult.rowCount === 0) {
            // Try broader match: search by conversation
            const broadResult = await query(
              `UPDATE chat_messages SET content = $1, is_edited = true 
               WHERE message_id = $2 
               OR message_id LIKE $3
               RETURNING id`,
              [newContent, editedMessageId, `%${editedMessageId}%`]
            );
            console.log('Webhook: Broad edit match:', broadResult.rowCount, 'rows');
          }
        } else {
          console.log('Webhook: Edit detected but no content or messageId. editedMessageId:', proto.key?.id);
        }
      }
      // Handle message deletion (REVOKE)
      else if (protoType === 0 || protoType === 'REVOKE' || proto.key?.id) {
        const deletedMessageId = proto.key?.id;
        if (deletedMessageId) {
          console.log('Webhook: Message deleted by sender:', deletedMessageId);
          const delResult = await query(
            `UPDATE chat_messages SET is_deleted = true WHERE message_id = $1 RETURNING id`,
            [deletedMessageId]
          );
          console.log('Webhook: Delete update matched', delResult.rowCount, 'rows for message_id:', deletedMessageId);
          if (delResult.rowCount === 0) {
            const broadResult = await query(
              `UPDATE chat_messages SET is_deleted = true 
               WHERE message_id = $1 OR message_id LIKE $2
               RETURNING id`,
              [deletedMessageId, `%${deletedMessageId}%`]
            );
            console.log('Webhook: Broad delete match:', broadResult.rowCount, 'rows');
          }
        } else {
          console.log('Webhook: Ignoring protocol message (no key id)');
        }
      } else {
        console.log('Webhook: Ignoring protocol message (early check). type:', protoType);
      }
      return;
    }
    if (msgContent.messageContextInfo && Object.keys(msgContent).length <= 2) {
      console.log('Webhook: Ignoring message with only context info (early check)');
      return;
    }
    
    // Check if there's any meaningful content
    const hasTextContent = msgContent.conversation || msgContent.extendedTextMessage || 
                           message.body || message.text;
    const hasMediaContent = msgContent.imageMessage || msgContent.videoMessage || 
                            msgContent.audioMessage || msgContent.documentMessage || 
                            msgContent.stickerMessage;
    const hasOtherContent = msgContent.contactMessage || msgContent.locationMessage;
    
    if (!hasTextContent && !hasMediaContent && !hasOtherContent) {
      // Check for any unknown but potentially valid content
      const knownMetaKeys = ['messageContextInfo', 'senderKeyDistributionMessage', 'protocolMessage', 'reactionMessage'];
      const contentKeys = Object.keys(msgContent).filter(k => !knownMetaKeys.includes(k));
      
      if (contentKeys.length === 0) {
        console.log('Webhook: Ignoring message with no extractable content (early check)');
        return;
      }
      console.log('Webhook: Unknown message type detected, keys:', contentKeys);
    }
    // === END EARLY CHECK ===

    // Skip @lid messages if we can use normal format
    const isLidFormat = rawRemoteJid.includes('@lid');
    
    // Normalize the remoteJid to prevent duplicates
    const remoteJid = normalizeRemoteJid(rawRemoteJid);
    const contactPhone = extractPhoneFromJid(rawRemoteJid);

    // If this is a @lid message, check if we already have a normal conversation for this contact
    if (isLidFormat && contactPhone) {
      const existingNormal = await query(
        `SELECT id FROM conversations 
         WHERE connection_id = $1 
         AND contact_phone = $2
         AND remote_jid LIKE '%@s.whatsapp.net'
         LIMIT 1`,
        [connection.id, contactPhone]
      );
      
      if (existingNormal.rows.length > 0) {
        // Use the existing normal conversation instead of creating @lid
        console.log('Webhook: Using existing normal conversation instead of @lid:', existingNormal.rows[0].id);
      }
    }

    console.log('Webhook: Processing message from', rawRemoteJid, '-> normalized:', remoteJid);

    // Find existing conversation by phone number (more flexible) - prioritize @s.whatsapp.net
    // For groups, search by the group JID directly
    let convResult;
    if (isGroup) {
      convResult = await query(
        `SELECT * FROM conversations 
         WHERE connection_id = $1 AND remote_jid = $2
         LIMIT 1`,
        [connection.id, remoteJid]
      );
    } else {
      convResult = await query(
        `SELECT * FROM conversations 
         WHERE connection_id = $1 
         AND (remote_jid = $2 OR contact_phone = $3)
         ORDER BY 
           CASE WHEN remote_jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END,
           last_message_at DESC
         LIMIT 1`,
        [connection.id, remoteJid, contactPhone]
      );
    }

    let conversationId;

    if (convResult.rows.length === 0) {
      // Create new conversation
      // For groups, use group subject as name; for individuals, use pushName
      const groupSubject = isGroup
        ? (
            data.groupMetadata?.subject ||
            data.groupMetadata?.name ||
            data.groupSubject ||
            data.subject ||
            message.groupMetadata?.subject ||
            message.groupMetadata?.name ||
            message.groupSubject ||
            message.subject ||
            'Grupo'
          )
        : null;
      const displayName = isGroup ? groupSubject : (pushName || contactPhone);
      
      const newConv = await query(
        `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone, is_group, group_name, last_message_at, unread_count)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
         RETURNING id`,
        [connection.id, remoteJid, displayName, isGroup ? null : contactPhone, isGroup, groupSubject, fromMe ? 0 : 1]
      );
      conversationId = newConv.rows[0].id;

      // SALES SEO detection will happen after message insert to cover both new and existing conversations
      console.log('Webhook: Created new', isGroup ? 'group' : 'conversation:', conversationId);
    } else {
      conversationId = convResult.rows[0].id;
      
      // Update remote_jid if it was different (migrate old format)
      if (convResult.rows[0].remote_jid !== remoteJid) {
        await query(
          `UPDATE conversations SET remote_jid = $1 WHERE id = $2`,
          [remoteJid, conversationId]
        );
        console.log('Webhook: Updated conversation remote_jid to normalized format');
      }
      
      // Update conversation
      if (isGroup) {
        // For groups, update group_name if available
        const groupSubject =
          data.groupMetadata?.subject ||
          data.groupMetadata?.name ||
          data.groupSubject ||
          data.subject ||
          message.groupMetadata?.subject ||
          message.groupMetadata?.name ||
          message.groupSubject ||
          message.subject ||
          null;
        if (!fromMe) {
          await query(
            `UPDATE conversations 
             SET last_message_at = NOW(), 
                 unread_count = unread_count + 1,
                 group_name = COALESCE($2, group_name),
                 is_group = true,
                 updated_at = NOW()
             WHERE id = $1`,
            [conversationId, groupSubject]
          );
        } else {
          await query(
            `UPDATE conversations 
             SET last_message_at = NOW(), 
                 group_name = COALESCE($2, group_name),
                 is_group = true,
                 updated_at = NOW() 
             WHERE id = $1`,
            [conversationId, groupSubject]
          );
        }
      } else {
        // For individual chats
        if (!fromMe) {
          await query(
            `UPDATE conversations 
             SET last_message_at = NOW(), 
                 unread_count = unread_count + 1,
                 contact_name = COALESCE(NULLIF($2, ''), contact_name),
                 connection_id = COALESCE($3, connection_id),
                 updated_at = NOW()
             WHERE id = $1`,
            [conversationId, pushName, connection.id]
          );
        } else {
          await query(
            `UPDATE conversations SET connection_id = $2, last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [conversationId, connection.id]
          );
        }
      }
    }

    const mediaTypes = ['image', 'audio', 'video', 'document', 'sticker'];

    // Check if message already exists by its Evolution message_id
    const existingMsg = await query(
      `SELECT id, media_url, message_type, media_mimetype, status FROM chat_messages WHERE message_id = $1`,
      [messageId]
    );

    let existingRow = existingMsg.rows[0] || null;

    // For fromMe messages: also check if there's a pending optimistic message waiting for this confirmation
    // Match by conversation, from_me, same type, and recent timestamp (within 60 seconds)
    if (!existingRow && fromMe) {
      // For outgoing messages from our system: look for a pending optimistic message
      // that was saved before Evolution confirmed. Match by conversation + content/type + recent time.
      const pendingMsg = await query(
        `SELECT id, media_url, message_type, media_mimetype, status, message_id, content
         FROM chat_messages 
         WHERE conversation_id = $1 
           AND from_me = true 
           AND status = 'pending'
           AND message_id LIKE 'temp_%'
           AND timestamp > NOW() - INTERVAL '60 seconds'
         ORDER BY timestamp DESC
         LIMIT 1`,
        [conversationId]
      );

      if (pendingMsg.rows.length > 0) {
        // Update the pending message with the real Evolution message_id and mark as sent
        await query(
          `UPDATE chat_messages SET message_id = $1, status = 'sent' WHERE id = $2`,
          [messageId, pendingMsg.rows[0].id]
        );
        console.log('Webhook: Linked pending optimistic message to Evolution ID:', messageId);

        // Mark as existing so we don't insert a duplicate
        existingRow = { ...pendingMsg.rows[0], message_id: messageId, status: 'sent' };
      }
    }

    // For incoming messages (fromMe=false), check if we somehow already have this exact message_id
    // This should only happen if webhook is called twice
    if (!existingRow && !fromMe) {
      // Already checked at line ~991, so nothing to do here - proceed to insert
    }

    if (existingRow) {
      const existingIsMedia = mediaTypes.includes(existingRow.message_type);
      const existingHasLocalMedia = existingIsMedia && isLocalUploadsUrl(existingRow.media_url);

      if (!existingIsMedia || existingHasLocalMedia) {
        console.log('Webhook: Message already exists:', messageId);
        return;
      }

      console.log('Webhook: Message exists but media is not local; will attempt to download:', messageId);
    }



    // Extract message content and type
    let content = '';
    let messageType = 'text';
    let mediaUrl = null;
    let mediaMimetype = null;
    let quotedMessageId = null;
    let linkPreview = null;

    // msgContent already declared above (line 870)

    if (msgContent.conversation) {
      content = msgContent.conversation;
      messageType = 'text';
    } else if (msgContent.buttonsResponseMessage) {
      content = msgContent.buttonsResponseMessage.selectedDisplayText || msgContent.buttonsResponseMessage.selectedId || '';
      messageType = 'text';
    } else if (msgContent.templateButtonReplyMessage) {
      content = msgContent.templateButtonReplyMessage.selectedDisplayText || msgContent.templateButtonReplyMessage.selectedId || '';
      messageType = 'text';
    } else if (msgContent.listResponseMessage) {
      content = msgContent.listResponseMessage.title || msgContent.listResponseMessage.singleSelectReply?.selectedRowId || '';
      messageType = 'text';
    } else if (msgContent.interactiveResponseMessage) {
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
      messageType = 'text';
    } else if (msgContent.interactiveMessage || msgContent.interactive) {
      const interactive = msgContent.interactiveMessage || msgContent.interactive;
      if (interactive.button_reply) {
        content = interactive.button_reply.title || interactive.button_reply.id;
      } else if (interactive.list_reply) {
        content = interactive.list_reply.title || interactive.list_reply.id;
      } else {
        content = interactive.body?.text || '[Mensagem interativa]';
      }
      messageType = 'text';
    } else if (msgContent.extendedTextMessage) {
      const ext = msgContent.extendedTextMessage;
      content = ext.text;
      messageType = 'text';
      if (ext.contextInfo?.quotedMessage) {
        quotedMessageId = ext.contextInfo.stanzaId;
      }
      // Extract link preview metadata
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
      }
    } else if (msgContent.imageMessage) {
      messageType = 'image';
      content = msgContent.imageMessage.caption || '';
      mediaUrl = msgContent.imageMessage.url || data.media?.url;
      mediaMimetype = msgContent.imageMessage.mimetype;
    } else if (msgContent.videoMessage) {
      messageType = 'video';
      content = msgContent.videoMessage.caption || '';
      mediaUrl = msgContent.videoMessage.url || data.media?.url;
      mediaMimetype = msgContent.videoMessage.mimetype;
    } else if (msgContent.audioMessage) {
      messageType = 'audio';
      mediaUrl = msgContent.audioMessage.url || data.media?.url;
      mediaMimetype = msgContent.audioMessage.mimetype;
    } else if (msgContent.documentMessage) {
      messageType = 'document';
      content = msgContent.documentMessage.fileName || '';
      mediaUrl = msgContent.documentMessage.url || data.media?.url;
      mediaMimetype = msgContent.documentMessage.mimetype;
    } else if (msgContent.stickerMessage) {
      messageType = 'sticker';
      mediaUrl = msgContent.stickerMessage.url || data.media?.url;
      mediaMimetype = msgContent.stickerMessage.mimetype;
    } else if (msgContent.contactMessage) {
      messageType = 'contact';
      content = msgContent.contactMessage.displayName || 'Contato';
    } else if (msgContent.locationMessage) {
      messageType = 'location';
      content = `${msgContent.locationMessage.degreesLatitude},${msgContent.locationMessage.degreesLongitude}`;
    } else if (msgContent.reactionMessage) {
      // Reactions are not displayed as messages
      console.log('Webhook: Ignoring reaction message');
      return;
    } else if (msgContent.senderKeyDistributionMessage) {
      console.log('Webhook: Ignoring senderKeyDistribution message');
      return;
    } else if (msgContent.protocolMessage) {
      const proto = msgContent.protocolMessage;
      const editedMsg = proto.editedMessage;
      const protoType = proto.type;
      
      console.log('Webhook (late): protocolMessage. type:', protoType, 'hasEditedMsg:', !!editedMsg, 'proto.key:', JSON.stringify(proto.key));
      
      // Handle edit FIRST
      if (editedMsg) {
        const editedMessageId = proto.key?.id;
        const newContent = editedMsg.message?.conversation || 
                          editedMsg.message?.extendedTextMessage?.text || 
                          editedMsg.conversation || 
                          editedMsg.extendedTextMessage?.text || '';
        if (newContent && editedMessageId) {
          console.log('Webhook (late): Message edited:', editedMessageId);
          const editResult = await query(
            `UPDATE chat_messages SET content = $1, is_edited = true WHERE message_id = $2 RETURNING id`,
            [newContent, editedMessageId]
          );
          console.log('Webhook (late): Edit matched', editResult.rowCount, 'rows');
        }
      }
      // Handle deletion
      else if (protoType === 0 || protoType === 'REVOKE' || proto.key?.id) {
        const deletedMessageId = proto.key?.id;
        if (deletedMessageId) {
          console.log('Webhook (late): Message deleted:', deletedMessageId);
          const delResult = await query(
            `UPDATE chat_messages SET is_deleted = true WHERE message_id = $1 RETURNING id`,
            [deletedMessageId]
          );
          console.log('Webhook (late): Delete matched', delResult.rowCount, 'rows');
        }
      } else {
        console.log('Webhook: Ignoring protocol message');
      }
      return;
    } else if (msgContent.messageContextInfo && Object.keys(msgContent).length <= 2) {
      // Message only contains context info without actual content - ignore
      console.log('Webhook: Ignoring message with only context info');
      return;
    } else {
      // Try to get text from other message types
      // But avoid saving raw JSON as content
      const possibleText = message.body || message.text || '';
      if (possibleText) {
        content = possibleText;
      } else {
        // Check if there's any meaningful content we can extract
        const knownMetaKeys = ['messageContextInfo', 'senderKeyDistributionMessage', 'protocolMessage'];
        const contentKeys = Object.keys(msgContent).filter(k => !knownMetaKeys.includes(k));
        
        if (contentKeys.length === 0) {
          console.log('Webhook: Ignoring message with no extractable content');
          return;
        }
        
        // For unknown message types, log but don't save raw JSON
        console.log('Webhook: Unknown message type, keys:', contentKeys);
        content = '[Mensagem não suportada]';
      }
    }

    // If Evolution provides media URL directly
    if (data.media?.url && !mediaUrl) {
      mediaUrl = data.media.url;
    }

    // Download and save media locally for media types
    const shouldDownloadMedia = mediaTypes.includes(messageType) && (!mediaUrl || !isLocalUploadsUrl(mediaUrl));
    
    if (shouldDownloadMedia) {
      console.log('Webhook: Downloading media for message:', messageId, 'type:', messageType);

      const localMedia = await downloadAndSaveMedia(connection, data, messageType);

      if (localMedia) {
        mediaUrl = localMedia.url;
        mediaMimetype = localMedia.mimetype || mediaMimetype;
        console.log('Webhook: Media downloaded and saved:', mediaUrl);
      } else {
        console.log('Webhook: Could not download media');
      }
    }

    // If message already existed, only update its media fields and exit
    if (existingRow) {
      if (mediaTypes.includes(messageType) && mediaUrl && isLocalUploadsUrl(mediaUrl) &&
          (!existingRow.media_url || !isLocalUploadsUrl(existingRow.media_url))) {
        await query(
          `UPDATE chat_messages SET media_url = $1, media_mimetype = COALESCE($2, media_mimetype) WHERE id = $3`,
          [mediaUrl, mediaMimetype, existingRow.id]
        );
        console.log('Webhook: Updated existing message media:', messageId);
      }
      return;
    }

    // Get message timestamp
    const timestamp = message.messageTimestamp 
      ? new Date(parseInt(message.messageTimestamp) * 1000) 
      : new Date();

    // Get sender info for group messages
    const senderName = isGroup && !fromMe
      ? (pushName || null)
      : null;
    const senderPhone = isGroup && !fromMe
      ? groupParticipantPhone
      : null;

    // Insert message - use ON CONFLICT to handle duplicates gracefully
    try {
      const insertResult = await query(
        `INSERT INTO chat_messages 
          (conversation_id, message_id, from_me, content, message_type, media_url, media_mimetype, quoted_message_id, sender_name, sender_phone, status, timestamp, link_preview)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL AND message_id NOT LIKE 'temp_%'
         DO UPDATE SET 
           media_url = COALESCE(EXCLUDED.media_url, chat_messages.media_url),
           media_mimetype = COALESCE(EXCLUDED.media_mimetype, chat_messages.media_mimetype),
           link_preview = COALESCE(EXCLUDED.link_preview, chat_messages.link_preview),
           status = CASE WHEN chat_messages.status = 'pending' THEN 'sent' ELSE chat_messages.status END
         RETURNING id`,
        [
          conversationId,
          messageId,
          fromMe,
          content,
          messageType,
          mediaUrl,
          mediaMimetype,
          quotedMessageId,
          senderName,
          senderPhone,
          fromMe ? 'sent' : 'received',
          timestamp,
          linkPreview ? JSON.stringify(linkPreview) : null
        ]
      );

      if (insertResult.rows.length > 0) {
        console.log('Webhook: Message saved/updated:', messageId, 'Type:', messageType, 'FromMe:', fromMe, 'Content:', content?.substring(0, 50));

        // Push notification on incoming message (skip own messages); honors per-conversation mute
        if (!fromMe && connection.organization_id) {
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
              else preview = 'Nova mensagem';
              await sendPushToOrgUsers(connection.organization_id, {
                title: titleName,
                body: `${senderPrefix}${preview}`,
                url: '/chat',
                tag: `conv-${conversationId}`,
                data: { conversation_id: conversationId, type: 'new_message', is_group: !!conv.is_group },
              });
            } catch (e) {
              console.error('[Evolution] push notify error:', e.message);
            }
          })();
        }

        // ==========================================
        // SALES & SEO TRACKER DETECTION
        // ==========================================
        try {
          const messageDataForSEO = {
            content,
            fromMe,
            phone: contactPhone || rawRemoteJid?.replace(/\D/g, '') || null
          };
          
          await detectSalesSeoLead(connection.id, conversationId, messageDataForSEO);
          await updateSalesSeoEvolution(conversationId, messageDataForSEO);
        } catch (seoErr) {
          console.error('[Sales SEO] Error in webhook processing:', seoErr.message);
        }
        // ==========================================

        // Pause nurturing sequences on incoming message
        if (!fromMe && contactPhone && connection.organization_id) {
          pauseNurturingOnReply(contactPhone, connection.organization_id, conversationId)
            .catch(err => console.error('[Evolution] Error pausing nurturing:', err.message));

          // Emit lead_replied for the CRM event bus
          (async () => {
            try {
              const dealRow = await query(
                `SELECT cd.deal_id FROM crm_deal_contacts cd
                 JOIN contacts c ON c.id = cd.contact_id
                 WHERE RIGHT(REGEXP_REPLACE(c.phone, '\\D', '', 'g'), 9) = RIGHT($1, 9)
                 ORDER BY cd.is_primary DESC NULLS LAST
                 LIMIT 1`,
                [contactPhone]
              );
              await emitLeadEvent({
                organizationId: connection.organization_id,
                dealId: dealRow.rows[0]?.deal_id || null,
                contactPhone,
                eventType: 'lead_replied',
                payload: { conversation_id: conversationId, message_id: messageId },
                source: 'chat',
              });
            } catch (e) {
              console.error('[Evolution] emit lead_replied failed:', e.message);
            }
          })();
        }

        // ======= GROUP SECRETARY: AI analysis for group messages =======
         if (isGroup && !fromMe && content && connection.organization_id) {
          const groupNameForSecretary = data.groupMetadata?.subject || data.groupSubject || message.groupMetadata?.subject || 'Grupo';
          // Extract mentionedJids from ALL possible locations in the webhook payload
          const extractMentionedJids = () => {
            const sources = [
              // extendedTextMessage is the most common for text with mentions
              msgContent?.extendedTextMessage?.contextInfo?.mentionedJid,
              msgContent?.extendedTextMessage?.contextInfo?.mentionedJids,
              // Some Evolution versions put contextInfo at message root
              msgContent?.contextInfo?.mentionedJid,
              msgContent?.contextInfo?.mentionedJids,
              // Direct on the message object
              message?.contextInfo?.mentionedJid,
              message?.contextInfo?.mentionedJids,
              // In the data/payload root
              data?.contextInfo?.mentionedJid,
              data?.contextInfo?.mentionedJids,
              data?.mentionedJids,
              data?.mentionedJid,
              // Some versions nest under message.message
              message?.message?.extendedTextMessage?.contextInfo?.mentionedJid,
              message?.message?.extendedTextMessage?.contextInfo?.mentionedJids,
            ];
            for (const src of sources) {
              if (Array.isArray(src) && src.length > 0) return src;
            }
            return [];
          };
          const mentionedJids = extractMentionedJids();
          console.log('[GroupSecretary] mentionedJids extracted:', JSON.stringify(mentionedJids), 'from message keys:', Object.keys(msgContent || {}));
          analyzeGroupMessage({
            organizationId: connection.organization_id,
            conversationId,
            messageContent: content,
            senderName: pushName || senderName || 'Desconhecido',
            senderPhone: groupParticipantPhone || null,
            groupName: groupNameForSecretary,
            mentionedJids,
          }).catch(err => console.error('[GroupSecretary] Error:', err.message));
        }

        // Check for active flow sessions first (priority over keywords)
        let flowHandled = false;
        if (!fromMe && messageType === 'text' && content) {
          console.log('[Evolution] Checking for active flow sessions...');
          const continueResult = await continueActiveFlow(connection, conversationId, content);
          
          if (continueResult?.continued) {
            console.log('[Evolution] Flow continued successfully');
            flowHandled = true;
          }
          
          if (!flowHandled) {
            // If no active flow, check for keyword-triggered flows
            console.log('[Evolution] No active flow, checking keywords...');
            const flowTriggered = await checkAndTriggerFlow(connection, conversationId, content);
            if (flowTriggered) flowHandled = true;
          }
        }

        // Auto-replies (Away / Out of Office)
        if (!fromMe) {
          handleAutoReplies(connection, remoteJid, content || '').catch(err => {
            console.error('[Evolution] Auto-reply error:', err.message);
          });
        }

        // AI agent processing - supports text, audio, image, document, video, sticker
        if (!fromMe && !flowHandled) {
          const aiSupportedTypes = ['text', 'image', 'audio', 'video', 'document', 'sticker'];
          if (aiSupportedTypes.includes(messageType) && (content || mediaUrl)) {
            console.log('[Evolution] Checking AI agent for message type:', messageType);
            processIncomingWithAgent({
              connection,
              conversationId,
              contactPhone,
              contactName: pushName || senderName || contactPhone,
              messageContent: content,
              messageType,
              mediaUrl: mediaUrl || null,
              mediaMimetype: mediaMimetype || null,
              mediaFilename: msgContent?.documentMessage?.fileName || null,
            }).then(result => {
              if (result.handled) {
                console.log('[Evolution] AI Agent handled message, agent:', result.agentId, 'type:', messageType);
              }
            }).catch(err => {
              console.error('[Evolution] AI Agent processing error:', err.message);
            });
          }
        }
      }
    } catch (insertError) {
      // Log but don't throw - allow webhook to continue for other messages
      console.error('Webhook: Insert message failed:', insertError.message, 'MessageId:', messageId);
    }
  } catch (error) {
    console.error('Handle message upsert error:', error.message);
  }
}

// Handle message status updates (delivered, read, etc)
async function handleMessageUpdate(connection, data) {
  try {
    const updates = Array.isArray(data) ? data : [data];

    for (const update of updates) {
      const messageId = update.key?.id || update.id;
      const status = update.status;

      if (!messageId) continue;

      // Map Evolution status to our status
      let newStatus = null;
      switch (status) {
        case 1: // PENDING
          newStatus = 'pending';
          break;
        case 2: // SENT (server received)
          newStatus = 'sent';
          break;
        case 3: // DELIVERED
          newStatus = 'delivered';
          break;
        case 4: // READ
          newStatus = 'read';
          break;
        case 5: // PLAYED (for audio)
          newStatus = 'played';
          break;
      }

      if (newStatus) {
        await query(
          `UPDATE chat_messages SET status = $1 WHERE message_id = $2`,
          [newStatus, messageId]
        );
        console.log('Webhook: Message status updated:', messageId, '->', newStatus);
      }
    }
  } catch (error) {
    console.error('Handle message update error:', error);
  }
}

// Handle connection status changes
async function handleConnectionUpdate(connection, data) {
  try {
    const state = data.state || data.status;
    let newStatus = 'disconnected';

    if (state === 'open' || state === 'connected') {
      newStatus = 'connected';
    } else if (state === 'connecting') {
      newStatus = 'connecting';
    }

    await query(
      `UPDATE connections SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, connection.id]
    );

    console.log('Webhook: Connection status updated:', connection.instance_name, '->', newStatus);
  } catch (error) {
    console.error('Handle connection update error:', error);
  }
}

// Handle presence/typing status updates
async function handlePresenceUpdate(connection, data) {
  try {
    console.log('Webhook: Presence update data:', JSON.stringify(data, null, 2));
    
    const remoteJid = data.id || data.remoteJid || data.participant;
    const presences = data.presences || data.presence || {};
    
    if (!remoteJid) {
      console.log('Webhook: No remoteJid in presence update');
      return;
    }
    
    // Normalize the JID
    const normalizedJid = normalizeRemoteJid(remoteJid);
    const contactPhone = extractPhoneFromJid(remoteJid);
    
    // Find conversation
    const convResult = await query(
      `SELECT id FROM conversations 
       WHERE connection_id = $1 
       AND (remote_jid = $2 OR contact_phone = $3)
       LIMIT 1`,
      [connection.id, normalizedJid, contactPhone]
    );
    
    if (convResult.rows.length === 0) {
      console.log('Webhook: No conversation found for presence update');
      return;
    }
    
    const conversationId = convResult.rows[0].id;
    
    // Check presence state - can be 'composing', 'paused', 'available', 'unavailable'
    let isTyping = false;
    
    // Handle different presence formats from Evolution API
    if (typeof presences === 'object') {
      for (const key in presences) {
        const presence = presences[key];
        if (presence?.lastKnownPresence === 'composing' || presence === 'composing') {
          isTyping = true;
          break;
        }
      }
    } else if (presences === 'composing' || data.status === 'composing') {
      isTyping = true;
    }
    
    // Update typing status in memory cache
    typingStatus.set(conversationId, {
      isTyping,
      timestamp: Date.now()
    });
    
    console.log('Webhook: Typing status updated for conversation:', conversationId, 'isTyping:', isTyping);
    
    // Auto-clear typing status after 10 seconds
    if (isTyping) {
      setTimeout(() => {
        const current = typingStatus.get(conversationId);
        if (current && Date.now() - current.timestamp >= 10000) {
          typingStatus.set(conversationId, { isTyping: false, timestamp: Date.now() });
        }
      }, 10000);
    }
  } catch (error) {
    console.error('Handle presence update error:', error);
  }
}

// Get typing status for a conversation
router.get('/typing/:conversationId', authenticate, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    // Check if UUID
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(conversationId);
    let connectionIds = [];

    if (isUuid) {
      connectionIds = await getUserConnectionIds(req.userId);
      const convResult = await query(
        `SELECT id FROM conversations 
         WHERE id = $1 AND connection_id = ANY($2)`,
        [conversationId, connectionIds]
      );
      
      if (convResult.rows.length === 0) {
        return res.status(404).json({ error: 'Conversa não encontrada' });
      }
    }
    
    const status = typingStatus.get(conversationId);
    
    // Clear stale typing status (older than 10 seconds)
    if (status && Date.now() - status.timestamp > 10000) {
      typingStatus.set(conversationId, { isTyping: false, timestamp: Date.now() });
      return res.json({ isTyping: false });
    }
    
    res.json({ isTyping: status?.isTyping || false });
  } catch (error) {
    console.error('Get typing status error:', error);
    res.status(500).json({ error: 'Erro ao buscar status de digitação' });
  }
});

// Helper to get user's connection IDs
async function getUserConnectionIds(userId) {
  const result = await query(
    `SELECT id FROM connections 
     WHERE user_id = $1 
     OR id IN (SELECT connection_id FROM connection_members WHERE user_id = $1)
     OR organization_id IN (
       SELECT organization_id FROM organization_members 
       WHERE user_id = $1 AND role IN ('owner', 'admin', 'manager')
     )`,
    [userId]
  );
  return result.rows.map(r => r.id);
}

// Configure webhook on Evolution API
router.post('/:connectionId/configure-webhook', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { webhookUrl } = req.body;

    // Get connection
    const connResult = await query(
      'SELECT * FROM connections WHERE id = $1 AND user_id = $2',
      [connectionId, req.userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];

    // Configure webhook on Evolution API
    const webhookConfig = {
      enabled: true,
      url: webhookUrl,
      webhookByEvents: true,
      webhook_by_events: true,
      // Keep payloads smaller; media is fetched on-demand by getBase64FromMediaMessage.
      webhookBase64: false,
      webhook_base64: false,
      events: [
        'APPLICATION_STARTUP',
        'QRCODE_UPDATED',
        'MESSAGES_SET',
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'MESSAGES_DELETE',
        'SEND_MESSAGE',
        'CONTACTS_SET',
        'CONTACTS_UPSERT',
        'CONTACTS_UPDATE',
        'PRESENCE_UPDATE',
        'CHATS_SET',
        'CHATS_UPSERT',
        'CHATS_UPDATE',
        'CHATS_DELETE',
        'GROUPS_UPSERT',
        'GROUPS_UPDATE',
        'GROUP_PARTICIPANTS_UPDATE',
        'CONNECTION_UPDATE',
        'CALL',
        'LABELS_EDIT',
        'LABELS_ASSOCIATION'
      ]
    };

    await evolutionRequest(`/webhook/set/${connection.instance_name}`, 'POST', webhookConfig);

    // Save webhook URL to database
    await query(
      `UPDATE connections SET webhook_url = $1, updated_at = NOW() WHERE id = $2`,
      [webhookUrl, connectionId]
    );

    res.json({ success: true, message: 'Webhook configurado com sucesso' });
  } catch (error) {
    console.error('Configure webhook error:', error);
    res.status(500).json({ error: 'Erro ao configurar webhook' });
  }
});

// Get current webhook config
router.get('/:connectionId/webhook', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    // Get connection
    const connResult = await query(
      'SELECT * FROM connections WHERE id = $1 AND user_id = $2',
      [connectionId, req.userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];

    // Get webhook config from Evolution
    try {
      const webhookResult = await evolutionRequest(`/webhook/find/${connection.instance_name}`, 'GET');
      res.json({
        configured: true,
        url: webhookResult.url || connection.webhook_url,
        events: webhookResult.events || [],
      });
    } catch (e) {
      res.json({
        configured: false,
        url: connection.webhook_url || null,
        events: [],
      });
    }
  } catch (error) {
    console.error('Get webhook error:', error);
    res.status(500).json({ error: 'Erro ao buscar webhook' });
  }
});

// ==========================================
// SYNC HISTORY - Import messages from phone
// ==========================================

// Get all chats from phone
router.get('/:connectionId/chats', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;

    const connResult = await query(
      'SELECT * FROM connections WHERE id = $1 AND user_id = $2',
      [connectionId, req.userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];

    if (connection.status !== 'connected') {
      return res.status(400).json({ error: 'Conexão não está ativa' });
    }

    // Fetch all chats from Evolution API
    const chats = await evolutionRequest(`/chat/findChats/${connection.instance_name}`, 'POST', {});

    res.json(chats || []);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Erro ao buscar conversas' });
  }
});

// Sync messages from a specific chat
router.post('/:connectionId/sync-chat', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { remoteJid, days = 7 } = req.body;

    console.log('Sync chat request:', { connectionId, remoteJid, days });

    if (!remoteJid) {
      return res.status(400).json({ error: 'remoteJid é obrigatório' });
    }

    const connResult = await query(
      'SELECT * FROM connections WHERE id = $1 AND (user_id = $2 OR organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = $2))',
      [connectionId, req.userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];

    if (connection.status !== 'connected') {
      return res.status(400).json({ error: 'Conexão não está ativa' });
    }

    // Fetch messages from Evolution API with better error handling
    let messages = [];
    try {
      messages = await evolutionRequest(`/chat/findMessages/${connection.instance_name}`, 'POST', {
        where: {
          key: {
            remoteJid: remoteJid
          }
        },
        limit: 500 // Limit to prevent overload
      });
    } catch (evolutionError) {
      console.error('Evolution API findMessages error:', evolutionError.message);
      // Return a more helpful error message
      return res.status(502).json({ 
        error: 'Erro ao buscar mensagens da Evolution API',
        details: evolutionError.message 
      });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.json({ imported: 0, skipped: 0, total: 0, message: 'Nenhuma mensagem encontrada na Evolution API' });
    }

    // Filter messages by date
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - days);
    const daysAgoTimestamp = Math.floor(daysAgo.getTime() / 1000);

    const filteredMessages = messages.filter(msg => {
      const msgTimestamp = msg.messageTimestamp || msg.message?.messageTimestamp;
      return msgTimestamp >= daysAgoTimestamp;
    });

    console.log(`Sync: Found ${messages.length} messages, ${filteredMessages.length} in last ${days} days`);

    // Find or create conversation (normalize JID to avoid duplicates)
    const normalizedRemoteJid = normalizeRemoteJid(remoteJid);
    const contactPhone = extractPhoneFromJid(remoteJid);

    let convResult = await query(
      `SELECT * FROM conversations 
       WHERE connection_id = $1 
       AND (remote_jid = $2 OR contact_phone = $3)
       ORDER BY last_message_at DESC
       LIMIT 1`,
      [connection.id, normalizedRemoteJid, contactPhone]
    );

    let conversationId;

    if (convResult.rows.length === 0) {
      // Create new conversation
      const newConv = await query(
        `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone, last_message_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id`,
        [connection.id, normalizedRemoteJid, contactPhone, contactPhone]
      );
      conversationId = newConv.rows[0].id;
    } else {
      conversationId = convResult.rows[0].id;

      // Update remote_jid if it was different (migrate old format)
      if (convResult.rows[0].remote_jid !== normalizedRemoteJid) {
        await query(
          `UPDATE conversations SET remote_jid = $1 WHERE id = $2`,
          [normalizedRemoteJid, conversationId]
        );
      }
    }

    // Import messages
    let imported = 0;
    let skipped = 0;

    for (const msg of filteredMessages) {
      try {
        const key = msg.key;
        const messageId = key?.id;
        
        if (!messageId) continue;

        // Check if message already exists
        const existing = await query(
          `SELECT id FROM chat_messages WHERE message_id = $1`,
          [messageId]
        );

        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        // Extract message content
        const msgContent = msg.message || {};
        let content = '';
        let messageType = 'text';
        let mediaUrl = null;
        let mediaMimetype = null;

        if (msgContent.conversation) {
          content = msgContent.conversation;
        } else if (msgContent.extendedTextMessage) {
          content = msgContent.extendedTextMessage.text;
        } else if (msgContent.imageMessage) {
          messageType = 'image';
          content = msgContent.imageMessage.caption || '[Imagem]';
          mediaMimetype = msgContent.imageMessage.mimetype || null;
          mediaUrl = msgContent.imageMessage.url;
        } else if (msgContent.videoMessage) {
          messageType = 'video';
          content = msgContent.videoMessage.caption || '[Vídeo]';
          mediaMimetype = msgContent.videoMessage.mimetype || null;
          mediaUrl = msgContent.videoMessage.url;
        } else if (msgContent.audioMessage) {
          messageType = 'audio';
          content = '[Áudio]';
          mediaMimetype = msgContent.audioMessage.mimetype || null;
          mediaUrl = msgContent.audioMessage.url;
        } else if (msgContent.documentMessage) {
          messageType = 'document';
          content = msgContent.documentMessage.fileName || '[Documento]';
          mediaMimetype = msgContent.documentMessage.mimetype || null;
          mediaUrl = msgContent.documentMessage.url;
        } else if (msgContent.stickerMessage) {
          messageType = 'sticker';
          content = '[Figurinha]';
          mediaMimetype = msgContent.stickerMessage.mimetype || null;
          mediaUrl = msgContent.stickerMessage.url;
        } else {
          content = '[Mensagem não suportada]';
        }

        const mediaTypes = ['image', 'audio', 'video', 'document', 'sticker'];
        if (mediaTypes.includes(messageType) && !mediaUrl) {
          const localMedia = await downloadAndSaveMedia(connection, msg, messageType);
          if (localMedia) {
            mediaUrl = localMedia.url;
            mediaMimetype = localMedia.mimetype || mediaMimetype;
          }
        }

        const timestamp = msg.messageTimestamp 
          ? new Date(parseInt(msg.messageTimestamp) * 1000) 
          : new Date();

        await query(
          `INSERT INTO chat_messages 
            (conversation_id, message_id, from_me, content, message_type, media_url, media_mimetype, status, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            conversationId,
            messageId,
            key.fromMe || false,
            content,
            messageType,
            mediaUrl,
            mediaMimetype,
            'received',
            timestamp
          ]
        );

        imported++;
      } catch (e) {
        console.error('Error importing message:', e.message);
      }
    }

    // Update conversation last_message_at
    await query(
      `UPDATE conversations SET last_message_at = (
        SELECT MAX(timestamp) FROM chat_messages WHERE conversation_id = $1
      ), updated_at = NOW() WHERE id = $1`,
      [conversationId]
    );

    res.json({ 
      imported, 
      skipped, 
      total: filteredMessages.length,
      message: `Importadas ${imported} mensagens dos últimos ${days} dias`
    });
  } catch (error) {
    console.error('Sync chat error:', error);
    res.status(500).json({ error: 'Erro ao sincronizar mensagens' });
  }
});

// Sync all chats (bulk import)
router.post('/:connectionId/sync-all', authenticate, async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { days = 7 } = req.body;

    const connResult = await query(
      'SELECT * FROM connections WHERE id = $1 AND (user_id = $2 OR organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = $2))',
      [connectionId, req.userId]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];

    if (connection.status !== 'connected') {
      return res.status(400).json({ error: 'Conexão não está ativa' });
    }

    // Fetch all chats
    const chats = await evolutionRequest(`/chat/findChats/${connection.instance_name}`, 'POST', {});

    if (!chats || chats.length === 0) {
      return res.json({ message: 'Nenhuma conversa encontrada', total: 0 });
    }

    // Filter only individual chats (not groups)
    const individualChats = chats.filter(chat => 
      chat.id?.includes('@s.whatsapp.net') || chat.id?.includes('@c.us')
    );

    console.log(`Sync all: Found ${chats.length} chats, ${individualChats.length} individual`);

    let totalImported = 0;
    let totalChats = 0;

    // Process each chat (limit to 20 to prevent timeout)
    const chatsToProcess = individualChats.slice(0, 20);

    for (const chat of chatsToProcess) {
      try {
        const remoteJid = chat.id;
        
        // Fetch messages for this chat
        const messages = await evolutionRequest(`/chat/findMessages/${connection.instance_name}`, 'POST', {
          where: {
            key: {
              remoteJid: remoteJid
            }
          },
          limit: 100
        });

        if (!messages || messages.length === 0) continue;

        // Filter by date
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - days);
        const daysAgoTimestamp = Math.floor(daysAgo.getTime() / 1000);

        const filteredMessages = messages.filter(msg => {
          const msgTimestamp = msg.messageTimestamp || msg.message?.messageTimestamp;
          return msgTimestamp >= daysAgoTimestamp;
        });

        if (filteredMessages.length === 0) continue;

        // Find or create conversation
        const contactPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
        const contactName = chat.name || chat.pushName || contactPhone;
        
        let convResult = await query(
          `SELECT id FROM conversations WHERE connection_id = $1 AND remote_jid = $2`,
          [connection.id, remoteJid]
        );

        let conversationId;

        if (convResult.rows.length === 0) {
          const newConv = await query(
            `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone, last_message_at)
             VALUES ($1, $2, $3, $4, NOW())
             RETURNING id`,
            [connection.id, remoteJid, contactName, contactPhone]
          );
          conversationId = newConv.rows[0].id;
        } else {
          conversationId = convResult.rows[0].id;
        }

        // Import messages
        for (const msg of filteredMessages) {
          try {
            const key = msg.key;
            const messageId = key?.id;
            
            if (!messageId) continue;

            // Check if exists
            const existing = await query(
              `SELECT id FROM chat_messages WHERE message_id = $1`,
              [messageId]
            );

            if (existing.rows.length > 0) continue;

            // Extract content
            const msgContent = msg.message || {};
            let content = msgContent.conversation || 
                          msgContent.extendedTextMessage?.text || 
                          msgContent.imageMessage?.caption ||
                          msgContent.videoMessage?.caption ||
                          '[Mídia]';

            let messageType = 'text';
            if (msgContent.imageMessage) messageType = 'image';
            else if (msgContent.videoMessage) messageType = 'video';
            else if (msgContent.audioMessage) messageType = 'audio';
            else if (msgContent.documentMessage) messageType = 'document';

            const timestamp = msg.messageTimestamp 
              ? new Date(parseInt(msg.messageTimestamp) * 1000) 
              : new Date();

            await query(
              `INSERT INTO chat_messages 
                (conversation_id, message_id, from_me, content, message_type, status, timestamp)
               VALUES ($1, $2, $3, $4, $5, 'received', $6)`,
              [conversationId, messageId, key.fromMe || false, content, messageType, timestamp]
            );

            totalImported++;
          } catch (e) {
            // Skip errors
          }
        }

        totalChats++;
      } catch (e) {
        console.error('Error syncing chat:', e.message);
      }
    }

    res.json({ 
      message: `Sincronização concluída`,
      chats_processed: totalChats,
      messages_imported: totalImported,
      days: days
    });
  } catch (error) {
    console.error('Sync all error:', error);
    res.status(500).json({ error: 'Erro ao sincronizar conversas' });
  }
});

export default router;
