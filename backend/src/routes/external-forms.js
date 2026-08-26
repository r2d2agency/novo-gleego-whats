import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { logInfo, logError } from '../logger.js';
import { onDealStageChanged } from '../crm-automation-scheduler.js';
import { emitLeadEvent } from '../lib/event-bus.js';
import { executeFlow } from '../lib/flow-executor.js';

const router = express.Router();
const VALID_DISPLAY_MODES = ['chat', 'typeform', 'standard', 'survey'];
const VALID_FIELD_TYPES = ['text', 'phone', 'whatsapp', 'email', 'select', 'textarea', 'rating_stars'];

// Self-healing for newer external form features on partial deployments.
(async () => {
  const ddl = [
    `ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS button_text_color VARCHAR(20) DEFAULT '#ffffff'`,
    `ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS field_background_color VARCHAR(20) DEFAULT '#ffffff'`,
    `ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS field_border_color VARCHAR(20) DEFAULT '#d1d5db'`,
    `ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS field_text_color VARCHAR(20) DEFAULT '#111827'`,
    `ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS label_color VARCHAR(20) DEFAULT '#374151'`,
    `ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS lead_target VARCHAR(20) DEFAULT 'prospect'`,
    `ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS crm_funnel_id UUID REFERENCES crm_funnels(id) ON DELETE SET NULL`,
    `ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS use_round_robin BOOLEAN DEFAULT false`,
    `ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS round_robin_user_ids UUID[] DEFAULT '{}'::uuid[]`,
    `ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS round_robin_last_index INTEGER DEFAULT -1`,
  ];

  for (const statement of ddl) {
    try {
      await query(statement);
    } catch (error) {
      logError('external_forms.self_heal_failed', error, { statement });
    }
  }
})();

// Helper: Get user's organization
async function getUserOrg(userId) {
  const result = await query(
    `SELECT om.organization_id, om.role 
     FROM organization_members om 
     WHERE om.user_id = $1 
     LIMIT 1`,
    [userId]
  );
  return result.rows[0];
}

// Helper: Generate unique slug
async function generateSlug(orgId, baseName) {
  const base = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  
  let slug = base;
  let counter = 1;
  
  while (true) {
    const existing = await query(
      `SELECT id FROM external_forms WHERE organization_id = $1 AND slug = $2`,
      [orgId, slug]
    );
    if (existing.rows.length === 0) break;
    slug = `${base}-${counter++}`;
  }
  
  return slug;
}

function normalizeFieldType(value) {
  return VALID_FIELD_TYPES.includes(value) ? value : 'text';
}

function normalizeDisplayMode(value) {
  return VALID_DISPLAY_MODES.includes(value) ? value : 'typeform';
}

function normalizeLeadTarget(value) {
  return value === 'crm' ? 'crm' : 'prospect';
}

function mapExternalFieldTypeToCrm(fieldType) {
  switch (String(fieldType || '').toLowerCase()) {
    case 'select':
      return 'select';
    case 'rating_stars':
      return 'number';
    default:
      return 'text';
  }
}

