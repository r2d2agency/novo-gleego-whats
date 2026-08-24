import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { logError } from '../logger.js';

const router = express.Router();

async function getUserOrg(userId) {
  const result = await query(
    `SELECT om.organization_id FROM organization_members om WHERE om.user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0];
}

router.get('/:id/stats', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const submissions = await query(
      `SELECT * FROM external_form_submissions 
       WHERE form_id = $1 AND organization_id = $2 
       ORDER BY created_at DESC`,
      [req.params.id, org.organization_id]
    );

    res.json(submissions.rows);
  } catch (error) {
    logError('Error fetching survey stats:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;