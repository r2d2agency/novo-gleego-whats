import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { executeFlow, getExecutionLogs, clearExecutionLogs } from '../lib/flow-executor.js';

const router = Router();
router.use(authenticate);

// Helper to get user's organization
// Same priority order as crm.js's getUserOrg (owner > admin > other, oldest
// membership as tiebreaker) -- must match across files, or a multi-org user
// gets scoped to a different org here than wherever the conversation/flow
// they're looking at actually lives, surfacing as a false "not found".
async function getUserOrganization(userId) {
  const result = await query(
    `SELECT om.organization_id, om.role
     FROM organization_members om
     WHERE om.user_id = $1
     ORDER BY (CASE WHEN om.role = 'owner' THEN 0 WHEN om.role = 'admin' THEN 1 ELSE 2 END), om.created_at ASC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0];
}

function isAdmin(role) {
  return ['owner', 'admin', 'manager'].includes(role);
}

// Every organization the user belongs to. Used for READING flows/categories
// so nothing a user actually owns stays hidden just because it lives in an
// organization other than whichever one getUserOrganization's single-org
// guess currently picks (e.g. older flows created under a second
// membership). Writes still use getUserOrganization (a new flow has to be
// created under one specific org).
async function getUserOrganizationIds(userId) {
  const result = await query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => r.organization_id);
}

// ============================================
// FLOW CATEGORIES
// ============================================

router.get('/categories', async (req, res) => {
  try {
    const orgIds = await getUserOrganizationIds(req.userId);
    if (orgIds.length === 0) return res.status(403).json({ error: 'Acesso negado' });
    const result = await query(
      'SELECT * FROM flow_categories WHERE organization_id = ANY($1) ORDER BY sort_order, name',
      [orgIds]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List flow categories error:', error);
    res.status(500).json({ error: 'Erro ao listar categorias' });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) return res.status(403).json({ error: 'Sem permissão' });
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
    const result = await query(
      'INSERT INTO flow_categories (organization_id, name, color) VALUES ($1, $2, $3) RETURNING *',
      [org.organization_id, name, color || '#6366f1']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create flow category error:', error);
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

router.patch('/categories/:id', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) return res.status(403).json({ error: 'Sem permissão' });
    const { name, color } = req.body;
    const result = await query(
      'UPDATE flow_categories SET name = COALESCE($1, name), color = COALESCE($2, color) WHERE id = $3 AND organization_id = $4 RETURNING *',
      [name, color, req.params.id, org.organization_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Categoria não encontrada' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update flow category error:', error);
    res.status(500).json({ error: 'Erro ao atualizar categoria' });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) return res.status(403).json({ error: 'Sem permissão' });
    await query('UPDATE flows SET category_id = NULL WHERE category_id = $1', [req.params.id]);
    await query('DELETE FROM flow_categories WHERE id = $1 AND organization_id = $2', [req.params.id, org.organization_id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete flow category error:', error);
    res.status(500).json({ error: 'Erro ao deletar categoria' });
  }
});

// ============================================
// FLOW MEMBERS
// ============================================

router.get('/:id/members', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Acesso negado' });
    const result = await query(
      `SELECT fm.user_id, u.name, u.email FROM flow_members fm 
       JOIN users u ON u.id = fm.user_id WHERE fm.flow_id = $1`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get flow members error:', error);
    res.status(500).json({ error: 'Erro ao buscar membros' });
  }
});

router.put('/:id/members', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) return res.status(403).json({ error: 'Sem permissão' });
    const { user_ids } = req.body;
    await query('DELETE FROM flow_members WHERE flow_id = $1', [req.params.id]);
    if (user_ids && user_ids.length > 0) {
      for (const uid of user_ids) {
        await query(
          'INSERT INTO flow_members (flow_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.params.id, uid]
        );
      }
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Save flow members error:', error);
    res.status(500).json({ error: 'Erro ao salvar membros' });
  }
});

// ============================================
// FLOWS CRUD
// ============================================

// List all flows -- across every organization the user belongs to, so a
// flow never goes missing from this list just because it lives under a
// different membership than whichever org getUserOrganization would guess.
router.get('/', async (req, res) => {
  try {
    const orgIds = await getUserOrganizationIds(req.userId);
    if (orgIds.length === 0) {
      return res.status(403).json({ error: 'Usuário não pertence a uma organização' });
    }

    const result = await query(
      `SELECT
        f.*,
        u.name as last_edited_by_name,
        fc.name as category_name,
        fc.color as category_color,
        o.name as organization_name,
        (SELECT COUNT(*) FROM flow_nodes WHERE flow_id = f.id) as node_count,
        COALESCE(
          (SELECT array_agg(fm.user_id) FROM flow_members fm WHERE fm.flow_id = f.id),
          '{}'
        ) as member_ids
       FROM flows f
       LEFT JOIN users u ON u.id = f.last_edited_by
       LEFT JOIN flow_categories fc ON fc.id = f.category_id
       LEFT JOIN organizations o ON o.id = f.organization_id
       WHERE f.organization_id = ANY($1)
       ORDER BY f.updated_at DESC`,
      [orgIds]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('List flows error:', error);
    res.status(500).json({ error: 'Erro ao listar fluxos' });
  }
});

// Get flow by ID
router.get('/:id', async (req, res) => {
  try {
    const orgIds = await getUserOrganizationIds(req.userId);
    if (orgIds.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const result = await query(
      `SELECT * FROM flows WHERE id = $1 AND organization_id = ANY($2)`,
      [req.params.id, orgIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fluxo não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get flow error:', error);
    res.status(500).json({ error: 'Erro ao buscar fluxo' });
  }
});

// Create flow
router.post('/', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) {
      return res.status(403).json({ error: 'Sem permissão para criar fluxos' });
    }

    const { name, description, trigger_enabled, trigger_keywords, trigger_match_mode, connection_ids, category_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const result = await query(
      `INSERT INTO flows (
        organization_id, name, description, 
        trigger_enabled, trigger_keywords, trigger_match_mode,
        connection_ids, category_id, last_edited_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        org.organization_id,
        name,
        description || null,
        trigger_enabled || false,
        trigger_keywords || [],
        trigger_match_mode || 'exact',
        connection_ids || [],
        category_id || null,
        req.userId
      ]
    );

    // Create default start node
    await query(
      `INSERT INTO flow_nodes (flow_id, node_id, node_type, name, position_x, position_y, content)
       VALUES ($1, 'start', 'start', 'Início', 250, 50, '{}')`,
      [result.rows[0].id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create flow error:', error);
    res.status(500).json({ error: 'Erro ao criar fluxo' });
  }
});

