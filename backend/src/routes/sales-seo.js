import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { callAI } from '../lib/ai-caller.js';
import { detectSalesSeoLead } from '../lib/sales-seo-service.js';

const router = Router();
router.use(authenticate);

// Helper to get user's organization
async function getUserOrganization(userId) {
  const result = await query(
    `SELECT om.organization_id, om.role 
     FROM organization_members om 
     WHERE om.user_id = $1 
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function getAIConfig(organizationId) {
  const agentResult = await query(
    `SELECT ai_provider, ai_model, ai_api_key
     FROM ai_agents
     WHERE organization_id = $1
       AND is_active = true
       AND ai_api_key IS NOT NULL
     LIMIT 1`,
    [organizationId]
  );

  if (agentResult.rows[0]) {
    return {
      provider: agentResult.rows[0].ai_provider || 'openai',
      model: agentResult.rows[0].ai_model || 'gpt-4o-mini',
      apiKey: agentResult.rows[0].ai_api_key,
    };
  }

  const orgResult = await query(
    `SELECT ai_provider, ai_model, ai_api_key
     FROM organizations
     WHERE id = $1`,
    [organizationId]
  );

  const org = orgResult.rows[0];
  if (!org?.ai_api_key || org.ai_provider === 'none') {
    return null;
  }

  return {
    provider: org.ai_provider || 'openai',
    model: org.ai_model || 'gpt-4o-mini',
    apiKey: org.ai_api_key,
  };
}

router.post('/import-retroactive', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Organização não encontrada' });
    const days = Math.min(Math.max(Number(req.body?.days || 7), 1), 30);

    const result = await query(
      `SELECT m.id, m.conversation_id, m.content, m.message_type, m.sender_name, m.sender_phone,
              c.connection_id, conv.contact_name, conv.contact_phone
       FROM chat_messages m
       JOIN conversations conv ON conv.id = m.conversation_id
       JOIN connections c ON c.id = conv.connection_id
       WHERE c.organization_id = $1
         AND m.from_me = false
         AND m.timestamp >= NOW() - make_interval(days => $2::int)
       ORDER BY m.timestamp ASC
       LIMIT 5000`,
      [org.organization_id, days]
    );

    let processed = 0;
    let matched = 0;
    const errors = [];
    for (const row of result.rows) {
      processed++;
      try {
        const before = await query(`SELECT COUNT(*)::int AS count FROM sales_seo_leads WHERE conversation_id = $1`, [row.conversation_id]);
        await detectSalesSeoLead(row.connection_id, row.conversation_id, {
          content: row.content,
          message_type: row.message_type,
          from_me: false,
          sender_name: row.sender_name || row.contact_name,
          sender_phone: row.sender_phone || row.contact_phone,
        }, true);
        const after = await query(`SELECT COUNT(*)::int AS count FROM sales_seo_leads WHERE conversation_id = $1`, [row.conversation_id]);
        if (Number(after.rows[0]?.count || 0) > Number(before.rows[0]?.count || 0)) matched++;
      } catch (error) {
        errors.push(error.message);
      }
    }

    res.json({ processed, matched, errors: errors.slice(0, 10), days });
  } catch (error) {
    console.error('Retroactive SEO import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// TRACKERS CRUD
// ==========================================

// List trackers
router.get('/trackers', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Organização não encontrada' });

    const result = await query(
      `SELECT * FROM sales_seo_trackers WHERE organization_id = $1 ORDER BY created_at DESC`,
      [org.organization_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List trackers error:', error);
    res.status(500).json({ error: 'Erro ao listar rastreadores', details: error.message });
  }
});

// Create tracker
router.post('/trackers', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Organização não encontrada' });

    const { name, phrase, connection_ids } = req.body;
    if (!name || !phrase) {
      return res.status(400).json({ error: 'Nome e frase são obrigatórios' });
    }

    const result = await query(
      `INSERT INTO sales_seo_trackers (organization_id, name, phrase, connection_ids)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [org.organization_id, name, phrase, connection_ids || []]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create tracker error:', error);
    res.status(500).json({ error: 'Erro ao criar rastreador', details: error.message });
  }
});

