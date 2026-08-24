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

// List surveys
router.get('/', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const result = await query(
      `SELECT s.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM external_form_fields WHERE form_id = s.id) as question_count
       FROM external_forms s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.organization_id = $1 AND s.display_mode = 'survey'
       ORDER BY s.created_at DESC`,
      [org.organization_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    logError('Error fetching surveys:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create survey
router.post('/', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const {
      name,
      description,
      logo_url,
      primary_color,
      background_color,
      text_color,
      welcome_message,
      thank_you_message,
      fields
    } = req.body;

    const slug = `pesquisa-${Math.random().toString(36).substring(2, 8)}`;

    const formResult = await query(
      `INSERT INTO external_forms (
        organization_id, name, slug, description, logo_url,
        primary_color, background_color, text_color,
        welcome_message, thank_you_message, display_mode, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'survey', $11)
      RETURNING *`,
      [
        org.organization_id, name, slug, description, logo_url,
        primary_color || '#f97316', background_color || '#ffffff',
        text_color || '#1f2937',
        welcome_message || 'Gostaríamos de ouvir sua opinião!',
        thank_you_message || 'Obrigado por participar!',
        req.userId
      ]
    );

    const survey = formResult.rows[0];

    if (fields && fields.length > 0) {
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        await query(
          `INSERT INTO external_form_fields (form_id, field_key, field_label, field_type, is_required, options, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            survey.id, `q_${i}`, field.field_label, field.field_type || 'text',
            field.is_required || false, field.options ? JSON.stringify(field.options) : null, i
          ]
        );
      }
    }

    res.json(survey);
  } catch (error) {
    logError('Error creating survey:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