// Update flow
router.patch('/:id', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const existing = await query(
      'SELECT id FROM flows WHERE id = $1 AND organization_id = $2',
      [req.params.id, org.organization_id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Fluxo não encontrado' });
    }

    const allowedFields = [
      'name', 'description', 'trigger_enabled', 'trigger_keywords', 
      'trigger_match_mode', 'is_active', 'is_draft', 'connection_ids', 'category_id'
    ];

    const updates = [];
    const values = [];
    let paramCount = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'trigger_keywords' || field === 'connection_ids') {
          updates.push(`${field} = $${paramCount}`);
          values.push(req.body[field]);
        } else {
          updates.push(`${field} = $${paramCount}`);
          values.push(req.body[field]);
        }
        paramCount++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push(`last_edited_by = $${paramCount++}`);
    values.push(req.userId);
    updates.push('updated_at = NOW()');

    values.push(req.params.id);
    values.push(org.organization_id);

    const result = await query(
      `UPDATE flows SET ${updates.join(', ')} 
       WHERE id = $${paramCount} AND organization_id = $${paramCount + 1}
       RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update flow error:', error);
    res.status(500).json({ error: 'Erro ao atualizar fluxo' });
  }
});

// Delete flow
router.delete('/:id', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const result = await query(
      'DELETE FROM flows WHERE id = $1 AND organization_id = $2 RETURNING id',
      [req.params.id, org.organization_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fluxo não encontrado' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete flow error:', error);
    res.status(500).json({ error: 'Erro ao deletar fluxo' });
  }
});

// Toggle flow active state
router.post('/:id/toggle', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const result = await query(
      `UPDATE flows SET 
        is_active = NOT is_active,
        updated_at = NOW(),
        last_edited_by = $1
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
      [req.userId, req.params.id, org.organization_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fluxo não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Toggle flow error:', error);
    res.status(500).json({ error: 'Erro ao alternar fluxo' });
  }
});

