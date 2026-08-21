import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { logInfo, logError } from '../logger.js';

const router = express.Router();

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
      welcome_message,
      thank_you_message,
      redirect_url,
      trigger_flow_id,
      connection_id,
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
        primary_color, background_color, text_color, button_text,
        welcome_message, thank_you_message, redirect_url,
        trigger_flow_id, connection_id, created_by, display_mode, transition_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        org.organization_id, name, slug, description, logo_url, logo_size || 48,
        primary_color || '#6366f1', background_color || '#ffffff',
        text_color || '#1f2937', button_text || 'Enviar',
        welcome_message || 'Olá! Vamos começar?',
        thank_you_message || 'Obrigado pelo contato! Em breve entraremos em contato.',
        redirect_url, trigger_flow_id || null, connection_id || null, req.userId,
        ['chat', 'typeform', 'standard'].includes(display_mode) ? display_mode : 'typeform',
        transition_type || 'slide-right'
      ]
    );

    const form = formResult.rows[0];

    // Create default fields if none provided
    const formFields = fields && fields.length > 0 ? fields : [
      { field_key: 'name', field_label: 'Qual é o seu nome?', field_type: 'text', is_required: true },
      { field_key: 'phone', field_label: 'Seu WhatsApp com DDD', field_type: 'phone', is_required: true, placeholder: '(11) 99999-9999' },
      { field_key: 'city', field_label: 'Em qual cidade você está?', field_type: 'text', is_required: false },
      { field_key: 'state', field_label: 'E o estado?', field_type: 'text', is_required: false },
    ];

    for (let i = 0; i < formFields.length; i++) {
      const field = formFields[i];
      await query(
        `INSERT INTO external_form_fields (form_id, field_key, field_label, field_type, placeholder, is_required, validation_regex, options, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          form.id, field.field_key, field.field_label, field.field_type || 'text',
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
      welcome_message,
      thank_you_message,
      redirect_url,
      trigger_flow_id,
      connection_id,
      display_mode,
      transition_type,
      fields
    } = req.body;

    // Update form
    await query(
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
        welcome_message = COALESCE($9, welcome_message),
        thank_you_message = COALESCE($10, thank_you_message),
        redirect_url = $11,
        trigger_flow_id = $12,
        connection_id = $13,
        display_mode = $16,
        transition_type = $18,
        updated_at = NOW()
       WHERE id = $14 AND organization_id = $15`,
      [
        name, description, is_active, logo_url, primary_color,
        background_color, text_color, button_text, welcome_message,
        thank_you_message, redirect_url, trigger_flow_id || null,
        connection_id || null, req.params.id, org.organization_id,
        display_mode || 'typeform',
        logo_size,
        transition_type || 'slide-right'
      ]
    );

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
              field.field_label, field.field_type, field.placeholder,
              field.is_required, field.validation_regex,
              field.options ? JSON.stringify(field.options) : null, i, field.id
            ]
          );
        } else {
          await query(
            `INSERT INTO external_form_fields (form_id, field_key, field_label, field_type, placeholder, is_required, validation_regex, options, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              req.params.id, field.field_key, field.field_label, field.field_type || 'text',
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
    const formResult = await query(
      `SELECT f.id, f.name, f.slug, f.description, f.logo_url, f.logo_size,
        f.primary_color, f.background_color, f.text_color,
        f.button_text, f.welcome_message, f.is_active, f.display_mode, f.transition_type, f.redirect_url, f.thank_you_message,
        o.name as organization_name
       FROM external_forms f
       JOIN organizations o ON o.id = f.organization_id
       WHERE f.slug = $1`,
      [req.params.slug]
    );

    if (!formResult.rows[0]) {
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

    res.json({
      ...formResult.rows[0],
      fields: fieldsResult.rows
    });
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
       WHERE f.slug = $1`,
      [req.params.slug]
    );

    if (!formResult.rows[0]) {
      return res.status(404).json({ error: 'Formulário não encontrado' });
    }

    const form = formResult.rows[0];

    // Extract standard fields
    const name = data.name || data.nome || '';
    const phone = (data.phone || data.telefone || data.whatsapp || '').replace(/\D/g, '');
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

    // Create prospect
    if (phone) {
      try {
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

        // Create chat_contact for WhatsApp messaging
        // Find a connection belonging to this organization to link the contact
        const orgConnResult = await query(
          `SELECT id FROM connections WHERE organization_id = $1 LIMIT 1`,
          [form.organization_id]
        );
        const orgConnectionId = orgConnResult.rows[0]?.id;

        if (orgConnectionId) {
          await query(
            `INSERT INTO chat_contacts (connection_id, phone, name, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (connection_id, phone) DO UPDATE SET
               name = COALESCE(NULLIF(EXCLUDED.name, ''), chat_contacts.name),
               updated_at = NOW()
             RETURNING id`,
            [orgConnectionId, phone, name]
          );
        }

        // Create notification alert for the form creator
        if (prospectId && form.created_by) {
          try {
            await query(
              `INSERT INTO user_alerts (user_id, type, title, message, metadata)
               VALUES ($1, 'new_lead', $2, $3, $4)`,
              [
                form.created_by,
                '📝 Novo Lead via Formulário',
                `${name || 'Novo lead'} preencheu o formulário "${form.name}"`,
                JSON.stringify({
                  prospect_id: prospectId,
                  source: 'form',
                  form_name: form.name,
                  form_slug: form.slug,
                  lead_name: name,
                  lead_phone: phone,
                  lead_email: email
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

    // Trigger flow if configured
    if (form.trigger_flow_id && form.connection_id && phone) {
      try {
        // Create flow session
        const flowSessionResult = await query(
          `INSERT INTO flow_sessions (
            flow_id, conversation_id, organization_id, status, variables
          ) VALUES ($1, $2, $3, 'active', $4)
          RETURNING id`,
          [
            form.trigger_flow_id,
            `form:${submission.id}`, // Use submission ID as conversation reference
            form.organization_id,
            JSON.stringify({ nome: name, telefone: phone, email, cidade: city, estado: state, ...data })
          ]
        );

        await query(
          `UPDATE external_form_submissions SET flow_session_id = $1, processed_at = NOW() WHERE id = $2`,
          [flowSessionResult.rows[0].id, submission.id]
        );

        logInfo('Flow triggered from external form', {
          formId: form.id,
          flowId: form.trigger_flow_id,
          phone
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
