import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { generateMeetingMinutes } from '../lib/group-secretary.js';
import { executeSecretaryDigest } from '../secretary-digest-scheduler.js';
import { getSecretaryEvents, clearSecretaryEvents } from '../lib/group-secretary-diagnostic.js';

const router = Router();
router.use(authenticate);

// Helper: Get user's organization and permissions
async function getUserOrgWithFlags(userId) {
  const result = await query(
    `SELECT om.organization_id, om.role, u.is_superadmin 
     FROM organization_members om 
     JOIN users u ON u.id = om.user_id
     WHERE om.user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

// Backwards-compatible alias used by various endpoints below
const getUserOrg = getUserOrgWithFlags;

function canManageSecretary(role, isSuperadmin) {
  if (isSuperadmin) return true;
  return ['owner', 'admin', 'supervisor', 'manager'].includes(role);
}

// ==========================================
// CONFIGURATION
// ==========================================

// Get secretary config
router.get('/config', async (req, res) => {
  try {
    const org = await getUserOrgWithFlags(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });

    const result = await query(
      `SELECT * FROM group_secretary_config WHERE organization_id = $1`,
      [org.organization_id]
    );

    if (result.rows.length === 0) {
      return res.json({
        is_active: false,
        connection_ids: null,
        group_jids: null,
        create_crm_task: true,
        show_popup_alert: true,
        min_confidence: 0.6,
        ai_provider: null,
        ai_model: null,
      });
    }

    const config = result.rows[0];
    // Mask API key
    if (config.ai_api_key) {
      config.ai_api_key = '••••••••' + config.ai_api_key.slice(-4);
    }
    res.json(config);
  } catch (error) {
    console.error('Get secretary config error:', error);
    res.status(500).json({ error: 'Erro ao buscar configuração' });
  }
});

// Save/update secretary config
router.put('/config', async (req, res) => {
  try {
    const org = await getUserOrgWithFlags(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    if (!canManageSecretary(org.role, org.is_superadmin)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const {
      is_active, connection_ids, group_jids,
      create_crm_task, show_popup_alert, min_confidence,
      ai_provider, ai_model, ai_api_key,
      notify_external_enabled, notify_external_phone,
      notify_members_whatsapp, default_connection_id,
      followup_enabled, followup_hours,
      daily_digest_enabled, daily_digest_hour, daily_digest_minute,
      individual_notifications_enabled,
      auto_reply_enabled, auto_reply_message,
      excluded_senders,
    } = req.body;

    // Handle masked API key
    let actualApiKey = ai_api_key;
    if (ai_api_key && ai_api_key.startsWith('••')) {
      const existing = await query(
        `SELECT ai_api_key FROM group_secretary_config WHERE organization_id = $1`,
        [org.organization_id]
      );
      actualApiKey = existing.rows[0]?.ai_api_key || null;
    }

    const result = await query(
      `INSERT INTO group_secretary_config 
       (organization_id, is_active, connection_ids, group_jids, create_crm_task, show_popup_alert, min_confidence, ai_provider, ai_model, ai_api_key, notify_external_enabled, notify_external_phone, notify_members_whatsapp, default_connection_id, followup_enabled, followup_hours, daily_digest_enabled, daily_digest_hour, daily_digest_minute, individual_notifications_enabled, auto_reply_enabled, auto_reply_message, excluded_senders)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       ON CONFLICT (organization_id) DO UPDATE SET
         is_active = EXCLUDED.is_active,
         connection_ids = EXCLUDED.connection_ids,
         group_jids = EXCLUDED.group_jids,
         create_crm_task = EXCLUDED.create_crm_task,
         show_popup_alert = EXCLUDED.show_popup_alert,
         min_confidence = EXCLUDED.min_confidence,
         ai_provider = EXCLUDED.ai_provider,
         ai_model = EXCLUDED.ai_model,
         ai_api_key = EXCLUDED.ai_api_key,
         notify_external_enabled = EXCLUDED.notify_external_enabled,
         notify_external_phone = EXCLUDED.notify_external_phone,
         notify_members_whatsapp = EXCLUDED.notify_members_whatsapp,
         default_connection_id = EXCLUDED.default_connection_id,
         followup_enabled = EXCLUDED.followup_enabled,
         followup_hours = EXCLUDED.followup_hours,
         daily_digest_enabled = EXCLUDED.daily_digest_enabled,
         daily_digest_hour = EXCLUDED.daily_digest_hour,
         daily_digest_minute = EXCLUDED.daily_digest_minute,
         individual_notifications_enabled = EXCLUDED.individual_notifications_enabled,
         auto_reply_enabled = EXCLUDED.auto_reply_enabled,
         auto_reply_message = EXCLUDED.auto_reply_message,
         excluded_senders = EXCLUDED.excluded_senders,
         updated_at = NOW()
       RETURNING *`,
      [
        org.organization_id, is_active ?? true,
        connection_ids || null, group_jids || null,
        create_crm_task ?? true, show_popup_alert ?? true,
        min_confidence ?? 0.6,
        ai_provider || null, ai_model || null, actualApiKey || null,
        notify_external_enabled ?? false, notify_external_phone || null,
        notify_members_whatsapp ?? false, default_connection_id || null,
        followup_enabled ?? false, followup_hours ?? 4,
        daily_digest_enabled ?? false, daily_digest_hour ?? 8, daily_digest_minute ?? 0,
        individual_notifications_enabled ?? true,
        auto_reply_enabled ?? false, auto_reply_message || null,
        excluded_senders || '{}',
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Save secretary config error:', error);
    res.status(500).json({ error: 'Erro ao salvar configuração' });
  }
});

// ==========================================
// MEMBERS (aliases/roles mapping)
// ==========================================

// List members with aliases
router.get('/members', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });

    const result = await query(
      `SELECT gsm.*, u.name as user_name, u.email, u.whatsapp_phone
       FROM group_secretary_members gsm
       JOIN users u ON u.id = gsm.user_id
       WHERE gsm.organization_id = $1
       ORDER BY u.name`,
      [org.organization_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('List secretary members error:', error);
    res.status(500).json({ error: 'Erro ao buscar membros' });
  }
});

// Add/update member
router.post('/members', async (req, res) => {
  try {
    const org = await getUserOrgWithFlags(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    if (!canManageSecretary(org.role, org.is_superadmin)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { user_id, aliases, role_description, departments } = req.body;

    if (!user_id) return res.status(400).json({ error: 'user_id é obrigatório' });

    const result = await query(
      `INSERT INTO group_secretary_members (organization_id, user_id, aliases, role_description, departments)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET
         aliases = EXCLUDED.aliases,
         role_description = EXCLUDED.role_description,
         departments = EXCLUDED.departments,
         updated_at = NOW()
       RETURNING *`,
      [org.organization_id, user_id, aliases || '{}', role_description || null, departments || '{}']
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Add secretary member error:', error);
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

// Remove member
router.delete('/members/:memberId', async (req, res) => {
  try {
    const org = await getUserOrgWithFlags(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    if (!canManageSecretary(org.role, org.is_superadmin)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    await query(
      `DELETE FROM group_secretary_members WHERE id = $1 AND organization_id = $2`,
      [req.params.memberId, org.organization_id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Remove secretary member error:', error);
    res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

// ==========================================
// LOGS
// ==========================================

// Get detection logs
router.get('/logs', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const result = await query(
      `SELECT gsl.*, conv.group_name, conv.remote_jid
       FROM group_secretary_logs gsl
       LEFT JOIN conversations conv ON conv.id = gsl.conversation_id
       WHERE gsl.organization_id = $1
       ORDER BY gsl.created_at DESC
       LIMIT $2`,
      [org.organization_id, limit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get secretary logs error:', error);
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
});

// Get available team members (for adding to secretary)
router.get('/available-users', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });

    const result = await query(
      `SELECT u.id, u.name, u.email, om.role
       FROM users u
       JOIN organization_members om ON om.user_id = u.id
       WHERE om.organization_id = $1
       ORDER BY u.name`,
      [org.organization_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get available users error:', error);
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
});

// Get monitored groups (conversations that are groups)
router.get('/groups', async (req, res) => {
  try {
    // Aggregate across ALL organizations the user belongs to.
    // Some users manage multiple orgs; a LIMIT 1 lookup would silently hide
    // groups belonging to the "other" org even when the secretary is
    // configured there.
    const orgsRes = await query(
      `SELECT organization_id FROM organization_members WHERE user_id = $1`,
      [req.userId]
    );
    const orgIds = orgsRes.rows.map((r) => r.organization_id);
    if (orgIds.length === 0) return res.status(403).json({ error: 'Sem organização' });

    // Aceita tanto is_group=true quanto remote_jid terminando com @g.us
    // (em alguns providers o flag não é populado corretamente).
    const result = await query(
      `SELECT conv.id,
              conv.remote_jid,
              COALESCE(NULLIF(conv.group_name, ''), conv.contact_name, conv.remote_jid) AS group_name,
              conv.connection_id,
              conn.name AS connection_name
         FROM conversations conv
         JOIN connections conn ON conn.id = conv.connection_id
        WHERE conn.organization_id = ANY($1::uuid[])
          AND (
               COALESCE(conv.is_group, false) = true
               OR conv.remote_jid LIKE '%@g.us'
              )
        ORDER BY connection_name, group_name`,
      [orgIds]
    );

    console.log(`[GroupSecretary] /groups orgs=${orgIds.join(',')} retornou ${result.rows.length} grupo(s)`);
    res.json(result.rows);
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Erro ao buscar grupos' });
  }
});

// Update a user's WhatsApp phone (for notification purposes)
router.put('/members/:userId/phone', async (req, res) => {
  try {
    const org = await getUserOrgWithFlags(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    if (!canManageSecretary(org.role, org.is_superadmin)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { whatsapp_phone } = req.body;
    const targetUserId = req.params.userId;

    // Verify user belongs to org
    const memberCheck = await query(
      `SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [org.organization_id, targetUserId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado na organização' });
    }

    await query(
      `UPDATE users SET whatsapp_phone = $1, updated_at = NOW() WHERE id = $2`,
      [whatsapp_phone || null, targetUserId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update member phone error:', error);
    res.status(500).json({ error: 'Erro ao atualizar telefone' });
  }
});

// ==========================================
// STATS (Dashboard de carga)
// ==========================================

router.get('/stats', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });

    const days = Math.min(parseInt(req.query.days) || 7, 90);

    // Per-member stats
    const memberStats = await query(`
      SELECT 
        gsl.matched_user_id,
        gsl.matched_user_name,
        COUNT(*) as total_requests,
        COUNT(CASE WHEN gsl.priority = 'urgent' THEN 1 END) as urgent_count,
        COUNT(CASE WHEN gsl.priority = 'high' THEN 1 END) as high_count,
        COUNT(CASE WHEN gsl.sentiment IN ('negative', 'urgent_negative') THEN 1 END) as negative_count,
        ROUND(AVG(gsl.confidence)::numeric, 2) as avg_confidence
      FROM group_secretary_logs gsl
      WHERE gsl.organization_id = $1 
        AND gsl.created_at >= NOW() - INTERVAL '1 day' * $2
        AND gsl.matched_user_id IS NOT NULL
      GROUP BY gsl.matched_user_id, gsl.matched_user_name
      ORDER BY total_requests DESC
    `, [org.organization_id, days]);

    // Pending tasks from secretary
    const pendingTasks = await query(`
      SELECT 
        t.assigned_to,
        u.name as assigned_name,
        COUNT(*) as pending_count
      FROM crm_tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.organization_id = $1 
        AND t.source = 'group_secretary'
        AND t.status = 'pending'
      GROUP BY t.assigned_to, u.name
    `, [org.organization_id]);

    // Overall stats
    const overall = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN matched_user_id IS NOT NULL THEN 1 END) as matched,
        COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) as high,
        COUNT(CASE WHEN sentiment IN ('negative', 'urgent_negative') THEN 1 END) as negative,
        ROUND(AVG(processing_time_ms)::numeric, 0) as avg_processing_ms,
        ROUND(AVG(confidence)::numeric, 2) as avg_confidence
      FROM group_secretary_logs
      WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
    `, [org.organization_id, days]);

    // Daily breakdown
    const daily = await query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        COUNT(CASE WHEN priority IN ('urgent', 'high') THEN 1 END) as priority_count
      FROM group_secretary_logs
      WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [org.organization_id, days]);

    res.json({
      period_days: days,
      overall: overall.rows[0],
      members: memberStats.rows,
      pending_tasks: pendingTasks.rows,
      daily: daily.rows,
    });
  } catch (error) {
    console.error('Get secretary stats error:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// ==========================================
// MEETING MINUTES (Atas de Reunião)
// ==========================================

// Generate meeting minutes for a group
router.post('/meeting-minutes/generate', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });

    const { conversation_id, hours = 24 } = req.body;
    if (!conversation_id) return res.status(400).json({ error: 'conversation_id é obrigatório' });

    const result = await generateMeetingMinutes({
      organizationId: org.organization_id,
      conversationId: conversation_id,
      hours: Math.min(parseInt(hours) || 24, 168),
      generatedBy: req.userId,
    });

    res.json(result);
  } catch (error) {
    console.error('Generate meeting minutes error:', error);
    res.status(error.status || 500).json({ 
      error: error.message || 'Erro ao gerar ata de reunião' 
    });
  }
});

// List meeting minutes
router.get('/meeting-minutes', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });

    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const result = await query(
      `SELECT gsmm.*, u.name as generated_by_name
       FROM group_secretary_meeting_minutes gsmm
       LEFT JOIN users u ON u.id = gsmm.generated_by
       WHERE gsmm.organization_id = $1
       ORDER BY gsmm.created_at DESC
       LIMIT $2`,
      [org.organization_id, limit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('List meeting minutes error:', error);
    res.status(500).json({ error: 'Erro ao buscar atas' });
  }
});

// Delete a meeting minute
router.delete('/meeting-minutes/:id', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });

    await query(
      `DELETE FROM group_secretary_meeting_minutes WHERE id = $1 AND organization_id = $2`,
      [req.params.id, org.organization_id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Delete meeting minutes error:', error);
    res.status(500).json({ error: 'Erro ao excluir ata' });
  }
});

// Manually trigger the daily digest report for current org
router.post('/digest/send-now', async (req, res) => {
  try {
    const org = await getUserOrgWithFlags(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    if (!canManageSecretary(org.role, org.is_superadmin)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    const result = await executeSecretaryDigest({
      organizationId: org.organization_id,
      force: true,
    });
    if (!result || result.sent === 0) {
      const reasons = {
        no_config: 'Nenhuma configuração de relatório encontrada para sua organização.',
        no_external_phone: 'Configure um número externo para envio do relatório.',
        no_recipients: 'Configure um número externo ou cadastre responsáveis com WhatsApp para receber o relatório.',
        no_connected_connection: 'Nenhuma conexão WhatsApp ativa encontrada para enviar o relatório.',
      };
      const msg = reasons[result?.reason] || reasons[result?.error] || result?.error || 'Não foi possível enviar o relatório.';
      return res.status(400).json({ error: msg });
    }
    res.json({ success: true, sent: result.sent });
  } catch (error) {
    console.error('Manual digest error:', error);
    res.status(500).json({ error: error.message || 'Erro ao gerar relatório manual' });
  }
});

// Diagnostic events buffer (in-memory)
router.get('/diagnostic', async (req, res) => {
  try {
    const org = await getUserOrgWithFlags(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    const { provider, stage, limit } = req.query;
    const events = getSecretaryEvents({
      organizationId: org.organization_id,
      provider: provider || undefined,
      stage: stage || undefined,
      limit: limit ? parseInt(limit) : 200,
    });
    res.json({ events });
  } catch (error) {
    console.error('Get secretary diagnostic error:', error);
    res.status(500).json({ error: 'Erro ao buscar diagnóstico' });
  }
});

router.delete('/diagnostic', async (req, res) => {
  try {
    const org = await getUserOrgWithFlags(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    if (!canManageSecretary(org.role, org.is_superadmin)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    clearSecretaryEvents({ organizationId: org.organization_id });
    res.json({ cleared: true });
  } catch (error) {
    console.error('Clear secretary diagnostic error:', error);
    res.status(500).json({ error: 'Erro ao limpar diagnóstico' });
  }
});

export default router;