// ============================================
// FLOW NODES & EDGES
// ============================================

// Get nodes and edges for a flow
router.get('/:id/canvas', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const flow = await query(
      'SELECT id FROM flows WHERE id = $1 AND organization_id = $2',
      [req.params.id, org.organization_id]
    );

    if (flow.rows.length === 0) {
      return res.status(404).json({ error: 'Fluxo não encontrado' });
    }

    const [nodes, edges] = await Promise.all([
      query(
        `SELECT * FROM flow_nodes WHERE flow_id = $1 ORDER BY created_at`,
        [req.params.id]
      ),
      query(
        `SELECT * FROM flow_edges WHERE flow_id = $1 ORDER BY created_at`,
        [req.params.id]
      )
    ]);

    res.json({
      nodes: nodes.rows,
      edges: edges.rows
    });
  } catch (error) {
    console.error('Get canvas error:', error);
    res.status(500).json({ error: 'Erro ao buscar canvas' });
  }
});

// Save nodes and edges (full replacement)
router.put('/:id/canvas', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { nodes, edges } = req.body;

    const flow = await query(
      'SELECT id, version FROM flows WHERE id = $1 AND organization_id = $2',
      [req.params.id, org.organization_id]
    );

    if (flow.rows.length === 0) {
      return res.status(404).json({ error: 'Fluxo não encontrado' });
    }

    const flowId = flow.rows[0].id;
    const currentVersion = flow.rows[0].version || 1;

    // Save current version to history
    const existingNodes = await query('SELECT * FROM flow_nodes WHERE flow_id = $1', [flowId]);
    const existingEdges = await query('SELECT * FROM flow_edges WHERE flow_id = $1', [flowId]);

    await query(
      `INSERT INTO flow_versions (flow_id, version, nodes_data, edges_data, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (flow_id, version) DO NOTHING`,
      [flowId, currentVersion, JSON.stringify(existingNodes.rows), JSON.stringify(existingEdges.rows), req.userId]
    );

    // Delete existing nodes and edges
    await query('DELETE FROM flow_nodes WHERE flow_id = $1', [flowId]);
    await query('DELETE FROM flow_edges WHERE flow_id = $1', [flowId]);

    // Insert new nodes
    if (nodes && nodes.length > 0) {
      for (const node of nodes) {
        await query(
          `INSERT INTO flow_nodes (flow_id, node_id, node_type, name, position_x, position_y, content)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            flowId,
            node.node_id || node.id,
            node.node_type || node.type,
            node.name || node.data?.label,
            node.position_x ?? node.position?.x ?? 0,
            node.position_y ?? node.position?.y ?? 0,
            JSON.stringify(node.content || node.data?.content || {})
          ]
        );
      }
    }

    // Insert new edges
    if (edges && edges.length > 0) {
      for (const edge of edges) {
        await query(
          `INSERT INTO flow_edges (flow_id, edge_id, source_node_id, target_node_id, source_handle, target_handle, label, edge_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            flowId,
            edge.edge_id || edge.id,
            edge.source_node_id || edge.source,
            edge.target_node_id || edge.target,
            edge.source_handle || edge.sourceHandle,
            edge.target_handle || edge.targetHandle,
            edge.label || null,
            edge.edge_type || edge.type || 'default'
          ]
        );
      }
    }

    // Increment version
    await query(
      `UPDATE flows SET version = $1, updated_at = NOW(), last_edited_by = $2, is_draft = false WHERE id = $3`,
      [currentVersion + 1, req.userId, flowId]
    );

    res.json({ success: true, version: currentVersion + 1 });
  } catch (error) {
    console.error('Save canvas error:', error);
    res.status(500).json({ error: 'Erro ao salvar canvas' });
  }
});

