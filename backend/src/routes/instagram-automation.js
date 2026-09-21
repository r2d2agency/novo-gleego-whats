import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

async function orgFor(userId) {
  const result = await query('SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1', [userId]);
  return result.rows[0]?.organization_id;
}

function fields(body) {
  const allowed = ['name', 'instagram_account_id', 'trigger_type', 'trigger_value', 'reply_text', 'dm_text', 'is_active', 'settings'];
  return allowed.filter((key) => body[key] !== undefined);
}

router.get('/automations', async (req, res) => {
  const organizationId = await orgFor(req.userId);
  if (!organizationId) return res.status(403).json({ error: 'No organization' });
  const result = await query('SELECT * FROM instagram_comment_automations WHERE organization_id = $1 ORDER BY created_at DESC', [organizationId]);
  return res.json(result.rows);
});

router.post('/automations', async (req, res) => {
  const organizationId = await orgFor(req.userId);
  if (!organizationId) return res.status(403).json({ error: 'No organization' });
  if (!req.body.name) return res.status(400).json({ error: 'name is required' });
  const result = await query(`INSERT INTO instagram_comment_automations (organization_id, created_by, name, instagram_account_id, trigger_type, trigger_value, reply_text, dm_text, is_active, settings) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [organizationId, req.userId, req.body.name, req.body.instagram_account_id || null, req.body.trigger_type || 'any_comment', req.body.trigger_value || null, req.body.reply_text || null, req.body.dm_text || null, req.body.is_active !== false, req.body.settings || {}]);
  return res.status(201).json(result.rows[0]);
});

router.patch('/automations/:id', async (req, res) => {
  const organizationId = await orgFor(req.userId);
  const keys = fields(req.body);
  if (!organizationId) return res.status(403).json({ error: 'No organization' });
  if (!keys.length) return res.status(400).json({ error: 'No fields to update' });
  const values = keys.map((key) => req.body[key]);
  const sets = keys.map((key, i) => `"${key}" = $${i + 2}`);
  const result = await query(`UPDATE instagram_comment_automations SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND organization_id = $${values.length + 2} RETURNING *`, [req.params.id, ...values, organizationId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Automation not found' });
  return res.json(result.rows[0]);
});

router.delete('/automations/:id', async (req, res) => {
  const organizationId = await orgFor(req.userId);
  if (!organizationId) return res.status(403).json({ error: 'No organization' });
  const result = await query('DELETE FROM instagram_comment_automations WHERE id = $1 AND organization_id = $2 RETURNING id', [req.params.id, organizationId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Automation not found' });
  return res.status(204).send();
});

router.get('/publications', async (req, res) => {
  const organizationId = await orgFor(req.userId);
  if (!organizationId) return res.status(403).json({ error: 'No organization' });
  const result = await query('SELECT * FROM instagram_publications WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [organizationId, Math.min(Number(req.query.limit) || 50, 200), Math.max(Number(req.query.offset) || 0, 0)]);
  return res.json(result.rows);
});

export default router;