// Delete tracker
router.delete('/trackers/:id', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Organização não encontrada' });

    const { id } = req.params;
    await query(
      `DELETE FROM sales_seo_trackers WHERE id = $1 AND organization_id = $2`,
      [id, org.organization_id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Delete tracker error:', error);
    res.status(500).json({ error: 'Erro ao excluir rastreador', details: error.message });
  }
});

// ==========================================
// ANALYTICS & LEADS
// ==========================================

// Get analytics overview
router.get('/analytics', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Organização não encontrada' });

    // Auto-reclassificação: leads "Novos" (status=1) com mais de 48h sem engajamento
    // viram "Perda" (status=4). Garantia de que "Nova" sempre representa janela <=48h.
    await query(
      `UPDATE sales_seo_leads
       SET evolution_status = 4, updated_at = NOW()
       WHERE organization_id = $1
         AND evolution_status = 1
         AND created_at < NOW() - INTERVAL '48 hours'`,
      [org.organization_id]
    );

    const { start_date, end_date, tracker_id, connection_id } = req.query;

    let whereClause = 'l.organization_id = $1';
    const params = [org.organization_id];
    let paramIndex = 2;

    if (start_date) {
      whereClause += ` AND l.created_at >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      whereClause += ` AND l.created_at <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    if (tracker_id) {
      whereClause += ` AND l.tracker_id = $${paramIndex}`;
      params.push(tracker_id);
      paramIndex++;
    }
    if (connection_id) {
      whereClause += ` AND l.connection_id = $${paramIndex}`;
      params.push(connection_id);
      paramIndex++;
    }

    // Stats by status
    const statsResult = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE evolution_status = 1) as just_arrived,
        COUNT(*) FILTER (WHERE evolution_status = 2) as engaged,
        COUNT(*) FILTER (WHERE evolution_status = 3) as converted,
        COUNT(*) FILTER (WHERE evolution_status = 4) as lost
       FROM sales_seo_leads l
       WHERE ${whereClause}`,
      params
    );

    // Stats by day
    const dailyResult = await query(
      `SELECT 
        DATE(l.created_at) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE evolution_status = 1) as just_arrived,
        COUNT(*) FILTER (WHERE evolution_status = 2) as engaged,
        COUNT(*) FILTER (WHERE evolution_status = 3) as converted
       FROM sales_seo_leads l
       WHERE ${whereClause}
       GROUP BY DATE(l.created_at)
       ORDER BY date ASC`,
      params
    );

    // Stats by hour
    const hourlyResult = await query(
      `SELECT 
        EXTRACT(HOUR FROM l.created_at) as hour,
        COUNT(*) as total
       FROM sales_seo_leads l
       WHERE ${whereClause}
       GROUP BY hour
       ORDER BY hour ASC`,
      params
    );

    // Stats by Month
    const monthlyResult = await query(
      `SELECT 
        TO_CHAR(l.created_at, 'YYYY-MM') as month,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE evolution_status >= 2) as attended
       FROM sales_seo_leads l
       WHERE l.organization_id = $1
       GROUP BY month
       ORDER BY month ASC
       LIMIT 12`,
      [org.organization_id]
    );

    res.json({
      stats: statsResult.rows[0],
      daily: dailyResult.rows,
      hourly: hourlyResult.rows,
      monthly: monthlyResult.rows
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Erro ao buscar analíticos', details: error.message });
  }
});

// List leads
router.get('/leads', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Organização não encontrada' });

    // Self-healing: garante coluna ia_analyzed_at
    await query(`ALTER TABLE sales_seo_leads ADD COLUMN IF NOT EXISTS ia_analyzed_at TIMESTAMPTZ`);

    // Mesma regra das analytics: leads >48h sem engajamento deixam de ser "Nova".
    await query(
      `UPDATE sales_seo_leads
       SET evolution_status = 4, updated_at = NOW()
       WHERE organization_id = $1
         AND evolution_status = 1
         AND created_at < NOW() - INTERVAL '48 hours'`,
      [org.organization_id]
    );

    const { tracker_id, start_date, end_date, limit = 50 } = req.query;

    let whereClause = 'l.organization_id = $1';
    const params = [org.organization_id];
    let paramIndex = 2;

    if (tracker_id) {
      whereClause += ` AND l.tracker_id = $${paramIndex}`;
      params.push(tracker_id);
      paramIndex++;
    }
    if (start_date) {
      whereClause += ` AND l.created_at >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      whereClause += ` AND l.created_at <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    params.push(parseInt(limit));

    const result = await query(
      `SELECT 
        l.*,
        t.name as tracker_name,
        c.name as connection_name,
        conv.contact_name
       FROM sales_seo_leads l
       LEFT JOIN sales_seo_trackers t ON t.id = l.tracker_id
       LEFT JOIN connections c ON c.id = l.connection_id
       LEFT JOIN conversations conv ON conv.id = l.conversation_id
       WHERE ${whereClause}
       ORDER BY l.created_at DESC
       LIMIT $${paramIndex}`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('List leads error:', error);
    res.status(500).json({ error: 'Erro ao listar leads', details: error.message });
  }
});

// Analyze lead with IA
router.post('/analyze-ia', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Organização não encontrada' });

    const { lead_id } = req.body;
    if (!lead_id) return res.status(400).json({ error: 'ID do lead é obrigatório' });

    // Self-healing: garante coluna de timestamp da análise
    await query(`ALTER TABLE sales_seo_leads ADD COLUMN IF NOT EXISTS ia_analyzed_at TIMESTAMPTZ`);

    // 1. Get lead and messages
    const leadRes = await query(
      `SELECT l.*, conv.id as conversation_id 
       FROM sales_seo_leads l
       JOIN conversations conv ON conv.id = l.conversation_id
       WHERE l.id = $1 AND l.organization_id = $2`,
      [lead_id, org.organization_id]
    );

    if (leadRes.rows.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });
    const lead = leadRes.rows[0];

    const messagesRes = await query(
      `SELECT content, from_me, timestamp 
       FROM chat_messages 
       WHERE conversation_id = $1 
       ORDER BY timestamp ASC LIMIT 50`,
      [lead.conversation_id]
    );

    const history = messagesRes.rows.map(m => 
      `${m.from_me ? 'Operador' : 'Cliente'} (${new Date(m.timestamp).toLocaleString()}): ${m.content}`
    ).join('\n');

    // 2. Get AI config from active agent or organization settings
    const aiConfig = await getAIConfig(org.organization_id);
    if (!aiConfig?.apiKey) {
      return res.status(400).json({
        error: 'IA não configurada para esta organização. Configure um agente ativo com chave de IA ou defina a IA nas configurações da organização.'
      });
    }

    const prompt = `Analise a seguinte conversa de WhatsApp que começou com a frase: "${lead.entry_message}".
    Histórico:
    ${history}

    Responda em formato JSON com:
    - status: 1 (apenas primeira mensagem), 2 (engajado/diálogo), 3 (venda realizada/encaminhada), 4 (perda/churn)
    - resumo: um resumo curto da interação (max 200 caracteres)
    - oportunidade: chance de upsell ou risco de churn (texto curto)`;

    const aiResponse = await callAI(aiConfig, [{ role: 'user', content: prompt }], { responseFormat: { type: 'json_object' } });
    
    let result;
    try {
      result = JSON.parse(aiResponse.content);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', aiResponse.content);
      // Fallback: se não for JSON, tenta extrair o status se possível ou usa o atual
      result = {
        status: lead.evolution_status,
        resumo: aiResponse.content.substring(0, 200),
        oportunidade: 'Não foi possível analisar detalhadamente.'
      };
    }

    // 3. Update lead
    await query(
      `UPDATE sales_seo_leads 
       SET evolution_status = $1, 
           ia_analysis = $2,
           ia_analyzed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3`,
      [result.status || lead.evolution_status, JSON.stringify(result), lead_id]
    );

    res.json({ success: true, analysis: result, ia_analyzed_at: new Date().toISOString() });
  } catch (error) {
    console.error('IA Analysis error:', error);
    res.status(500).json({ error: 'Erro na análise de IA', details: error.message });
  }
});

export default router;