// Duplicate flow
router.post('/:id/duplicate', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const original = await query(
      'SELECT * FROM flows WHERE id = $1 AND organization_id = $2',
      [req.params.id, org.organization_id]
    );

    if (original.rows.length === 0) {
      return res.status(404).json({ error: 'Fluxo não encontrado' });
    }

    const flow = original.rows[0];

    // Create copy
    const copy = await query(
      `INSERT INTO flows (
        organization_id, name, description, 
        trigger_enabled, trigger_keywords, trigger_match_mode,
        connection_ids, is_draft, last_edited_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
      RETURNING *`,
      [
        org.organization_id,
        `${flow.name} (cópia)`,
        flow.description,
        false, // disabled by default
        flow.trigger_keywords || [],
        flow.trigger_match_mode,
        flow.connection_ids || [],
        req.userId
      ]
    );

    const newFlowId = copy.rows[0].id;

    // Copy nodes
    const nodes = await query('SELECT * FROM flow_nodes WHERE flow_id = $1', [req.params.id]);
    for (const node of nodes.rows) {
      await query(
        `INSERT INTO flow_nodes (flow_id, node_id, node_type, name, position_x, position_y, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newFlowId, node.node_id, node.node_type, node.name, node.position_x, node.position_y, node.content]
      );
    }

    // Copy edges
    const edges = await query('SELECT * FROM flow_edges WHERE flow_id = $1', [req.params.id]);
    for (const edge of edges.rows) {
      await query(
        `INSERT INTO flow_edges (flow_id, edge_id, source_node_id, target_node_id, source_handle, target_handle, label, edge_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newFlowId, edge.edge_id, edge.source_node_id, edge.target_node_id, edge.source_handle, edge.target_handle, edge.label, edge.edge_type]
      );
    }

    res.status(201).json(copy.rows[0]);
  } catch (error) {
    console.error('Duplicate flow error:', error);
    res.status(500).json({ error: 'Erro ao duplicar fluxo' });
  }
});

// ============================================
// FLOWS PARA CHAT (independente de chatbots)
// ============================================

// Listar fluxos disponíveis para uma conexão específica (filtrado por membro)
router.get('/available/:connectionId', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { connectionId } = req.params;
    const isAdminUser = isAdmin(org.role);

    // Buscar fluxos ativos, filtrados por conexão e por membro (se não admin)
    const result = await query(
      `SELECT 
        f.id,
        f.name,
        f.description,
        f.trigger_enabled,
        f.trigger_keywords,
        f.is_active,
        f.category_id,
        fc.name as category_name,
        fc.color as category_color,
        (SELECT COUNT(*) FROM flow_nodes WHERE flow_id = f.id) as node_count
       FROM flows f
       LEFT JOIN flow_categories fc ON fc.id = f.category_id
       WHERE f.organization_id = $1
         AND f.is_active = true
         AND (
           f.connection_ids IS NULL 
           OR f.connection_ids = '{}'
           OR $2 = ANY(f.connection_ids)
         )
         AND (
           $3 = true
           OR NOT EXISTS (SELECT 1 FROM flow_members fm2 WHERE fm2.flow_id = f.id)
           OR EXISTS (SELECT 1 FROM flow_members fm3 WHERE fm3.flow_id = f.id AND fm3.user_id = $4)
         )
       ORDER BY fc.sort_order NULLS LAST, fc.name NULLS LAST, f.name`,
      [org.organization_id, connectionId, isAdminUser, req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get available flows error:', error);
    res.status(500).json({ error: 'Erro ao buscar fluxos disponíveis' });
  }
});

