import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { logError } from '../logger.js';

const router = express.Router();

// Every organization the user belongs to -- a survey's results must be
// reachable regardless of which org getUserOrg-style logic elsewhere would
// have guessed as "primary" for a user who's a member of more than one.
async function getUserOrgIds(userId) {
  const result = await query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => r.organization_id);
}

router.get('/:id/stats', authenticate, async (req, res) => {
  try {
    const orgIds = await getUserOrgIds(req.userId);
    if (orgIds.length === 0) return res.status(403).json({ error: 'No organization' });

    const submissions = await query(
      `SELECT s.*,
        COALESCE(
          (SELECT json_agg(json_build_object('name', r.name, 'phone', r.phone) ORDER BY r.created_at)
           FROM external_form_referrals r WHERE r.submission_id = s.id),
          '[]'::json
        ) as referrals
       FROM external_form_submissions s
       WHERE s.form_id = $1 AND s.organization_id = ANY($2)
       ORDER BY s.created_at DESC`,
      [req.params.id, orgIds]
    );

    res.json(submissions.rows);
  } catch (error) {
    logError('Error fetching survey stats:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
