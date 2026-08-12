import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { logInfo, logError } from '../logger.js';

const router = express.Router();
router.use(authenticate);

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

// Get Supervisor Stats
router.get('/stats', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    // Check module permission
    const orgData = await query('SELECT modules_enabled FROM organizations WHERE id = $1', [org.organization_id]);
    const modules = orgData.rows[0]?.modules_enabled || {};
    if (!modules.supervisor) {
      return res.status(403).json({ error: 'Supervisor module not enabled for this organization' });
    }

    const { period, sellerId, teamId, tag, channel, funnelId, status } = req.query;

    const settingsResult = await query(
      `SELECT monitored_funnels FROM supervisor_settings WHERE organization_id = $1`,
      [org.organization_id]
    );
    let monitoredFunnels = settingsResult.rows[0]?.monitored_funnels;

    // Ensure it's treated as null/empty if not a valid array
    if (monitoredFunnels && !Array.isArray(monitoredFunnels)) {
      monitoredFunnels = null;
    }

    let whereClause = `WHERE d.organization_id = $1`;
    const params = [org.organization_id];

    if (sellerId) {
      params.push(sellerId);
      whereClause += ` AND d.owner_id = $${params.length}`;
    }

    if (funnelId && funnelId !== 'all') {
      params.push(funnelId);
      whereClause += ` AND d.funnel_id = $${params.length}`;
    } else if (monitoredFunnels && Array.isArray(monitoredFunnels) && monitoredFunnels.length > 0) {
      params.push(monitoredFunnels);
      whereClause += ` AND d.funnel_id = ANY($${params.length})`;
    }

    if (status) {
      params.push(status);
      whereClause += ` AND d.status = $${params.length}`;
    }
    // Add more filters as needed

    const statsQuery = `
      SELECT 
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE d.status = 'open' AND d.first_seller_message_at IS NULL) as leads_novos,
        COUNT(*) FILTER (WHERE d.status = 'open' AND d.first_seller_message_at IS NULL AND d.created_at < NOW() - INTERVAL '30 minutes') as leads_sem_abordagem,
        COUNT(*) FILTER (WHERE d.status = 'open' AND d.last_customer_message_at > d.last_seller_message_at) as leads_sem_resposta,
        COUNT(*) FILTER (WHERE d.status = 'open') as leads_em_atendimento,
        COUNT(*) FILTER (WHERE d.status = 'won') as leads_convertidos,
        COUNT(*) FILTER (WHERE d.status = 'lost') as leads_perdidos,
        COUNT(*) FILTER (WHERE d.status = 'lost' AND d.lost_at < NOW() - INTERVAL '30 days') as leads_reativacao,
        COUNT(*) FILTER (WHERE d.status = 'open' AND (d.next_followup_at < NOW() OR d.next_followup_at IS NULL)) as leads_followup_pendente,
        COUNT(*) FILTER (WHERE d.status = 'open' AND d.proposal_sent_at IS NULL) as leads_aguardando_proposta,
        COUNT(*) FILTER (WHERE d.status = 'open' AND d.payment_pending_at IS NOT NULL) as leads_aguardando_pagamento
      FROM crm_deals d
      ${whereClause}
    `;

    const result = await query(statsQuery, params);
    res.json(result.rows[0]);
  } catch (error) {
    logError('Error fetching supervisor stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Semaphore Data
router.get('/semaphore', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    // Fetch settings for SLAs
    const settingsResult = await query(
      `SELECT * FROM supervisor_settings WHERE organization_id = $1`,
      [org.organization_id]
    );
    const settings = settingsResult.rows[0] || {
      new_lead_sla_minutes: 30,
      no_followup_sla_hours: 24,
      no_response_sla_days: 2,
      monitored_funnels: null
    };

    let monitoredFunnelsClause = '';
    const semaphoreParams = [org.organization_id];
    
    // Check if settings.monitored_funnels is a non-empty array
    if (settings.monitored_funnels && Array.isArray(settings.monitored_funnels) && settings.monitored_funnels.length > 0) {
      monitoredFunnelsClause = ` AND funnel_id = ANY($2)`;
      semaphoreParams.push(settings.monitored_funnels);
    }

    const semaphoreQuery = `
      WITH monitored_deals AS (
        SELECT 
          id, title, owner_id, status, created_at, last_seller_message_at, last_customer_message_at, first_seller_message_at, next_followup_at, proposal_sent_at, payment_pending_at,
          CASE 
            WHEN status != 'open' THEN 'GREEN'
            WHEN first_seller_message_at IS NULL AND created_at < NOW() - INTERVAL '${settings.new_lead_sla_minutes} minutes' THEN 'RED'
            WHEN next_followup_at < NOW() - INTERVAL '1 hour' THEN 'RED'
            WHEN last_customer_message_at > last_seller_message_at AND last_customer_message_at < NOW() - INTERVAL '${settings.no_response_sla_days} days' THEN 'RED'
            WHEN payment_pending_at IS NOT NULL AND payment_pending_at < NOW() - INTERVAL '${settings.payment_sla_days} days' THEN 'RED'
            WHEN first_seller_message_at IS NULL AND created_at < NOW() - INTERVAL '${settings.new_lead_sla_minutes / 2} minutes' THEN 'YELLOW'
            WHEN next_followup_at BETWEEN NOW() AND NOW() + INTERVAL '2 hours' THEN 'YELLOW'
            WHEN COALESCE(last_seller_message_at, created_at) < NOW() - INTERVAL '12 hours' THEN 'YELLOW'
            WHEN proposal_sent_at IS NULL AND created_at < NOW() - INTERVAL '${settings.proposal_sla_hours} hours' AND status = 'open' THEN 'YELLOW'
            ELSE 'GREEN'
          END as semaphore_color
        FROM crm_deals
        WHERE organization_id = $1 AND status = 'open'${monitoredFunnelsClause}
      ),
      monitored_convs AS (
        SELECT 
          id, contact_name as title, assigned_to as owner_id, 'open' as status, created_at, last_seller_message_at, last_customer_message_at, last_seller_message_at as first_seller_message_at, NULL::timestamp as next_followup_at, NULL::timestamp as proposal_sent_at, NULL::timestamp as payment_pending_at,
          CASE 
            WHEN last_seller_message_at IS NULL AND created_at < NOW() - INTERVAL '${settings.new_lead_sla_minutes} minutes' THEN 'RED'
            WHEN last_customer_message_at > last_seller_message_at AND last_customer_message_at < NOW() - INTERVAL '${settings.no_response_sla_days} days' THEN 'RED'
            WHEN last_seller_message_at IS NULL AND created_at < NOW() - INTERVAL '${settings.new_lead_sla_minutes / 2} minutes' THEN 'YELLOW'
            WHEN COALESCE(last_seller_message_at, created_at) < NOW() - INTERVAL '24 hours' THEN 'YELLOW'
            ELSE 'GREEN'
          END as semaphore_color
        FROM conversations
        WHERE organization_id = $1 
          AND is_archived = false 
          AND tags && $2
          AND NOT EXISTS (
            SELECT 1 FROM crm_deals d 
            WHERE d.organization_id = $1 
              AND (d.contact_phone = conversations.contact_phone OR d.remote_jid = conversations.remote_jid)
          )

      )
      SELECT * FROM monitored_deals
      UNION ALL
      SELECT * FROM monitored_convs
    `;

    // Adjust params for tags if needed
    const finalParams = [...semaphoreParams];
    if (!finalParams[1] && settings.monitored_tags) {
       // if monitoredFunnels wasn't added as $2, but we need tags
       // but the query above uses $2 for tags. 
       // Let's normalize params.
    }
    
    // Simpler: just ensure tags are always there if monitored_tags exists
    const monitoredTags = settings.monitored_tags || [];
    const queryParams = [org.organization_id, monitoredTags];
    if (monitoredFunnelsClause) queryParams.push(settings.monitored_funnels);

    // Update query to use correct param indexes
    const finalQuery = semaphoreQuery.replace(/\$2/g, monitoredFunnelsClause ? '$3' : '$2').replace(/tags && \$2/g, 'tags && $2');

    const result = await query(finalQuery, queryParams);
    
    const summary = {
      GREEN: Array.isArray(result.rows) ? result.rows.filter(r => r.semaphore_color === 'GREEN').length : 0,
      YELLOW: Array.isArray(result.rows) ? result.rows.filter(r => r.semaphore_color === 'YELLOW').length : 0,
      RED: Array.isArray(result.rows) ? result.rows.filter(r => r.semaphore_color === 'RED').length : 0,
      leads: Array.isArray(result.rows) ? result.rows : []
    };



    res.json(summary);
  } catch (error) {
    logError('Error fetching semaphore data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Preview Settings (Calculate semaphore with hypothetical settings)
router.post('/preview-settings', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const settings = {
      new_lead_sla_minutes: req.body.new_lead_sla_minutes || 30,
      no_followup_sla_hours: req.body.no_followup_sla_hours || 24,
      no_response_sla_days: req.body.no_response_sla_days || 2,
      proposal_sla_hours: req.body.proposal_sla_hours || 4,
      payment_sla_days: req.body.payment_sla_days || 3
    };

    const semaphoreQuery = `
      SELECT 
        CASE 
          WHEN status != 'open' THEN 'GREEN'
          WHEN first_seller_message_at IS NULL AND created_at < NOW() - INTERVAL '${settings.new_lead_sla_minutes} minutes' THEN 'RED'
          WHEN next_followup_at < NOW() - INTERVAL '1 hour' THEN 'RED'
          WHEN last_customer_message_at > last_seller_message_at AND last_customer_message_at < NOW() - INTERVAL '${settings.no_response_sla_days} days' THEN 'RED'
          WHEN payment_pending_at IS NOT NULL AND payment_pending_at < NOW() - INTERVAL '${settings.payment_sla_days} days' THEN 'RED'
          WHEN first_seller_message_at IS NULL AND created_at < NOW() - INTERVAL '${settings.new_lead_sla_minutes / 2} minutes' THEN 'YELLOW'
          WHEN next_followup_at BETWEEN NOW() AND NOW() + INTERVAL '2 hours' THEN 'YELLOW'
          WHEN COALESCE(last_seller_message_at, created_at) < NOW() - INTERVAL '12 hours' THEN 'YELLOW'
          WHEN proposal_sent_at IS NULL AND created_at < NOW() - INTERVAL '${settings.proposal_sla_hours} hours' AND status = 'open' THEN 'YELLOW'
          ELSE 'GREEN'
        END as semaphore_color
      FROM crm_deals
      WHERE organization_id = $1 AND status = 'open'
    `;


    const result = await query(semaphoreQuery, [org.organization_id]);
    
    const summary = {
      GREEN: Array.isArray(result.rows) ? result.rows.filter(r => r.semaphore_color === 'GREEN').length : 0,
      YELLOW: Array.isArray(result.rows) ? result.rows.filter(r => r.semaphore_color === 'YELLOW').length : 0,
      RED: Array.isArray(result.rows) ? result.rows.filter(r => r.semaphore_color === 'RED').length : 0
    };


    res.json(summary);
  } catch (error) {
    logError('Error previewing supervisor settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Seller Performance
router.get('/sellers', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    // Check if user has supervisor role
    if (org.role !== 'owner' && org.role !== 'admin' && org.role !== 'supervisor') {
      return res.status(403).json({ error: 'Only owners, admins or supervisors can view performance' });
    }

    const sellerQuery = `
      SELECT 
        u.id, u.name,
        COUNT(d.id) as total_leads,
        COUNT(d.id) FILTER (WHERE d.status = 'won') as conversions,
        COUNT(d.id) FILTER (WHERE d.first_seller_message_at IS NULL AND d.status = 'open') as no_approach,
        AVG(EXTRACT(EPOCH FROM (COALESCE(d.first_seller_message_at, d.last_activity_at) - d.created_at))) as avg_response_time,
        (COUNT(d.id) FILTER (WHERE d.status = 'won')::float / NULLIF(COUNT(d.id), 0)) * 100 as conversion_rate,
        om.role as org_role,
        (SELECT json_agg(cm.connection_id) FROM connection_members cm WHERE cm.user_id = u.id) as connections
      FROM users u
      JOIN organization_members om ON om.user_id = u.id
      LEFT JOIN crm_deals d ON d.owner_id = u.id AND d.organization_id = $1
      WHERE om.organization_id = $1 AND (om.role = 'agent' OR om.role = 'manager' OR om.role = 'supervisor')
      GROUP BY u.id, u.name, om.role
      ORDER BY conversion_rate DESC NULLS LAST
    `;

    const result = await query(sellerQuery, [org.organization_id]);
    res.json(Array.isArray(result.rows) ? result.rows : []);
  } catch (error) {
    logError('Error fetching seller performance:', error);
    res.status(500).json({ error: error.message });
  }

});

// Get Audits
router.get('/audits', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const result = await query(
      `SELECT a.*, 
              COALESCE(d.title, conv.contact_name, 'Contato sem nome') as lead_name, 
              u.name as seller_name
       FROM supervisor_audits a
       LEFT JOIN crm_deals d ON d.id = a.deal_id
       LEFT JOIN conversations conv ON conv.id = a.conversation_id
       LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.organization_id = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [org.organization_id]
    );
    res.json(Array.isArray(result.rows) ? result.rows : []);
  } catch (error) {
    logError('Error fetching audits:', error);
    res.status(500).json({ error: error.message });
  }

});


// Settings CRUD

router.get('/settings', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    const result = await query(`SELECT * FROM supervisor_settings WHERE organization_id = $1`, [org.organization_id]);
    res.json(result.rows[0] || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    const { 
      new_lead_sla_minutes, no_followup_sla_hours, no_response_sla_days,
      reactivation_days, proposal_sla_hours, payment_sla_days, monitored_funnels, monitored_tags 
    } = req.body;

    const result = await query(
      `INSERT INTO supervisor_settings (
        organization_id, new_lead_sla_minutes, no_followup_sla_hours, no_response_sla_days,
        reactivation_days, proposal_sla_hours, payment_sla_days, monitored_funnels, monitored_tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (organization_id) DO UPDATE SET
        new_lead_sla_minutes = EXCLUDED.new_lead_sla_minutes,
        no_followup_sla_hours = EXCLUDED.no_followup_sla_hours,
        no_response_sla_days = EXCLUDED.no_response_sla_days,
        reactivation_days = EXCLUDED.reactivation_days,
        proposal_sla_hours = EXCLUDED.proposal_sla_hours,
        payment_sla_days = EXCLUDED.payment_sla_days,
        monitored_funnels = EXCLUDED.monitored_funnels,
        monitored_tags = EXCLUDED.monitored_tags,
        updated_at = NOW()
      RETURNING *`,
      [org.organization_id, new_lead_sla_minutes, no_followup_sla_hours, no_response_sla_days, reactivation_days, proposal_sla_hours, payment_sla_days, monitored_funnels, monitored_tags]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Get Teams
router.get('/teams', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const result = await query(
      `SELECT id, name FROM crm_user_groups WHERE organization_id = $1 ORDER BY name`,
      [org.organization_id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Charge
router.post('/charge', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const { type, targetId, notes } = req.body;
    
    if (type === 'individual') {
      await query(
        `INSERT INTO supervisor_charges (organization_id, target_user_id, charged_by, type, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.organization_id, targetId, req.userId, type, notes]
      );
      
      // Update deadlines for this seller's deals that are in RED or YELLOW
      // We'll give them 4 more hours for follow-up as a "reset" after being charged
      await query(
        `UPDATE crm_deals 
         SET next_followup_at = NOW() + INTERVAL '4 hours', updated_at = NOW()
         WHERE organization_id = $1 AND owner_id = $2 AND status = 'open'`,
        [org.organization_id, targetId]
      );

    } else if (type === 'team') {
      await query(
        `INSERT INTO supervisor_charges (organization_id, target_team_id, charged_by, type, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.organization_id, targetId, req.userId, type, notes]
      );

      // Update deadlines for all deals in this team
      await query(
        `UPDATE crm_deals 
         SET next_followup_at = NOW() + INTERVAL '4 hours', updated_at = NOW()
         WHERE organization_id = $1 AND group_id = $2 AND status = 'open'`,
        [org.organization_id, targetId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    logError('Error creating supervisor charge:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Charges History
router.get('/charges', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const result = await query(
      `SELECT 
        c.*, 
        u.name as target_user_name,
        g.name as target_team_name,
        cb.name as charged_by_name
       FROM supervisor_charges c
       LEFT JOIN users u ON u.id = c.target_user_id
       LEFT JOIN crm_user_groups g ON g.id = c.target_team_id
       LEFT JOIN users cb ON cb.id = c.charged_by
       WHERE c.organization_id = $1
       ORDER BY c.created_at DESC
       LIMIT 100`,
      [org.organization_id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Monitored Sellers — dedicated supervisor mapping (decoupled from organization_members)
// ============================================================

function canManageSupervisor(role, isSuperadmin) {
  if (isSuperadmin) return true;
  return ['owner', 'admin', 'supervisor', 'manager'].includes(role);
}

async function getUserOrgWithFlags(userId) {
  const result = await query(
    `SELECT om.organization_id, om.role, u.is_superadmin
     FROM organization_members om
     JOIN users u ON u.id = om.user_id
     WHERE om.user_id = $1
     LIMIT 1`,
    [userId]
  );
  return result.rows[0];
}

// List monitored sellers for the org
router.get('/monitored-sellers', async (req, res) => {
  try {
    const ctx = await getUserOrgWithFlags(req.userId);
    if (!ctx) return res.status(403).json({ error: 'No organization' });

    const result = await query(
      `SELECT ms.id, ms.user_id, ms.connection_ids, ms.funnel_ids,
              u.name, u.email, om.role
       FROM supervisor_monitored_sellers ms
       JOIN users u ON u.id = ms.user_id
       LEFT JOIN organization_members om ON om.user_id = ms.user_id AND om.organization_id = ms.organization_id
       WHERE ms.organization_id = $1
       ORDER BY u.name`,
      [ctx.organization_id]
    );

    // Frontend expects "connections" + "monitored_funnels" fields too — provide both for compatibility
    const rows = result.rows.map(r => ({
      ...r,
      connections: r.connection_ids || [],
      monitored_funnels: r.funnel_ids || [],
    }));
    res.json(rows);
  } catch (error) {
    logError('Error listing monitored sellers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add or update a monitored seller
router.post('/monitored-sellers', async (req, res) => {
  try {
    const ctx = await getUserOrgWithFlags(req.userId);
    if (!ctx) return res.status(403).json({ error: 'No organization' });
    if (!canManageSupervisor(ctx.role, ctx.is_superadmin)) {
      return res.status(403).json({ error: 'Sem permissão para configurar o Supervisor IA' });
    }

    const { user_id, connection_ids = [], funnel_ids = [], monitored_funnels } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id é obrigatório' });

    // Confirm target user belongs to the same org
    const target = await query(
      `SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [ctx.organization_id, user_id]
    );
    if (target.rows.length === 0) {
      return res.status(400).json({ error: 'Usuário não pertence a esta organização' });
    }

    const funnels = funnel_ids?.length ? funnel_ids : (monitored_funnels || []);

    const result = await query(
      `INSERT INTO supervisor_monitored_sellers (organization_id, user_id, connection_ids, funnel_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET
         connection_ids = EXCLUDED.connection_ids,
         funnel_ids = EXCLUDED.funnel_ids,
         updated_at = NOW()
       RETURNING *`,
      [ctx.organization_id, user_id, connection_ids, funnels]
    );
    res.json(result.rows[0]);
  } catch (error) {
    logError('Error upserting monitored seller:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update by user_id (PATCH semantics)
router.patch('/monitored-sellers/:userId', async (req, res) => {
  try {
    const ctx = await getUserOrgWithFlags(req.userId);
    if (!ctx) return res.status(403).json({ error: 'No organization' });
    if (!canManageSupervisor(ctx.role, ctx.is_superadmin)) {
      return res.status(403).json({ error: 'Sem permissão para configurar o Supervisor IA' });
    }

    const { userId } = req.params;
    const { connection_ids = [], funnel_ids = [], monitored_funnels } = req.body;
    const funnels = funnel_ids?.length ? funnel_ids : (monitored_funnels || []);

    const result = await query(
      `INSERT INTO supervisor_monitored_sellers (organization_id, user_id, connection_ids, funnel_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET
         connection_ids = EXCLUDED.connection_ids,
         funnel_ids = EXCLUDED.funnel_ids,
         updated_at = NOW()
       RETURNING *`,
      [ctx.organization_id, userId, connection_ids, funnels]
    );
    res.json(result.rows[0]);
  } catch (error) {
    logError('Error updating monitored seller:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove monitored seller
router.delete('/monitored-sellers/:userId', async (req, res) => {
  try {
    const ctx = await getUserOrgWithFlags(req.userId);
    if (!ctx) return res.status(403).json({ error: 'No organization' });
    if (!canManageSupervisor(ctx.role, ctx.is_superadmin)) {
      return res.status(403).json({ error: 'Sem permissão para configurar o Supervisor IA' });
    }
    const { userId } = req.params;
    await query(
      `DELETE FROM supervisor_monitored_sellers WHERE organization_id = $1 AND user_id = $2`,
      [ctx.organization_id, userId]
    );
    res.json({ success: true });
  } catch (error) {
    logError('Error deleting monitored seller:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/supervisor/run-audit - manually trigger an audit for the org
router.post('/run-audit', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });

    const userRow = await query('SELECT is_superadmin FROM users WHERE id = $1', [req.userId]);
    const isSuperadmin = userRow.rows[0]?.is_superadmin === true;
    const allowedRoles = ['owner', 'admin', 'administrator', 'supervisor', 'manager', 'gerente'];
    if (!isSuperadmin && !allowedRoles.includes(String(org.role || '').toLowerCase())) {
      return res.status(403).json({ error: `Sem permissão para rodar análise manual (role atual: ${org.role || 'desconhecida'})` });
    }

    const orgData = await query('SELECT modules_enabled FROM organizations WHERE id = $1', [org.organization_id]);
    const modules = orgData.rows[0]?.modules_enabled || {};
    if (!modules.supervisor) {
      // Auto-enable for privileged users (owner/admin/superadmin) so they don't need
      // to flip a toggle in another screen before running their first audit.
      const canAutoEnable = isSuperadmin || ['owner', 'admin', 'administrator'].includes(String(org.role || '').toLowerCase());
      if (!canAutoEnable) {
        return res.status(403).json({ error: 'Módulo Supervisor IA não está ativado. Peça a um administrador para ativá-lo em Configurações > Módulos.' });
      }
      const newModules = { ...modules, supervisor: true };
      await query('UPDATE organizations SET modules_enabled = $1 WHERE id = $2', [JSON.stringify(newModules), org.organization_id]);
      logInfo('[Supervisor] Auto-enabled supervisor module', { orgId: org.organization_id, userId: req.userId });
    }

    const settings = await query('SELECT 1 FROM supervisor_settings WHERE organization_id = $1', [org.organization_id]);
    if (settings.rows.length === 0) {
      return res.status(400).json({ error: 'Configure os parâmetros do Supervisor (SLA) antes de rodar a análise.' });
    }

    const { executeDailyAudit } = await import('../supervisor-audit-scheduler.js');
    const result = await executeDailyAudit(org.organization_id);
    logInfo('[Supervisor] Manual audit triggered', { userId: req.userId, orgId: org.organization_id, ...result });
    res.json({ success: true, ...result });
  } catch (error) {
    logError('Error running manual supervisor audit:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