// Iniciar um fluxo em uma conversa específica
router.post('/conversation/:conversationId/start', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { conversationId } = req.params;
    const { flow_id } = req.body;

    if (!flow_id) {
      return res.status(400).json({ error: 'flow_id é obrigatório' });
    }

    // Verificar se a conversa pertence à organização
    const conversation = await query(
      `SELECT c.id, c.contact_phone, c.connection_id
       FROM conversations c
       JOIN connections conn ON conn.id = c.connection_id
       WHERE c.id = $1 AND conn.organization_id = $2`,
      [conversationId, org.organization_id]
    );

    if (conversation.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Verificar se o fluxo pertence à organização e está ativo
    const flow = await query(
      `SELECT id, name FROM flows WHERE id = $1 AND organization_id = $2 AND is_active = true`,
      [flow_id, org.organization_id]
    );

    if (flow.rows.length === 0) {
      return res.status(404).json({ error: 'Fluxo não encontrado ou inativo' });
    }

    // Criar sessão de fluxo (reutilizar estrutura de chatbot_sessions se existir)
    try {
      await query(
        `INSERT INTO flow_sessions (
          flow_id, conversation_id, contact_phone, current_node_id, is_active, started_by
        ) VALUES ($1, $2, $3, 'start', true, $4)
        ON CONFLICT (conversation_id) WHERE is_active = true
        DO UPDATE SET 
          flow_id = $1,
          current_node_id = 'start',
          started_at = NOW(),
          started_by = $4,
          variables = '{}'`,
        [flow_id, conversationId, conversation.rows[0].contact_phone, req.userId]
      );
    } catch (sessionError) {
      // Tabela flow_sessions pode não existir ainda - criar registro simples
      console.log('flow_sessions table may not exist, skipping session creation:', sessionError.message);
    }

    // Execute the flow starting from the start node.
    // The flow executor handles variable initialization internally.
    const execResult = await executeFlow(flow_id, conversationId, 'start', {});

    if (!execResult.success) {
      console.error('Flow execution error:', execResult.error);
      return res.status(500).json({ 
        error: `Erro ao executar fluxo: ${execResult.error || 'Erro desconhecido'}`,
        execution: execResult 
      });
    }

    res.json({ 
      success: true, 
      message: `Fluxo "${flow.rows[0].name}" iniciado`,
      flow_id: flow_id,
      conversation_id: conversationId,
      execution: execResult
    });
  } catch (error) {
    console.error('Start flow in conversation error:', error);
    res.status(500).json({ error: 'Erro ao iniciar fluxo', details: error.message });
  }
});

// Cancelar fluxo ativo em uma conversa
router.post('/conversation/:conversationId/cancel', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { conversationId } = req.params;

    // Verificar se a conversa pertence à organização
    const conversation = await query(
      `SELECT c.id
       FROM conversations c
       JOIN connections conn ON conn.id = c.connection_id
       WHERE c.id = $1 AND conn.organization_id = $2`,
      [conversationId, org.organization_id]
    );

    if (conversation.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Tentar cancelar sessão de fluxo
    try {
      await query(
        `UPDATE flow_sessions 
         SET is_active = false, ended_at = NOW()
         WHERE conversation_id = $1 AND is_active = true`,
        [conversationId]
      );
    } catch (e) {
      console.log('flow_sessions table may not exist:', e.message);
    }

    res.json({ success: true, message: 'Fluxo cancelado' });
  } catch (error) {
    console.error('Cancel flow error:', error);
    res.status(500).json({ error: 'Erro ao cancelar fluxo' });
  }
});

// ============================================
// FLOW EXECUTION LOGS (debugging)
// ============================================

// Get execution logs for a conversation or all
router.get('/execution-logs/:conversationId?', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { conversationId } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    // If conversationId provided, verify access
    if (conversationId) {
      const conv = await query(
        `SELECT c.id FROM conversations c
         JOIN connections conn ON conn.id = c.connection_id
         WHERE c.id = $1 AND conn.organization_id = $2`,
        [conversationId, org.organization_id]
      );
      if (conv.rows.length === 0) {
        return res.status(404).json({ error: 'Conversa não encontrada' });
      }
    }

    const logs = getExecutionLogs(conversationId || null, limit);
    res.json({ logs });
  } catch (error) {
    console.error('Get execution logs error:', error);
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
});

// Clear execution logs
router.delete('/execution-logs/:conversationId?', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org || !isAdmin(org.role)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { conversationId } = req.params;
    clearExecutionLogs(conversationId || null);
    res.json({ success: true });
  } catch (error) {
    console.error('Clear execution logs error:', error);
    res.status(500).json({ error: 'Erro ao limpar logs' });
  }
});

export default router;