function normalizeFieldOptions(options) {
  if (!options) return null;
  if (Array.isArray(options)) {
    const cleaned = options.map((option) => String(option || '').trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : null;
  }
  if (typeof options === 'string') {
    try {
      return normalizeFieldOptions(JSON.parse(options));
    } catch {
      const cleaned = options.split('\n').map((option) => option.trim()).filter(Boolean);
      return cleaned.length > 0 ? cleaned : null;
    }
  }
  return null;
}

async function ensureCrmDealCustomFieldsForExternalForm(organizationId, fields = []) {
  const validFields = (Array.isArray(fields) ? fields : [])
    .filter((field) => field?.field_key && field?.field_label)
    .map((field, index) => ({
      field_name: String(field.field_key),
      field_label: String(field.field_label),
      field_type: mapExternalFieldTypeToCrm(field.field_type),
      options: normalizeFieldOptions(field.options),
      position: Number.isFinite(Number(field.position)) ? Number(field.position) : index,
      is_required: !!field.is_required,
    }));

  if (validFields.length === 0) return;

  const existingResult = await query(
    `SELECT id, field_name
     FROM crm_custom_fields
     WHERE organization_id = $1
       AND entity_type = 'deal'
       AND field_name = ANY($2)`,
    [organizationId, validFields.map((field) => field.field_name)]
  );

  const existingByName = new Map(existingResult.rows.map((row) => [row.field_name, row.id]));

  for (const field of validFields) {
    const existingId = existingByName.get(field.field_name);

    if (existingId) {
      await query(
        `UPDATE crm_custom_fields
         SET field_label = $1,
             field_type = $2,
             options = $3,
             is_required = $4,
             is_active = true,
             position = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [
          field.field_label,
          field.field_type,
          field.options ? JSON.stringify(field.options) : null,
          field.is_required,
          field.position,
          existingId,
        ]
      );
      continue;
    }

    await query(
      `INSERT INTO crm_custom_fields (
        organization_id, entity_type, field_name, field_label, field_type, options, is_required, is_active, position
      ) VALUES ($1, 'deal', $2, $3, $4, $5, $6, true, $7)`,
      [
        organizationId,
        field.field_name,
        field.field_label,
        field.field_type,
        field.options ? JSON.stringify(field.options) : null,
        field.is_required,
        field.position,
      ]
    );
  }
}

function normalizeUuidArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter((item) => /^[0-9a-fA-F-]{36}$/.test(item));
}

function isValidBrazilianPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return false;
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.length < 10 || national.length > 11) return false;
  const ddd = national.slice(0, 2);
  return /^[1-9][1-9]$/.test(ddd);
}

function isValidBrazilianWhatsApp(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return false;
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.length !== 11) return false;
  const ddd = national.slice(0, 2);
  const ninthDigit = national.slice(2, 3);
  return /^[1-9][1-9]$/.test(ddd) && ninthDigit === '9';
}

async function getFirstOrgUserId(organizationId) {
  const result = await query(
    `SELECT user_id
     FROM organization_members
     WHERE organization_id = $1
     ORDER BY created_at ASC NULLS LAST
     LIMIT 1`,
    [organizationId]
  );
  return result.rows[0]?.user_id || null;
}

async function ensureDefaultCompanyId(organizationId, createdByUserId) {
  const existing = await query(
    `SELECT id
     FROM crm_companies
     WHERE organization_id = $1 AND name = 'Sem empresa'
     ORDER BY created_at ASC
     LIMIT 1`,
    [organizationId]
  );

  if (existing.rows[0]?.id) return existing.rows[0].id;

  const fallbackUserId = createdByUserId || await getFirstOrgUserId(organizationId);
  const created = await query(
    `INSERT INTO crm_companies (organization_id, name, created_by)
     VALUES ($1, 'Sem empresa', $2)
     RETURNING id`,
    [organizationId, fallbackUserId]
  );
  return created.rows[0].id;
}

async function findOrCreateCrmContact(organizationId, createdByUserId, name, phone, city, state) {
  const existingContact = await query(
    `SELECT c.id
     FROM contacts c
     JOIN contact_lists cl ON cl.id = c.list_id
     JOIN organization_members om ON om.user_id = cl.user_id AND om.organization_id = $2
     WHERE c.phone = $1
     LIMIT 1`,
    [phone, organizationId]
  );

  if (existingContact.rows.length > 0) {
    return existingContact.rows[0].id;
  }

  const listOwnerId = createdByUserId || await getFirstOrgUserId(organizationId);
  let crmListResult = await query(
    `SELECT cl.id
     FROM contact_lists cl
     JOIN organization_members om ON om.user_id = cl.user_id AND om.organization_id = $1
     WHERE cl.name = 'CRM Contacts'
     LIMIT 1`,
    [organizationId]
  );

  if (crmListResult.rows.length === 0) {
    crmListResult = await query(
      `INSERT INTO contact_lists (user_id, name)
       VALUES ($1, 'CRM Contacts')
       RETURNING id`,
      [listOwnerId]
    );
  }

  const newContact = await query(
    `INSERT INTO contacts (list_id, name, phone, city, state)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [crmListResult.rows[0].id, name || phone, phone, city || null, state || null]
  );

  return newContact.rows[0].id;
}

async function resolveRoundRobinOwnerId(form) {
  const userIds = normalizeUuidArray(form.round_robin_user_ids);
  if (!form.use_round_robin || userIds.length === 0) return form.created_by || null;

  const availableUsers = await query(
    `SELECT u.id
     FROM users u
     JOIN organization_members om ON om.user_id = u.id
     WHERE om.organization_id = $1
       AND u.id = ANY($2::uuid[])
       AND COALESCE(om.is_active, true) = true
     ORDER BY array_position($2::uuid[], u.id)`,
    [form.organization_id, userIds]
  );

  if (availableUsers.rows.length === 0) {
    return form.created_by || null;
  }

  const lastIndex = Number.isInteger(form.round_robin_last_index) ? form.round_robin_last_index : -1;
  const nextIndex = (lastIndex + 1) % availableUsers.rows.length;
  const selectedUserId = availableUsers.rows[nextIndex].id;

  await query(
    `UPDATE external_forms
     SET round_robin_last_index = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [nextIndex, form.id]
  );

  return selectedUserId;
}

async function resolveDefaultConnectionForUser(organizationId, userId, fallbackConnectionId = null) {
  if (userId) {
    const sellerConnection = await query(
      `SELECT c.*, cm.is_default
         FROM connections c
         JOIN connection_members cm ON cm.connection_id = c.id
        WHERE c.organization_id = $1
          AND cm.user_id = $2
          AND cm.can_send = true
          AND c.status = 'connected'
        ORDER BY cm.is_default DESC, (c.id = $3) DESC, cm.created_at ASC
        LIMIT 1`,
      [organizationId, userId, fallbackConnectionId]
    );

    if (sellerConnection.rows[0]) {
      return sellerConnection.rows[0];
    }
  }

  if (fallbackConnectionId) {
    const fallbackConnection = await query(
      `SELECT *
         FROM connections
        WHERE id = $1
          AND organization_id = $2
          AND status = 'connected'
        LIMIT 1`,
      [fallbackConnectionId, organizationId]
    );

    if (fallbackConnection.rows[0]) {
      return fallbackConnection.rows[0];
    }
  }

  const orgConnection = await query(
    `SELECT *
       FROM connections
      WHERE organization_id = $1
        AND status = 'connected'
      ORDER BY created_at ASC
      LIMIT 1`,
    [organizationId]
  );

  return orgConnection.rows[0] || null;
}

async function ensureConversationForConnection(connectionId, phone, name) {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  const remoteJid = `${cleanPhone}@s.whatsapp.net`;

  await query(
    `INSERT INTO chat_contacts (connection_id, phone, name, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (connection_id, phone) DO UPDATE SET
       name = COALESCE(NULLIF(EXCLUDED.name, ''), chat_contacts.name),
       updated_at = NOW()`,
    [connectionId, cleanPhone, name || cleanPhone]
  );

  const existingConversation = await query(
    `SELECT id
       FROM conversations
      WHERE connection_id = $1
        AND remote_jid = $2
      LIMIT 1`,
    [connectionId, remoteJid]
  );

  if (existingConversation.rows[0]?.id) {
    return existingConversation.rows[0].id;
  }

  const createdConversation = await query(
    `INSERT INTO conversations (
      connection_id, remote_jid, contact_name, contact_phone,
      last_message_at, updated_at, attendance_status
    ) VALUES ($1, $2, $3, $4, NOW(), NOW(), 'waiting')
    RETURNING id`,
    [connectionId, remoteJid, name || cleanPhone, cleanPhone]
  );

  return createdConversation.rows[0].id;
}

// ============================================
// AUTHENTICATED ROUTES (Management)
// ============================================

// List forms for organization
router.get('/', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const result = await query(
      `SELECT f.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM external_form_fields WHERE form_id = f.id) as field_count
       FROM external_forms f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.organization_id = $1
       ORDER BY f.created_at DESC`,
      [org.organization_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    logError('Error fetching external forms:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single form with fields
router.get('/:id', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const formResult = await query(
      `SELECT * FROM external_forms WHERE id = $1 AND organization_id = $2`,
      [req.params.id, org.organization_id]
    );
    
    if (!formResult.rows[0]) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const fieldsResult = await query(
      `SELECT * FROM external_form_fields WHERE form_id = $1 ORDER BY position`,
      [req.params.id]
    );

    res.json({
      ...formResult.rows[0],
      fields: fieldsResult.rows
    });
  } catch (error) {
    logError('Error fetching form:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create form
router.post('/', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const {
      name,
      description,
      logo_url,
      logo_size,
      primary_color,
      background_color,
      text_color,
      button_text,
      button_text_color,
      field_background_color,
      field_border_color,
      field_text_color,
      label_color,
      welcome_message,
      thank_you_message,
      redirect_url,
      trigger_flow_id,
      connection_id,
      lead_target,
      crm_funnel_id,
      use_round_robin,
      round_robin_user_ids,
      display_mode,
      transition_type,
      fields
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const slug = await generateSlug(org.organization_id, name);

    // Create form
    const formResult = await query(
      `INSERT INTO external_forms (
        organization_id, name, slug, description, logo_url, logo_size,
        primary_color, background_color, text_color, button_text, button_text_color,
        field_background_color, field_border_color, field_text_color, label_color,
        welcome_message, thank_you_message, redirect_url,
        trigger_flow_id, connection_id, created_by, display_mode, transition_type,
        lead_target, crm_funnel_id, use_round_robin, round_robin_user_ids
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
      RETURNING *`,
      [
        org.organization_id, name, slug, description, logo_url, logo_size || 48,
        primary_color || '#6366f1', background_color || '#ffffff',
        text_color || '#1f2937', button_text || 'Enviar', button_text_color || '#ffffff',
        field_background_color || '#ffffff', field_border_color || '#d1d5db',
        field_text_color || '#111827', label_color || (text_color || '#1f2937'),
        welcome_message || 'Olá! Vamos começar?',
        thank_you_message || 'Obrigado pelo contato! Em breve entraremos em contato.',
        redirect_url, trigger_flow_id || null, connection_id || null, req.userId,
        normalizeDisplayMode(display_mode), transition_type || 'slide-right',
        normalizeLeadTarget(lead_target), crm_funnel_id || null,
        !!use_round_robin, normalizeUuidArray(round_robin_user_ids)
      ]
    );

    const form = formResult.rows[0];

    // Create default fields if none provided
    const formFields = fields && fields.length > 0 ? fields : [
      { field_key: 'name', field_label: 'Qual é o seu nome?', field_type: 'text', is_required: true },
      { field_key: 'phone', field_label: 'Seu telefone com DDD', field_type: 'phone', is_required: true, placeholder: '(11) 99999-9999' },
      { field_key: 'city', field_label: 'Em qual cidade você está?', field_type: 'text', is_required: false },
      { field_key: 'state', field_label: 'E o estado?', field_type: 'text', is_required: false },
    ];

    for (let i = 0; i < formFields.length; i++) {
      const field = formFields[i];
      await query(
        `INSERT INTO external_form_fields (form_id, field_key, field_label, field_type, placeholder, is_required, validation_regex, options, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          form.id, field.field_key, field.field_label, normalizeFieldType(field.field_type),
          field.placeholder, field.is_required || false, field.validation_regex,
          field.options ? JSON.stringify(field.options) : null, i
        ]
      );
    }

    // Fetch created fields
    const fieldsResult = await query(
      `SELECT * FROM external_form_fields WHERE form_id = $1 ORDER BY position`,
      [form.id]
    );

    logInfo('External form created', { formId: form.id, slug: form.slug });
    
    res.json({
      ...form,
      fields: fieldsResult.rows
    });
  } catch (error) {
    logError('Error creating external form:', error);
    res.status(500).json({ error: error.message });
  }
});

// Duplicate form
router.post('/:id/duplicate', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const formResult = await query(
      `SELECT *
       FROM external_forms
       WHERE id = $1 AND organization_id = $2`,
      [req.params.id, org.organization_id]
    );

    const sourceForm = formResult.rows[0];
    if (!sourceForm) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const fieldsResult = await query(
      `SELECT *
       FROM external_form_fields
       WHERE form_id = $1
       ORDER BY position`,
      [req.params.id]
    );

    const duplicateName = `${sourceForm.name} (Cópia)`;
    const duplicateSlug = await generateSlug(org.organization_id, duplicateName);

    const duplicatedFormResult = await query(
      `INSERT INTO external_forms (
        organization_id, name, slug, description, is_active, logo_url, logo_size,
        primary_color, background_color, text_color, button_text, button_text_color,
        field_background_color, field_border_color, field_text_color, label_color,
        welcome_message, thank_you_message, redirect_url, trigger_flow_id, connection_id,
        created_by, display_mode, transition_type, lead_target, crm_funnel_id,
        use_round_robin, round_robin_user_ids, round_robin_last_index
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, -1)
      RETURNING *`,
      [
        sourceForm.organization_id,
        duplicateName,
        duplicateSlug,
        sourceForm.description,
        sourceForm.is_active,
        sourceForm.logo_url,
        sourceForm.logo_size,
        sourceForm.primary_color,
        sourceForm.background_color,
        sourceForm.text_color,
        sourceForm.button_text,
        sourceForm.button_text_color,
        sourceForm.field_background_color,
        sourceForm.field_border_color,
        sourceForm.field_text_color,
        sourceForm.label_color,
        sourceForm.welcome_message,
        sourceForm.thank_you_message,
        sourceForm.redirect_url,
        sourceForm.trigger_flow_id,
        sourceForm.connection_id,
        req.userId,
        normalizeDisplayMode(sourceForm.display_mode),
        sourceForm.transition_type || 'slide-right',
        normalizeLeadTarget(sourceForm.lead_target),
        sourceForm.crm_funnel_id,
        !!sourceForm.use_round_robin,
        normalizeUuidArray(sourceForm.round_robin_user_ids),
      ]
    );

    const duplicatedForm = duplicatedFormResult.rows[0];

    for (const field of fieldsResult.rows) {
      await query(
        `INSERT INTO external_form_fields (
          form_id, field_key, field_label, field_type, placeholder,
          is_required, validation_regex, options, position
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          duplicatedForm.id,
          field.field_key,
          field.field_label,
          normalizeFieldType(field.field_type),
          field.placeholder,
          field.is_required,
          field.validation_regex,
          field.options,
          field.position,
        ]
      );
    }

    const duplicatedFields = await query(
      `SELECT *
       FROM external_form_fields
       WHERE form_id = $1
       ORDER BY position`,
      [duplicatedForm.id]
    );

    res.json({
      ...duplicatedForm,
      fields: duplicatedFields.rows,
    });
  } catch (error) {
    logError('Error duplicating external form:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update form
router.put('/:id', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const {
      name,
      description,
      is_active,
      logo_url,
      logo_size,
      primary_color,
      background_color,
      text_color,
      button_text,
      button_text_color,
      field_background_color,
      field_border_color,
      field_text_color,
      label_color,
      welcome_message,
      thank_you_message,
      redirect_url,
      trigger_flow_id,
      connection_id,
      lead_target,
      crm_funnel_id,
      use_round_robin,
      round_robin_user_ids,
      display_mode,
      transition_type,
      fields
    } = req.body;

    const normalizedDisplayMode = display_mode === undefined ? null : normalizeDisplayMode(display_mode);
    const normalizedLeadTarget = lead_target === undefined ? null : normalizeLeadTarget(lead_target);
    const normalizedRoundRobinUserIds = Array.isArray(round_robin_user_ids)
      ? normalizeUuidArray(round_robin_user_ids)
      : null;
    const normalizedTransitionType = transition_type === undefined ? null : (transition_type || 'slide-right');
    const normalizedCrmFunnelId = crm_funnel_id === undefined ? null : (crm_funnel_id || null);
    const normalizedTriggerFlowId = trigger_flow_id === undefined ? null : (trigger_flow_id || null);
    const normalizedConnectionId = connection_id === undefined ? null : (connection_id || null);

    // Update form
    const updateResult = await query(
      `UPDATE external_forms SET
        name = COALESCE($1, name),
        description = $2,
        is_active = COALESCE($3, is_active),
        logo_url = $4,
        logo_size = COALESCE($17, logo_size),
        primary_color = COALESCE($5, primary_color),
        background_color = COALESCE($6, background_color),
        text_color = COALESCE($7, text_color),
        button_text = COALESCE($8, button_text),
        button_text_color = COALESCE($19, button_text_color),
        field_background_color = COALESCE($20, field_background_color),
        field_border_color = COALESCE($21, field_border_color),
        field_text_color = COALESCE($22, field_text_color),
        label_color = COALESCE($23, label_color),
        welcome_message = COALESCE($9, welcome_message),
        thank_you_message = COALESCE($10, thank_you_message),
        redirect_url = $11,
        trigger_flow_id = $12,
        connection_id = $13,
        display_mode = COALESCE($16, display_mode),
        transition_type = COALESCE($18, transition_type),
        lead_target = COALESCE($24, lead_target),
        crm_funnel_id = COALESCE($25, crm_funnel_id),
        use_round_robin = COALESCE($26, use_round_robin),
        round_robin_user_ids = COALESCE($27, round_robin_user_ids),
        updated_at = NOW()
       WHERE id = $14 AND organization_id = $15
       RETURNING *`,
      [
        name, description, is_active, logo_url, primary_color,
        background_color, text_color, button_text, welcome_message,
        thank_you_message, redirect_url, normalizedTriggerFlowId,
        normalizedConnectionId, req.params.id, org.organization_id,
        normalizedDisplayMode,
        logo_size,
        normalizedTransitionType,
        button_text_color ?? null,
        field_background_color ?? null,
        field_border_color ?? null,
        field_text_color ?? null,
        label_color ?? null,
        normalizedLeadTarget,
        normalizedCrmFunnelId,
        typeof use_round_robin === 'boolean' ? use_round_robin : null,
        normalizedRoundRobinUserIds,
      ]
    );

    if (!updateResult.rows[0]) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Update fields if provided
    if (fields && Array.isArray(fields)) {
      // Get existing field IDs
      const existing = await query(
        `SELECT id FROM external_form_fields WHERE form_id = $1`,
        [req.params.id]
      );
      const existingIds = existing.rows.map(r => r.id);
      const newIds = fields.filter(f => f.id).map(f => f.id);
      
      // Delete removed fields
      const toDelete = existingIds.filter(id => !newIds.includes(id));
      if (toDelete.length > 0) {
        await query(`DELETE FROM external_form_fields WHERE id = ANY($1)`, [toDelete]);
      }

      // Upsert fields
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (field.id) {
          await query(
            `UPDATE external_form_fields SET
              field_label = $1, field_type = $2, placeholder = $3,
              is_required = $4, validation_regex = $5, options = $6, position = $7
             WHERE id = $8`,
            [
              field.field_label, normalizeFieldType(field.field_type), field.placeholder,
              field.is_required, field.validation_regex,
              field.options ? JSON.stringify(field.options) : null, i, field.id
            ]
          );
        } else {
          await query(
            `INSERT INTO external_form_fields (form_id, field_key, field_label, field_type, placeholder, is_required, validation_regex, options, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              req.params.id, field.field_key, field.field_label, normalizeFieldType(field.field_type),
              field.placeholder, field.is_required || false, field.validation_regex,
              field.options ? JSON.stringify(field.options) : null, i
            ]
          );
        }
      }
    }

    // Fetch updated form
    const formResult = await query(
      `SELECT * FROM external_forms WHERE id = $1`,
      [req.params.id]
    );
    const fieldsResult = await query(
      `SELECT * FROM external_form_fields WHERE form_id = $1 ORDER BY position`,
      [req.params.id]
    );

    res.json({
      ...formResult.rows[0],
      fields: fieldsResult.rows
    });
  } catch (error) {
    logError('Error updating external form:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete form
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    await query(
      `DELETE FROM external_forms WHERE id = $1 AND organization_id = $2`,
      [req.params.id, org.organization_id]
    );
    
    res.json({ success: true });
  } catch (error) {
    logError('Error deleting external form:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get form submissions
router.get('/:id/submissions', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const { limit = 100, offset = 0 } = req.query;

    const result = await query(
      `SELECT s.*, p.name as prospect_name, p.converted_at as prospect_converted_at
       FROM external_form_submissions s
       LEFT JOIN crm_prospects p ON p.id = s.prospect_id
       WHERE s.form_id = $1 AND s.organization_id = $2
       ORDER BY s.created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.params.id, org.organization_id, limit, offset]
    );

    res.json(result.rows);
  } catch (error) {
    logError('Error fetching submissions:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PUBLIC ROUTES (No auth required)
// ============================================

// Get public form by slug (for rendering)
router.get('/public/:slug', async (req, res) => {
  try {
    const requestedSlug = String(req.params.slug || '').trim().toLowerCase();
    
    if (!requestedSlug) {
      logInfo('Public form requested with empty slug', { ip: req.ip });
      return res.status(404).json({ error: 'Formulário não encontrado' });
    }

    logInfo('Public form lookup', { slug: requestedSlug });

    const formResult = await query(
      `SELECT f.id, f.name, f.slug, f.description, f.logo_url, f.logo_size,
        f.primary_color, f.background_color, f.text_color,
        f.button_text, f.button_text_color, f.field_background_color, f.field_border_color,
        f.field_text_color, f.label_color, f.welcome_message, f.is_active, f.display_mode,
        f.transition_type, f.redirect_url, f.thank_you_message,
        o.name as organization_name
       FROM external_forms f
       JOIN organizations o ON o.id = f.organization_id
       WHERE (LOWER(f.slug) = LOWER($1) OR f.id::text = $1 OR f.id = (CASE WHEN $1 ~ '^[0-9a-fA-F-]{36}$' THEN $1::uuid ELSE NULL END)) `,
      [requestedSlug]
    );

    if (!formResult.rows[0]) {
      // Diagnostic: check if form exists but is inactive or has different slug
      const diagnostic = await query(
        `SELECT id, slug, is_active FROM external_forms WHERE LOWER(slug) = LOWER($1) OR id::text = $1 OR id = (CASE WHEN $1 ~ '^[0-9a-fA-F-]{36}$' THEN $1::uuid ELSE NULL END)`,
        [requestedSlug]
      );
      
      logInfo('Public form not found', { 
        slug: requestedSlug, 
        matches: diagnostic.rows.length,
        found_ids: diagnostic.rows.map(r => r.id),
        inactive: diagnostic.rows.some(r => !r.is_active)
      });
      return res.status(404).json({ error: 'Formulário não encontrado' });
    }

    const fieldsResult = await query(
      `SELECT id, field_key, field_label, field_type, placeholder, is_required, options
       FROM external_form_fields 
       WHERE form_id = $1 
       ORDER BY position`,
      [formResult.rows[0].id]
    );

    // Increment view count
    await query(
      `UPDATE external_forms SET views_count = views_count + 1 WHERE id = $1`,
      [formResult.rows[0].id]
    );

    const response = {
      ...formResult.rows[0],
      // Ensure typeform is the default when display_mode is missing or invalid
      display_mode: ['chat', 'typeform', 'standard', 'survey'].includes(formResult.rows[0].display_mode)
        ? formResult.rows[0].display_mode
        : 'typeform',
      fields: fieldsResult.rows
    };

    res.json(response);
  } catch (error) {
    logError('Error fetching public form:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit form (public)
router.post('/public/:slug/submit', async (req, res) => {
  try {
    const { data, utm_source, utm_medium, utm_campaign, referrer } = req.body;

    // Get form
    const formResult = await query(
      `SELECT f.*, c.instance_id, c.wapi_token
        FROM external_forms f
        LEFT JOIN connections c ON c.id = f.connection_id
        WHERE (LOWER(f.slug) = LOWER($1) OR f.id::text = $1 OR f.id = (CASE WHEN $1 ~ '^[0-9a-fA-F-]{36}$' THEN $1::uuid ELSE NULL END)) `,
      [req.params.slug]
    );

    if (!formResult.rows[0] || !formResult.rows[0].is_active) {
      return res.status(404).json({ error: 'Formulário não encontrado' });
    }

    const form = formResult.rows[0];
    const fieldsResult = await query(
      `SELECT field_key, field_label, field_type, is_required, options, position
       FROM external_form_fields
       WHERE form_id = $1
       ORDER BY position`,
      [form.id]
    );
    const formFields = fieldsResult.rows;

    for (const field of formFields) {
      const rawValue = String(data?.[field.field_key] || '').trim();
      if (field.field_type === 'whatsapp' && rawValue && !isValidBrazilianWhatsApp(rawValue)) {
        return res.status(400).json({ error: `Informe um número de WhatsApp válido para "${field.field_label}".` });
      }
      if (field.field_type === 'phone' && rawValue && !isValidBrazilianPhone(rawValue)) {
        return res.status(400).json({ error: `Informe um telefone válido para "${field.field_label}".` });
      }
    }

    // Extract standard fields
    const name = data.name || data.nome || '';
    const phoneFieldKeys = formFields
      .filter((field) => ['phone', 'whatsapp'].includes(field.field_type))
      .map((field) => field.field_key);
    const rawPhone = [
      ...phoneFieldKeys.map((fieldKey) => data?.[fieldKey]),
      data.phone,
      data.telefone,
      data.whatsapp,
    ].find((value) => String(value || '').trim());
    const phone = String(rawPhone || '').replace(/\D/g, '');
    const email = data.email || '';
    const city = data.city || data.cidade || '';
    const state = data.state || data.estado || data.uf || '';

    // Get IP and user agent
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Create submission
    const submissionResult = await query(
      `INSERT INTO external_form_submissions (
        form_id, organization_id, data, name, phone, email, city, state,
        ip_address, user_agent, referrer, utm_source, utm_medium, utm_campaign
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        form.id, form.organization_id, JSON.stringify(data),
        name, phone, email, city, state,
        ip, userAgent, referrer, utm_source, utm_medium, utm_campaign
      ]
    );

    const submission = submissionResult.rows[0];

    let assignedUserId = form.created_by || null;

    if (phone && form.use_round_robin) {
      try {
        assignedUserId = await resolveRoundRobinOwnerId(form);
      } catch (assignmentError) {
        logError('Error resolving round robin owner for external form:', assignmentError);
      }
    }

    // Route lead to prospect or directly into CRM
    const shouldCreateCrmDeal = normalizeLeadTarget(form.lead_target) === 'crm' && !!form.crm_funnel_id;
    if (shouldCreateCrmDeal || phone) {
      try {
        if (shouldCreateCrmDeal) {
          await ensureCrmDealCustomFieldsForExternalForm(form.organization_id, formFields);

          const stageResult = await query(
            `SELECT id
             FROM crm_stages
             WHERE funnel_id = $1
             ORDER BY position ASC
             LIMIT 1`,
            [form.crm_funnel_id]
          );

          if (stageResult.rows.length === 0) {
            throw new Error('Funil do CRM sem etapa inicial configurada');
          }

          const createdByUserId = form.created_by || await getFirstOrgUserId(form.organization_id);
          const ownerId = assignedUserId || createdByUserId;
          const companyId = await ensureDefaultCompanyId(form.organization_id, createdByUserId);
          const contactId = phone
            ? await findOrCreateCrmContact(form.organization_id, createdByUserId, name, phone, city, state)
            : null;

          const maxPosResult = await query(
            `SELECT COALESCE(MAX(position), -1) + 1 AS new_position
             FROM crm_deals
             WHERE stage_id = $1 AND organization_id = $2`,
            [stageResult.rows[0].id, form.organization_id]
          );
          const nextPosition = Number(maxPosResult.rows[0]?.new_position ?? 0);

          const dealResult = await query(
            `INSERT INTO crm_deals (
              organization_id, funnel_id, stage_id, position, company_id, title,
              description, owner_id, created_by, custom_fields
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id`,
            [
              form.organization_id,
              form.crm_funnel_id,
              stageResult.rows[0].id,
              nextPosition,
              companyId,
              name || phone,
              `Lead recebido pelo formulário "${form.name}"`,
              ownerId,
              createdByUserId,
              JSON.stringify(data || {}),
            ]
          );

          if (contactId) {
            await query(
              `INSERT INTO crm_deal_contacts (deal_id, contact_id, is_primary)
               VALUES ($1, $2, true)
               ON CONFLICT (deal_id, contact_id) DO NOTHING`,
              [dealResult.rows[0].id, contactId]
            );
          }

          emitLeadEvent({
            organizationId: form.organization_id,
            dealId: dealResult.rows[0].id,
            contactPhone: phone || null,
            eventType: 'lead_created',
            payload: {
              source: 'external_form',
              form_id: form.id,
              form_name: form.name,
              funnel_id: form.crm_funnel_id,
              stage_id: stageResult.rows[0].id,
            },
            source: 'external_form',
          }).catch((err) => logError('emit external form lead_created failed', err));

          setTimeout(() => {
            onDealStageChanged(dealResult.rows[0].id, stageResult.rows[0].id, form.organization_id)
              .catch((err) => logError('initial onDealStageChanged from external form failed', err));
          }, 1500);
        } else {
          const prospectResult = await query(
            `INSERT INTO crm_prospects (
              organization_id, name, phone, email, city, state, source, custom_fields
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (organization_id, phone) DO UPDATE SET
              name = COALESCE(NULLIF(EXCLUDED.name, ''), crm_prospects.name),
              email = COALESCE(NULLIF(EXCLUDED.email, ''), crm_prospects.email),
              city = COALESCE(NULLIF(EXCLUDED.city, ''), crm_prospects.city),
              state = COALESCE(NULLIF(EXCLUDED.state, ''), crm_prospects.state),
              custom_fields = crm_prospects.custom_fields || EXCLUDED.custom_fields
            RETURNING id`,
            [
              form.organization_id, name, phone, email, city, state,
              form.name, JSON.stringify(data)
            ]
          );

          const prospectId = prospectResult.rows[0]?.id;

          if (prospectId) {
            await query(
              `UPDATE external_form_submissions SET prospect_id = $1 WHERE id = $2`,
              [prospectId, submission.id]
            );
          }
        }

        if (phone) {
          try {
          const chatConnection = await resolveDefaultConnectionForUser(
            form.organization_id,
            assignedUserId,
            form.connection_id || null
          );

          if (chatConnection?.id) {
            await query(
              `INSERT INTO chat_contacts (connection_id, phone, name, created_at, updated_at)
               VALUES ($1, $2, $3, NOW(), NOW())
               ON CONFLICT (connection_id, phone) DO UPDATE SET
                 name = COALESCE(NULLIF(EXCLUDED.name, ''), chat_contacts.name),
                 updated_at = NOW()`,
              [chatConnection.id, phone, name]
            );
          }
          } catch (chatContactError) {
            logError('Error creating chat contact from external form:', chatContactError);
          }
        }

        // Create notification alert for the form creator
        if (form.created_by) {
          try {
            await query(
              `INSERT INTO user_alerts (user_id, type, title, message, metadata)
               VALUES ($1, 'new_lead', $2, $3, $4)`,
              [
                form.created_by,
                '📝 Novo Lead via Formulário',
                `${name || 'Novo lead'} preencheu o formulário "${form.name}"`,
                JSON.stringify({
                  source: 'form',
                  form_name: form.name,
                  form_slug: form.slug,
                  lead_name: name,
                  lead_phone: phone,
                  lead_email: email,
                  lead_target: normalizeLeadTarget(form.lead_target),
                  assigned_user_id: assignedUserId,
                })
              ]
            );
          } catch (alertError) {
            logError('Error creating alert for form submission:', alertError);
          }
        }

      } catch (prospectError) {
        logError('Error creating prospect from form:', prospectError);
        // Don't fail the submission, just log the error
      }
    }

    // Increment submission count
    await query(
      `UPDATE external_forms SET submissions_count = submissions_count + 1 WHERE id = $1`,
      [form.id]
    );

    // Trigger flow using the assigned seller default connection when possible
    if (form.trigger_flow_id && phone) {
      try {
        const flowConnection = await resolveDefaultConnectionForUser(
          form.organization_id,
          assignedUserId,
          form.connection_id || null
        );

        if (!flowConnection?.id) {
          throw new Error('Nenhuma conexão ativa encontrada para disparar o fluxo');
        }

        const conversationId = await ensureConversationForConnection(flowConnection.id, phone, name);
        const initialVariables = {
          nome: name,
          telefone: phone,
          email,
          cidade: city,
          estado: state,
          assigned_user_id: assignedUserId,
          connection_id: flowConnection.id,
          submission_id: submission.id,
          ...data,
        };

        const execResult = await executeFlow(
          form.trigger_flow_id,
          conversationId,
          'start',
          initialVariables
        );

        if (!execResult?.success) {
          throw new Error(execResult?.error || 'Falha ao executar fluxo');
        }

        const flowSessionResult = await query(
          `SELECT id
             FROM flow_sessions
            WHERE conversation_id = $1
              AND flow_id = $2
              AND is_active = true
            ORDER BY started_at DESC
            LIMIT 1`,
          [conversationId, form.trigger_flow_id]
        );

        await query(
          `UPDATE external_form_submissions SET flow_session_id = $1, processed_at = NOW() WHERE id = $2`,
          [flowSessionResult.rows[0]?.id || null, submission.id]
        );

        logInfo('Flow triggered from external form', {
          formId: form.id,
          flowId: form.trigger_flow_id,
          phone,
          connectionId: flowConnection.id,
          assignedUserId,
          conversationId,
        });
      } catch (flowError) {
        logError('Error triggering flow from form:', flowError);
      }
    }

    logInfo('External form submission received', {
      formId: form.id,
      submissionId: submission.id,
      phone
    });

    res.json({
      success: true,
      thank_you_message: form.thank_you_message,
      redirect_url: form.redirect_url
    });
  } catch (error) {
    logError('Error submitting form:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
