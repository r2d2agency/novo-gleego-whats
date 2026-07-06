import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import * as whatsappProvider from '../lib/whatsapp-provider.js';
import { startAgentSession, stopAgentSession, getActiveAgentSession, pauseSessionForHumanReply, setHumanTakeover, triggerAgentFirstMessage } from '../lib/ai-agent-processor.js';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';


const router = Router();

// Get user's organization with role
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

// Check if user role is view-only (manager = supervisor)
function isViewOnlyRole(role) {
  return role === 'manager';
}

// Get user's connections based on their access rights.
// Admin/owner/manager can access all org connections; others only assigned ones via members or groups.
// Get user's connections based on their access rights.
// Admin/owner/manager can access all org connections; others only assigned ones via members or groups.
async function getUserConnections(userId) {
  const userOrg = await getUserOrganization(userId);
  
  // Check if user has specific connections assigned via connection_members (active selection/filter)
  const specificResult = await query(
    `SELECT DISTINCT cm.connection_id as id
     FROM connection_members cm
     WHERE cm.user_id = $1`,
    [userId]
  );
  
  const directConnIds = specificResult.rows.map(r => r.id);

  // If the user has specific connections selected, only return those.
  // This honors the user's specific connection selection in the chat.
  if (directConnIds.length > 0) {
    // For owners/admins, they can select any connection from their organization.
    // If not, they can only see connections they have access to via access groups.
    if (userOrg && ['owner', 'admin'].includes(userOrg.role)) {
      return directConnIds;
    }
    
    // For non-admin users, we must ensure they actually have access to these connections
    const accessGroupsResult = await query(
      `SELECT access_group_id FROM access_group_members WHERE user_id = $1`,
      [userId]
    );
    
    if (accessGroupsResult.rows.length > 0) {
      const groupIds = accessGroupsResult.rows.map(r => r.access_group_id);
      const groupConnsResult = await query(
        `SELECT DISTINCT connection_id FROM access_group_connections WHERE access_group_id = ANY($1) AND connection_id = ANY($2)`,
        [groupIds, directConnIds]
      );
      return groupConnsResult.rows.map(r => r.connection_id);
    }
    
    return directConnIds;
  }

  // Fallback: If no specific connections are assigned/selected
  
  // Check access groups (for standard users AND owners/admins without specific selection)
  const accessGroupsResult = await query(
    `SELECT access_group_id FROM access_group_members WHERE user_id = $1`,
    [userId]
  );
  
  if (accessGroupsResult.rows.length > 0) {
    const groupIds = accessGroupsResult.rows.map(r => r.access_group_id);
    const groupConnsResult = await query(
      `SELECT DISTINCT connection_id FROM access_group_connections WHERE access_group_id = ANY($1)`,
      [groupIds]
    );
    return groupConnsResult.rows.map(r => r.connection_id);
  }

  // Fallback for owners/admins: if no selection AND no access groups, they get all org connections.
  // This is a safety measure to avoid an empty chat if no access is configured yet.
  if (userOrg && ['owner', 'admin'].includes(userOrg.role)) {
    const orgResult = await query(
      `SELECT id FROM connections WHERE organization_id = $1`,
      [userOrg.organization_id]
    );

    return orgResult.rows.map(r => r.id);
  }

  return [];
}


async function hasColumn(tableName, columnName) {
  const result = await query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
     ) AS exists_column`,
    [tableName, columnName]
  );

  return Boolean(result.rows[0]?.exists_column);
}

// ==========================================
// CONVERSATIONS
// ==========================================

// Get attendance status counts (for tab badges)
router.get('/conversations/attendance-counts', authenticate, async (req, res) => {
  try {
    const connectionIds = await getUserConnections(req.userId);
    
    if (connectionIds.length === 0) {
      return res.json({ waiting: 0, attending: 0, finished: 0 });
    }

    const { is_group } = req.query;

    // Get user's role and department membership for visibility
    const userOrg = await getUserOrganization(req.userId);
    const isAdminOrSupervisor = userOrg && ['owner', 'admin'].includes(userOrg.role);
    
    const userDeptsResult = await query(
      `SELECT department_id, role FROM department_members WHERE user_id = $1`,
      [req.userId]
    );
    const userDepartmentIds = userDeptsResult.rows.map(r => r.department_id);
    const isSupervisorInAnyDept = userDeptsResult.rows.some(r => r.role === 'supervisor');

    let groupFilter = '';
    if (is_group === 'true') {
      groupFilter = ` AND (COALESCE(conv.is_group, false) = true OR conv.remote_jid LIKE '%@g.us')`;
    } else if (is_group === 'false') {
      groupFilter = ` AND COALESCE(conv.is_group, false) = false AND conv.remote_jid NOT LIKE '%@g.us'`;
    }

    // Check if org has shared_conversations enabled
    let sharedConversations = false;
    if (userOrg) {
      try {
        const orgResult = await query(
          `SELECT modules_enabled FROM organizations WHERE id = $1`,
          [userOrg.organization_id]
        );
        if (orgResult.rows[0]?.modules_enabled?.shared_conversations === true) {
          sharedConversations = true;
        }
      } catch {}
    }

    // Build visibility filter based on user role
    let visibilityFilter = '';
    const params = [connectionIds];
    let paramIndex = 2;

    // Se sharedConversations estiver ativo, usuários podem ver todas as conversas das conexões atribuídas.
    if (!sharedConversations && !isAdminOrSupervisor && !isSupervisorInAnyDept) {
      if (userDepartmentIds.length > 0) {
        visibilityFilter = ` AND (
          conv.assigned_to = $${paramIndex}
          OR conv.department_id = ANY($${paramIndex + 1}::uuid[])
          OR (conv.department_id IS NULL AND conv.attendance_status = 'waiting')
        )`;
        params.push(req.userId);
        params.push(userDepartmentIds);
        paramIndex += 2;
      } else {
        visibilityFilter = ` AND (
          conv.assigned_to = $${paramIndex}
          OR (conv.department_id IS NULL AND conv.attendance_status = 'waiting')
        )`;
        params.push(req.userId);
        paramIndex++;
      }
    }

    try {
      const result = await query(`
        SELECT 
          COUNT(*) FILTER (WHERE conv.attendance_status = 'waiting') as waiting,
          COUNT(*) FILTER (WHERE conv.attendance_status = 'attending' OR conv.attendance_status IS NULL) as attending,
          COUNT(*) FILTER (WHERE conv.attendance_status = 'finished') as finished
        FROM conversations conv
        WHERE conv.connection_id = ANY($1)
          AND conv.is_archived = false
          AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id)
          ${groupFilter}
          ${visibilityFilter}
      `, params);

      res.json({
        waiting: parseInt(result.rows[0]?.waiting || 0),
        attending: parseInt(result.rows[0]?.attending || 0),
        finished: parseInt(result.rows[0]?.finished || 0)
      });
    } catch (dbError) {
      const message = String(dbError?.message || '');
      if (/attendance_status/i.test(message)) {
        const result = await query(`
          SELECT COUNT(*) as total
          FROM conversations conv
          WHERE conv.connection_id = ANY($1)
            AND conv.is_archived = false
            AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id)
            ${groupFilter}
        `, [connectionIds]);

        const total = parseInt(result.rows[0]?.total || 0);
        res.json({ waiting: 0, attending: total, finished: 0 });
      } else {
        throw dbError;
      }
    }
  } catch (error) {
    console.error('Get attendance counts error:', error);
    res.status(500).json({ error: 'Erro ao buscar contagem' });
  }
});

// Get daily attendance stats for charts
router.get('/conversations/attendance-stats', authenticate, async (req, res) => {
  try {
    let connectionIds = await getUserConnections(req.userId);
    
    if (connectionIds.length === 0) {
      return res.json({ daily_stats: [] });
    }

    const days = parseInt(req.query.days) || 7;
    const startDate = req.query.start_date || null;
    const { is_group, connection_id } = req.query;

    // Filter by specific connection if provided
    if (connection_id && connectionIds.includes(connection_id)) {
      connectionIds = [connection_id];
    }

    let groupFilter = '';
    if (is_group === 'true') {
      groupFilter = ` AND (COALESCE(conv.is_group, false) = true OR conv.remote_jid LIKE '%@g.us')`;
    } else if (is_group === 'false') {
      groupFilter = ` AND COALESCE(conv.is_group, false) = false AND conv.remote_jid NOT LIKE '%@g.us'`;
    }

    try {
      // Get daily counts per status
      // Use last_message_at as the primary date for grouping (most reliable)
      const dateFilter = startDate 
        ? `AND DATE(COALESCE(conv.last_message_at, conv.updated_at)) >= '${startDate}'::date`
        : `AND COALESCE(conv.last_message_at, conv.updated_at) >= NOW() - INTERVAL '${days} days'`;

      const result = await query(`
        SELECT 
          TO_CHAR(DATE(COALESCE(conv.last_message_at, conv.updated_at)), 'YYYY-MM-DD') as date,
          COUNT(*) FILTER (WHERE conv.attendance_status = 'waiting') as waiting,
          COUNT(*) FILTER (WHERE conv.attendance_status = 'attending' OR conv.attendance_status IS NULL) as attending,
          COUNT(*) FILTER (WHERE conv.attendance_status = 'finished') as finished
        FROM conversations conv
        WHERE conv.connection_id = ANY($1)
          AND conv.is_archived = false
          ${dateFilter}
          ${groupFilter}
        GROUP BY DATE(COALESCE(conv.last_message_at, conv.updated_at))
        ORDER BY date ASC
      `, [connectionIds]);

      res.json({
        daily_stats: result.rows.map(row => ({
          date: row.date,
          waiting: parseInt(row.waiting || 0),
          attending: parseInt(row.attending || 0),
          finished: parseInt(row.finished || 0)
        }))
      });
    } catch (dbError) {
      // Fallback if columns don't exist
      const message = String(dbError?.message || '');
      if (/accepted_at|attendance_status/i.test(message)) {
        res.json({ daily_stats: [] });
      } else {
        throw dbError;
      }
    }
  } catch (error) {
    console.error('Get attendance stats error:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// Get hourly distribution of conversations
router.get('/conversations/hourly-stats', authenticate, async (req, res) => {
  try {
    let connectionIds = await getUserConnections(req.userId);
    if (connectionIds.length === 0) return res.json({ hourly_stats: [] });

    const { connection_id, date } = req.query;
    if (connection_id && connectionIds.includes(connection_id)) {
      connectionIds = [connection_id];
    }

    // If specific date, count conversations per hour for that day
    // Otherwise, average across last 30 days
    const dateFilter = date
      ? `AND DATE(COALESCE(conv.last_message_at, conv.updated_at)) = '${date}'::date`
      : `AND COALESCE(conv.last_message_at, conv.updated_at) >= NOW() - INTERVAL '30 days'`;

    const divisor = date ? '1' : 'GREATEST(COUNT(DISTINCT DATE(COALESCE(conv.last_message_at, conv.updated_at))), 1)';

    const result = await query(`
      SELECT 
        EXTRACT(HOUR FROM COALESCE(conv.last_message_at, conv.updated_at)) AS hour,
        ROUND(COUNT(*)::numeric / ${divisor}, 1) AS count
      FROM conversations conv
      WHERE conv.connection_id = ANY($1)
        AND conv.is_archived = false
        ${dateFilter}
      GROUP BY EXTRACT(HOUR FROM COALESCE(conv.last_message_at, conv.updated_at))
      ORDER BY hour
    `, [connectionIds]);

    // Fill all 24 hours
    const hourMap = new Map(result.rows.map(r => [parseInt(r.hour), parseFloat(r.count)]));
    const hourly_stats = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, '0')}:00`,
      count: hourMap.get(h) || 0
    }));

    res.json({ hourly_stats });
  } catch (error) {
    console.error('Get hourly stats error:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas por hora' });
  }
});


router.get('/conversations/user-avg-time', authenticate, async (req, res) => {
  try {
    let connectionIds = await getUserConnections(req.userId);
    
    if (connectionIds.length === 0) {
      return res.json({ user_stats: [] });
    }

    const days = parseInt(req.query.days) || 7;
    const { connection_id } = req.query;

    // Filter by specific connection if provided
    if (connection_id && connectionIds.includes(connection_id)) {
      connectionIds = [connection_id];
    }

    try {
      // Calculate average time from accepted_at to when status changed to finished
      // Uses updated_at as proxy for finish time if finished_at column doesn't exist
      const result = await query(`
        SELECT 
          u.id as user_id,
          u.name as user_name,
          COUNT(*) as total_finished,
          COALESCE(
            AVG(
              EXTRACT(EPOCH FROM (conv.updated_at - conv.accepted_at)) / 60
            ),
            0
          ) as avg_minutes
        FROM conversations conv
        JOIN users u ON u.id = conv.accepted_by
        WHERE conv.connection_id = ANY($1)
          AND conv.attendance_status = 'finished'
          AND conv.accepted_at IS NOT NULL
          AND conv.accepted_at >= NOW() - INTERVAL '${days} days'
        GROUP BY u.id, u.name
        ORDER BY avg_minutes ASC
      `, [connectionIds]);

      res.json({
        user_stats: result.rows.map(row => ({
          user_id: row.user_id,
          user_name: row.user_name,
          total_finished: parseInt(row.total_finished || 0),
          avg_minutes: parseFloat(row.avg_minutes || 0)
        }))
      });
    } catch (dbError) {
      // Fallback if columns don't exist
      const message = String(dbError?.message || '');
      if (/accepted_at|attendance_status|accepted_by/i.test(message)) {
        res.json({ user_stats: [] });
      } else {
        throw dbError;
      }
    }
  } catch (error) {
    console.error('Get user avg time error:', error);
    res.status(500).json({ error: 'Erro ao buscar tempo médio' });
  }
});

// Global search across all messages
router.get('/messages/search', authenticate, async (req, res) => {
  try {
    const connectionIds = await getUserConnections(req.userId);
    
    if (connectionIds.length === 0) {
      return res.json({ results: [] });
    }

    const { q, limit = 50, from_date, to_date } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ results: [] });
    }

    const searchQuery = `%${q}%`;
    const maxResults = Math.min(parseInt(limit) || 50, 500); // Increased to 500

    let queryText = `
      SELECT 
        m.id as message_id,
        m.conversation_id,
        m.content,
        m.timestamp,
        COALESCE(m.from_me, false) as is_from_me,
        conv.contact_name,
        conv.contact_phone,
        conv.group_name,
        (COALESCE(conv.is_group, false) OR conv.remote_jid LIKE '%@g.us') AS is_group,
        conv.attendance_status
      FROM chat_messages m
      JOIN conversations conv ON conv.id = m.conversation_id
      WHERE conv.connection_id = ANY($1)
        AND m.content ILIKE $2
        AND m.content IS NOT NULL
        AND m.content != ''
        AND COALESCE(conv.is_archived, false) = false
    `;

    const queryParams = [connectionIds, searchQuery];
    let paramCount = 2;

    if (from_date) {
      paramCount++;
      queryText += ` AND m.timestamp >= $${paramCount}`;
      queryParams.push(from_date + ' 00:00:00');
    }

    if (to_date) {
      paramCount++;
      queryText += ` AND m.timestamp <= $${paramCount}`;
      queryParams.push(to_date + ' 23:59:59');
    }

    // Count total results for this search (without limit)
    const countQueryText = `SELECT COUNT(*) FROM (${queryText}) as search_results`;
    const countResult = await query(countQueryText, queryParams);
    const totalCount = parseInt(countResult.rows[0]?.count || 0);

    // Now apply ordering and limit for the actual results
    const finalQueryText = `${queryText} ORDER BY m.timestamp DESC LIMIT $${paramCount + 1}`;
    const finalQueryParams = [...queryParams, maxResults];

    const result = await query(finalQueryText, finalQueryParams);

    res.json({
      totalCount,
      results: result.rows.map(row => ({
        message_id: row.message_id,
        conversation_id: row.conversation_id,
        contact_name: row.contact_name,
        contact_phone: row.contact_phone,
        group_name: row.group_name,
        is_group: row.is_group || false,
        content: row.content,
        timestamp: row.timestamp,
        is_from_me: row.is_from_me || false,
        attendance_status: row.attendance_status || 'attending',
      }))
    });
  } catch (error) {
    console.error('Global message search error:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

router.get('/conversations/unread', authenticate, async (req, res) => {
  try {
    const connectionIds = await getUserConnections(req.userId);
    
    if (connectionIds.length === 0) {
      return res.json([]);
    }

    const result = await query(`
      SELECT 
        conv.id,
        conv.contact_name,
        conv.contact_phone,
        conv.unread_count,
        conv.last_message_at,
        conv.attendance_status,
        (COALESCE(conv.is_group, false) OR conv.remote_jid LIKE '%@g.us') AS is_group,
        conv.created_at,
        conv.connection_id,
        conn.name as connection_name,
        (SELECT content FROM chat_messages WHERE conversation_id = conv.id ORDER BY timestamp DESC LIMIT 1) as last_message,
           (SELECT message_type FROM chat_messages WHERE conversation_id = conv.id ORDER BY timestamp DESC LIMIT 1) as last_message_type,
           (SELECT json_build_object(
              'flow_name', f.name,
              'node_name', fn.name,
              'started_at', fs.started_at,
              'wait_reply_expires_at', fs.wait_reply_expires_at
            )
            FROM flow_sessions fs
            JOIN flows f ON f.id = fs.flow_id
            LEFT JOIN flow_nodes fn ON fn.flow_id = fs.flow_id AND fn.node_id = fs.current_node_id
            WHERE fs.conversation_id = conv.id AND fs.is_active = true
            LIMIT 1
           ) as active_flow
      FROM conversations conv
      JOIN connections conn ON conn.id = conv.connection_id
      WHERE conv.connection_id = ANY($1)
        AND conv.unread_count > 0
        AND conv.is_archived = false
      ORDER BY conv.last_message_at DESC NULLS LAST
      LIMIT 20
    `, [connectionIds]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get unread conversations error:', error);
    res.status(500).json({ error: 'Erro ao buscar conversas não lidas' });
  }
});

// Get all conversations for user's connections
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const connectionIds = await getUserConnections(req.userId);
    
    if (connectionIds.length === 0) {
      return res.json([]);
    }

    const { 
      attendance_status, 
      assigned_to, 
      department_id, 
      search, 
      limit = 50, 
      offset = 0,
      is_group,
      connection_id: filterConnectionId,
      show_archived: show_archived_raw = 'false',
      favorite,
      tag
    } = req.query;
    
    const show_archived = String(show_archived_raw) === 'true';

    const userOrg = await getUserOrganization(req.userId);
    const isAdminOrSupervisor = userOrg && ['owner', 'admin'].includes(userOrg.role);

    // Check shared conversations (groups or org-level)
    let sharedConversations = false;
    let accessGroupIds = [];
    if (userOrg) {
      try {
        const orgResult = await query(
          `SELECT modules_enabled FROM organizations WHERE id = $1`,
          [userOrg.organization_id]
        );
        if (orgResult.rows[0]?.modules_enabled?.shared_conversations === true) {
          sharedConversations = true;
        }
        
        // Find access groups for this user
        const agResult = await query(
          `SELECT access_group_id FROM access_group_members WHERE user_id = $1`,
          [req.userId]
        );
        accessGroupIds = agResult.rows.map(r => r.access_group_id);
      } catch {}
    }

    let filter = `conv.connection_id = ANY($1)`;
    const params = [connectionIds];
    let paramIndex = 2;

    // Filter by connection if provided
    if (filterConnectionId && connectionIds.includes(filterConnectionId)) {
      filter += ` AND conv.connection_id = $${paramIndex}`;
      params.push(filterConnectionId);
      paramIndex++;
    }

    // Visibility logic
    if (!isAdminOrSupervisor && !sharedConversations) {
      // Se sharedConversations NÃO estiver ativo, aplicamos restrições.
      // Caso contrário (está ativo), o usuário vê tudo das conexões permitidas.
      if (accessGroupIds.length > 0) {
        filter += ` AND (
          conv.assigned_to = $${paramIndex}
          OR conv.assigned_to IS NULL
          OR conv.assigned_to IN (
            SELECT user_id FROM access_group_members 
            WHERE access_group_id IN (
              SELECT access_group_id FROM access_group_members WHERE user_id = $${paramIndex}
            )
          )
        )`;
        params.push(req.userId);
        paramIndex++;
      } else {
        // Standard logic: only own or unassigned waiting
        filter += ` AND (conv.assigned_to = $${paramIndex} OR (conv.assigned_to IS NULL AND conv.attendance_status = 'waiting'))`;
        params.push(req.userId);
        paramIndex++;
      }
    }

    // Apply standard filters
    if (attendance_status) {
      if (attendance_status === 'attending') {
        filter += ` AND (conv.attendance_status = 'attending' OR conv.attendance_status IS NULL)`;
      } else {
        filter += ` AND conv.attendance_status = $${paramIndex}`;
        params.push(attendance_status);
        paramIndex++;
      }
    }
    if (is_group === 'true') {
      filter += ` AND (COALESCE(conv.is_group, false) = true OR conv.remote_jid LIKE '%@g.us')`;
    } else if (is_group === 'false') {
      filter += ` AND COALESCE(conv.is_group, false) = false AND conv.remote_jid NOT LIKE '%@g.us'`;
    }

    if (show_archived) {
      filter += ` AND conv.is_archived = true`;
    } else {
      filter += ` AND conv.is_archived = false`;
    }

    if (favorite === 'true') {
      filter += ` AND COALESCE(conv.is_favorite, false) = true`;
    }

    if (tag && tag !== 'all') {
      filter += ` AND EXISTS (
        SELECT 1 FROM conversation_tag_links ctl 
        WHERE ctl.conversation_id = conv.id AND ctl.tag_id = $${paramIndex}
      )`;
      params.push(tag);
      paramIndex++;
    }

    if (assigned_to === 'me') {
      filter += ` AND conv.assigned_to = $${paramIndex}`;
      params.push(req.userId);
      paramIndex++;
    } else if (assigned_to === 'unassigned') {
      filter += ` AND conv.assigned_to IS NULL`;
    } else if (assigned_to && assigned_to !== 'all') {
      filter += ` AND conv.assigned_to = $${paramIndex}`;
      params.push(assigned_to);
      paramIndex++;
    }

    if (department_id && department_id !== 'all') {
      filter += ` AND conv.department_id = $${paramIndex}`;
      params.push(department_id);
      paramIndex++;
    }

    if (search) {
      filter += ` AND (conv.contact_name ILIKE $${paramIndex} OR conv.contact_phone ILIKE $${paramIndex} OR conv.group_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Execute the final query
    const result = await query(
      `SELECT conv.*, (COALESCE(conv.is_group, false) OR conv.remote_jid LIKE '%@g.us') AS is_group, conn.name as connection_name, u.name as assigned_name, d.name as department_name,
        COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
           FROM conversation_tag_links ctl
           JOIN conversation_tags t ON t.id = ctl.tag_id
           WHERE ctl.conversation_id = conv.id
          ), '[]'::json
        ) as tags,
        (SELECT content FROM chat_messages WHERE conversation_id = conv.id ORDER BY timestamp DESC LIMIT 1) as last_message,
        (SELECT message_type FROM chat_messages WHERE conversation_id = conv.id ORDER BY timestamp DESC LIMIT 1) as last_message_type,
        (SELECT timestamp FROM chat_messages WHERE conversation_id = conv.id ORDER BY timestamp DESC LIMIT 1) as last_message_at
       FROM conversations conv
       JOIN connections conn ON conn.id = conv.connection_id
       LEFT JOIN users u ON u.id = conv.assigned_to
       LEFT JOIN departments d ON d.id = conv.department_id
       WHERE ${filter}
       ORDER BY COALESCE(conv.is_pinned, false) DESC, conv.last_message_at DESC NULLS LAST, conv.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('List conversations error:', error);
    res.status(500).json({ error: 'Erro ao listar conversas' });
  }
});

// Skip the rest of the existing list conversations implementation by jumping ahead
const oldListConversationsEnd = true;

/*


    const buildQuery = (supportsAttendance = true, supportsDepartment = true) => {
      let sql = `
        SELECT 
          conv.*,
          conn.name as connection_name,
          conn.phone_number as connection_phone,
          u.name as assigned_name,
          ${supportsAttendance ? 'ua.name as accepted_by_name,' : ''}
          ${supportsDepartment ? 'd.name as department_name,' : ''}
          COALESCE(
            (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FROM conversation_tag_links ctl
             JOIN conversation_tags t ON t.id = ctl.tag_id
             WHERE ctl.conversation_id = conv.id
            ), '[]'::json
          ) as tags,
          (SELECT content FROM chat_messages WHERE conversation_id = conv.id ORDER BY timestamp DESC LIMIT 1) as last_message,
         (SELECT message_type FROM chat_messages WHERE conversation_id = conv.id ORDER BY timestamp DESC LIMIT 1) as last_message_type,
         (SELECT json_build_object(
            'flow_name', f.name,
            'node_name', fn.name,
            'started_at', fs.started_at,
            'wait_reply_expires_at', fs.wait_reply_expires_at
          )
          FROM flow_sessions fs
          JOIN flows f ON f.id = fs.flow_id
          LEFT JOIN flow_nodes fn ON fn.flow_id = fs.flow_id AND fn.node_id = fs.current_node_id
          WHERE fs.conversation_id = conv.id AND fs.is_active = true
          LIMIT 1
         ) as active_flow
        FROM conversations conv
        JOIN connections conn ON conn.id = conv.connection_id
        LEFT JOIN users u ON u.id = conv.assigned_to
        ${supportsAttendance ? 'LEFT JOIN users ua ON ua.id = conv.accepted_by' : ''}
        ${supportsDepartment ? 'LEFT JOIN departments d ON d.id = conv.department_id' : ''}
        WHERE conv.connection_id = ANY($1)
      `;

      const params = [connectionIds];
      let paramIndex = 2;

      // Show conversations with messages OR with unread count
      if (includeEmpty !== 'true') {
        sql += ` AND (EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id) OR conv.unread_count > 0)`;
      }

      // Filter by group status
      if (is_group === 'true') {
        sql += ` AND COALESCE(conv.is_group, false) = true`;
      } else if (is_group === 'false') {
        sql += ` AND COALESCE(conv.is_group, false) = false`;
      }

      // Filter by archived status
      if (archived === 'true') {
        sql += ` AND conv.is_archived = true`;
      } else {
        sql += ` AND conv.is_archived = false`;
      }

      // Filter by connection
      if (connection && connection !== 'all') {
        sql += ` AND conv.connection_id = $${paramIndex}`;
        params.push(connection);
        paramIndex++;
      }

      // Filter by search
      if (search) {
        sql += ` AND (conv.contact_name ILIKE $${paramIndex} OR conv.contact_phone ILIKE $${paramIndex} OR conv.group_name ILIKE $${paramIndex} OR EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id AND cm.content ILIKE $${paramIndex} LIMIT 1))`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      // Filter by tag
      if (tag) {
        sql += ` AND EXISTS (
          SELECT 1 FROM conversation_tag_links ctl 
          WHERE ctl.conversation_id = conv.id AND ctl.tag_id = $${paramIndex}
        )`;
        params.push(tag);
        paramIndex++;
      }

      // Filter by assigned user
      if (assigned === 'me') {
        sql += ` AND conv.assigned_to = $${paramIndex}`;
        params.push(req.userId);
        paramIndex++;
      } else if (assigned === 'unassigned') {
        sql += ` AND conv.assigned_to IS NULL`;
      } else if (assigned && assigned !== 'all') {
        sql += ` AND conv.assigned_to = $${paramIndex}`;
        params.push(assigned);
        paramIndex++;
      }

      // Filter by attendance status
      if (supportsAttendance && attendance_status && !search) {
        if (attendance_status === 'waiting') {
          sql += ` AND conv.attendance_status = 'waiting'`;
        } else if (attendance_status === 'attending') {
          sql += ` AND (conv.attendance_status = 'attending' OR conv.attendance_status IS NULL)`;
        } else if (attendance_status === 'finished') {
          sql += ` AND conv.attendance_status = 'finished'`;
        }
      }

      // ========================================
      // DEPARTMENT-BASED VISIBILITY FILTER
      // ========================================
      // Logic:
      // 1. If shared_conversations is enabled -> all connection members see everything
      // 2. If assigned_to = current user -> can see (my conversation)
      // 3. If department_id is in user's departments -> can see
      // 4. If department_id IS NULL AND attendance_status = 'waiting' -> can see (general queue)
      // 5. If department_id IS NULL AND attendance_status != 'waiting' -> only admin/supervisor can see
      // 6. Admin/Supervisor/Owner can see everything
      
      if (supportsDepartment && !sharedConversations && !isAdminOrSupervisor && !isSupervisorInAnyDept) {
        // Non-admin users: apply visibility restrictions if shared_conversations is OFF
        if (userDepartmentIds.length > 0) {
          // User has departments: can see their department conversations + assigned to them + waiting without department
          sql += ` AND (
            conv.assigned_to = $${paramIndex}
            OR conv.department_id = ANY($${paramIndex + 1}::uuid[])
            OR (conv.department_id IS NULL AND conv.attendance_status = 'waiting')
          )`;
          params.push(req.userId);
          params.push(userDepartmentIds);
          paramIndex += 2;
        } else {
          // User has no departments: can only see assigned to them + waiting without department
          sql += ` AND (
            conv.assigned_to = $${paramIndex}
            OR (conv.department_id IS NULL AND conv.attendance_status = 'waiting')
          )`;
          params.push(req.userId);
          paramIndex++;
        }
      }

      // Additional filter by specific department (when user explicitly selects one)
      if (supportsDepartment && filterDepartmentIds && filterDepartmentIds.length > 0) {
        sql += ` AND conv.department_id = ANY($${paramIndex}::uuid[])`;
        params.push(filterDepartmentIds);
        paramIndex++;
      }

      // Filter by favorite
      if (favorite === 'true') {
        sql += ` AND COALESCE(conv.is_favorite, false) = true`;
      }

      // Order by pinned first, then by last_message_at
      sql += ` ORDER BY COALESCE(conv.is_pinned, false) DESC, conv.last_message_at DESC NULLS LAST, conv.created_at DESC`;

      // Add pagination
      if (limit) {
        sql += ` LIMIT $${paramIndex}`;
        params.push(parseInt(limit));
        paramIndex++;
      }

      if (offset) {
        sql += ` OFFSET $${paramIndex}`;
        params.push(parseInt(offset));
        paramIndex++;
      }

      return { sql, params };
    };

    let result;
    try {
      const { sql, params } = buildQuery(true, true);
      result = await query(sql, params);
    } catch (error) {
      const message = String(error?.message || '');
      const missingAttendanceColumns = /attendance_status|accepted_by|accepted_at/i.test(message);
      const missingDepartmentColumn = /department_id/i.test(message);
      
      if (missingDepartmentColumn) {
        const { sql, params } = buildQuery(true, false);
        result = await query(sql, params);
      } else if (missingAttendanceColumns) {
        const { sql, params } = buildQuery(false, true);
        result = await query(sql, params);
      } else {
        throw error;
      }
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Erro ao buscar conversas' });
  }
});

*/
// Sync group names - fetch from provider for groups with missing names
router.post('/sync-group-names', authenticate, async (req, res) => {

  try {
    const connectionIds = await getUserConnections(req.userId);
    if (connectionIds.length === 0) return res.json({ updated: 0 });

    // Find groups without proper names
    const groups = await query(
      `SELECT conv.id, conv.remote_jid, conv.connection_id, conn.provider, conn.instance_id, conn.instance_name, conn.wapi_token, conn.api_key
       FROM conversations conv
       JOIN connections conn ON conn.id = conv.connection_id
       WHERE conv.connection_id = ANY($1)
         AND conv.is_group = true
         AND (conv.group_name IS NULL OR conv.group_name = '' OR conv.group_name = 'Grupo' OR conv.group_name = 'Grupo sem nome'
              OR conv.contact_name IS NULL OR conv.contact_name = '' OR conv.contact_name = 'Grupo' OR conv.contact_name = 'Grupo sem nome')
       LIMIT 50`,
      [connectionIds]
    );

    if (groups.rows.length === 0) return res.json({ updated: 0 });

    let updated = 0;

    // Group by connection for bulk operations
    const byConnection = {};
    for (const g of groups.rows) {
      if (!byConnection[g.connection_id]) byConnection[g.connection_id] = { connection: g, convs: [] };
      byConnection[g.connection_id].convs.push(g);
    }

    for (const { connection, convs } of Object.values(byConnection)) {
      try {
        if (connection.provider === 'wapi' && connection.instance_id && connection.wapi_token) {
          const { getGroups } = await import('../lib/wapi-provider.js');
          const groupsData = await getGroups(connection.instance_id, connection.wapi_token);
          
          if (groupsData.success && groupsData.groups?.length > 0) {
            const nameMap = new Map();
            for (const g of groupsData.groups) {
              if (g.jid && g.name) nameMap.set(g.jid, g.name);
            }

            for (const conv of convs) {
              const name = nameMap.get(conv.remote_jid);
              if (name) {
                await query(`UPDATE conversations SET group_name = $1, contact_name = $1 WHERE id = $2`, [name, conv.id]);
                updated++;
              }
            }
          }
        } else if ((connection.provider === 'evolution' || !connection.provider) && connection.instance_name) {
          // For Evolution API - try fetching group info
          const baseUrl = process.env.EVOLUTION_API_URL;
          const apiKey = connection.api_key || process.env.EVOLUTION_API_KEY;
          if (baseUrl && apiKey) {
            for (const conv of convs) {
              try {
                const resp = await fetch(`${baseUrl}/group/findGroupInfos/${connection.instance_name}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', apikey: apiKey },
                  body: JSON.stringify({ groupJid: conv.remote_jid }),
                });
                if (resp.ok) {
                  const info = await resp.json();
                  const name = info?.subject || info?.name;
                  if (name) {
                    await query(`UPDATE conversations SET group_name = $1, contact_name = $1 WHERE id = $2`, [name, conv.id]);
                    updated++;
                  }
                }
              } catch (e) { /* ignore individual failures */ }
            }
          }
        }
      } catch (e) {
        console.error('[Chat] sync-group-names connection error:', e.message);
      }
    }

    res.json({ updated, total: groups.rows.length });
  } catch (error) {
    console.error('Sync group names error:', error);
    res.status(500).json({ error: 'Erro ao sincronizar nomes dos grupos' });
  }
});

// Get chat statistics
router.get('/stats', authenticate, async (req, res) => {
  try {
    const connectionIds = await getUserConnections(req.userId);
    
    if (connectionIds.length === 0) {
      return res.json({
        total_conversations: 0,
        unread_conversations: 0,
        messages_today: 0,
        messages_week: 0,
        avg_response_time_minutes: null,
        conversations_by_connection: [],
        conversations_by_status: []
      });
    }

    // Total conversations
    const totalResult = await query(
      `SELECT COUNT(*) as count FROM conversations WHERE connection_id = ANY($1) AND is_archived = false`,
      [connectionIds]
    );

    // Unread conversations
    const unreadResult = await query(
      `SELECT COUNT(*) as count FROM conversations WHERE connection_id = ANY($1) AND unread_count > 0 AND is_archived = false`,
      [connectionIds]
    );

    // Messages today
    const todayResult = await query(
      `SELECT COUNT(*) as count FROM chat_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.connection_id = ANY($1) AND m.timestamp >= CURRENT_DATE`,
      [connectionIds]
    );

    // Messages this week
    const weekResult = await query(
      `SELECT COUNT(*) as count FROM chat_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.connection_id = ANY($1) AND m.timestamp >= CURRENT_DATE - INTERVAL '7 days'`,
      [connectionIds]
    );

    // Conversations by connection
    const byConnectionResult = await query(
      `SELECT conn.name as connection_name, COUNT(*) as count
       FROM conversations conv
       JOIN connections conn ON conn.id = conv.connection_id
       WHERE conv.connection_id = ANY($1) AND conv.is_archived = false
       GROUP BY conn.name
       ORDER BY count DESC`,
      [connectionIds]
    );

    // Conversations by status (assigned vs unassigned)
    const byStatusResult = await query(
      `SELECT 
         CASE WHEN assigned_to IS NOT NULL THEN 'assigned' ELSE 'unassigned' END as status,
         COUNT(*) as count
       FROM conversations
       WHERE connection_id = ANY($1) AND is_archived = false
       GROUP BY CASE WHEN assigned_to IS NOT NULL THEN 'assigned' ELSE 'unassigned' END`,
      [connectionIds]
    );

    res.json({
      total_conversations: parseInt(totalResult.rows[0]?.count || 0),
      unread_conversations: parseInt(unreadResult.rows[0]?.count || 0),
      messages_today: parseInt(todayResult.rows[0]?.count || 0),
      messages_week: parseInt(weekResult.rows[0]?.count || 0),
      avg_response_time_minutes: null, // TODO: Calculate this
      conversations_by_connection: byConnectionResult.rows.map(r => ({
        connection_name: r.connection_name,
        count: parseInt(r.count)
      })),
      conversations_by_status: byStatusResult.rows.map(r => ({
        status: r.status,
        count: parseInt(r.count)
      }))
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// Find conversation by phone number
router.get('/conversations/by-phone/:phone', authenticate, async (req, res) => {
  try {
    const { phone } = req.params;
    const connectionIds = await getUserConnections(req.userId);
    
    if (connectionIds.length === 0) {
      return res.status(404).json({ error: 'Nenhuma conexão encontrada' });
    }
    
    // Normalize phone - keep only digits
    const normalizedPhone = String(phone || '').replace(/\D/g, '');
    const needle = normalizedPhone.length > 11 ? normalizedPhone.slice(-11) : normalizedPhone;

    if (!needle) {
      return res.status(400).json({ error: 'Telefone inválido' });
    }
    
    // Search by phone in contact_phone or remote_jid (normalized to digits on the DB side)
    const result = await query(
      `SELECT 
        conv.*,
        conn.name as connection_name,
        conn.phone_number as connection_phone,
        u.name as assigned_name,
        COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
           FROM conversation_tag_links ctl
           JOIN conversation_tags t ON t.id = ctl.tag_id
           WHERE ctl.conversation_id = conv.id
          ), '[]'::json
        ) as tags
      FROM conversations conv
      JOIN connections conn ON conn.id = conv.connection_id
      LEFT JOIN users u ON u.id = conv.assigned_to
      WHERE conv.connection_id = ANY($1)
        AND (
          regexp_replace(COALESCE(conv.contact_phone, ''), '\\D', '', 'g') LIKE '%' || $2 || '%'
          OR regexp_replace(COALESCE(conv.remote_jid, ''), '\\D', '', 'g') LIKE '%' || $2 || '%'
        )
      ORDER BY conv.last_message_at DESC NULLS LAST
      LIMIT 1`,
      [connectionIds, needle]
    );

    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    }

    // Auto-create conversation: find user's first active connection
    const activeConnResult = await query(
      `SELECT c.id FROM connections c
       WHERE c.id = ANY($1) AND (c.status = 'connected' OR c.instance_id IS NOT NULL)
       ORDER BY c.updated_at DESC
       LIMIT 1`,
      [connectionIds]
    );

    if (activeConnResult.rows.length === 0) {
      return res.status(404).json({ error: 'Nenhuma conexão ativa encontrada para criar a conversa' });
    }

    const activeConnectionId = activeConnResult.rows[0].id;
    let createPhone = normalizedPhone;
    if (!createPhone.startsWith('55') && createPhone.length <= 11) {
      createPhone = '55' + createPhone;
    }
    const remoteJid = `${createPhone}@s.whatsapp.net`;

    // Create new conversation assigned to the current user
    const newConv = await query(
      `INSERT INTO conversations 
        (connection_id, remote_jid, contact_phone, contact_name, assigned_to, is_archived, unread_count, attendance_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, 0, 'attending', NOW(), NOW())
       RETURNING *`,
      [activeConnectionId, remoteJid, createPhone, createPhone, req.userId]
    );

    // Try to find contact name from contacts/chat_contacts
    const contactNameResult = await query(
      `SELECT name FROM chat_contacts WHERE regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE '%' || $1 || '%' AND connection_id = $2 LIMIT 1`,
      [needle, activeConnectionId]
    );
    if (contactNameResult.rows.length > 0 && contactNameResult.rows[0].name) {
      await query(
        `UPDATE conversations SET contact_name = $1 WHERE id = $2`,
        [contactNameResult.rows[0].name, newConv.rows[0].id]
      );
    }

    // Return full conversation
    const fullConv = await query(
      `SELECT 
        conv.*,
        conn.name as connection_name,
        conn.phone_number as connection_phone,
        u.name as assigned_name,
        '[]'::json as tags
      FROM conversations conv
      JOIN connections conn ON conn.id = conv.connection_id
      LEFT JOIN users u ON u.id = conv.assigned_to
      WHERE conv.id = $1`,
      [newConv.rows[0].id]
    );

    res.status(201).json(fullConv.rows[0]);
  } catch (error) {
    console.error('Get/create conversation by phone error:', error);
    res.status(500).json({ error: 'Erro ao buscar/criar conversa' });
  }
});

// Get single conversation
router.get('/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    const result = await query(
      `SELECT 
        conv.*,
        conn.name as connection_name,
        conn.phone_number as connection_phone,
        conn.instance_name,
        conn.api_url,
        conn.api_key,
        u.name as assigned_name,
        COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
           FROM conversation_tag_links ctl
           JOIN conversation_tags t ON t.id = ctl.tag_id
           WHERE ctl.conversation_id = conv.id
          ), '[]'::json
        ) as tags
      FROM conversations conv
      JOIN connections conn ON conn.id = conv.connection_id
      LEFT JOIN users u ON u.id = conv.assigned_to
      WHERE conv.id = $1 AND conv.connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Erro ao buscar conversa' });
  }
});

// Update conversation (assign, archive, etc)
router.patch('/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { assigned_to, is_archived } = req.body;

    // Check if user is manager (view-only) - cannot assign or modify conversations
    const userOrg = await getUserOrganization(req.userId);
    if (userOrg && isViewOnlyRole(userOrg.role)) {
      return res.status(403).json({ error: 'Supervisores não podem assumir ou modificar conversas, apenas visualizar' });
    }

    const connectionIds = await getUserConnections(req.userId);

    // Check if conversation belongs to user
    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${paramIndex}`);
      values.push(assigned_to || null);
      paramIndex++;
    }

    if (is_archived !== undefined) {
      updates.push(`is_archived = $${paramIndex}`);
      values.push(is_archived);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhuma atualização fornecida' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query(
      `UPDATE conversations SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update conversation error:', error);
    res.status(500).json({ error: 'Erro ao atualizar conversa' });
  }
});

// Mark conversation as read
router.post('/conversations/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // When marking as read, auto-transition 'waiting' conversations to 'attending'
    // and assign to the current user if not already assigned.
    // This prevents conversations from disappearing when unread_count reaches 0
    // while still in 'waiting' status (which is filtered out of the 'Atendendo' tab).
    await query(
      `UPDATE conversations 
       SET unread_count = 0, 
           updated_at = NOW(),
           attendance_status = CASE 
             WHEN attendance_status = 'waiting' THEN 'attending' 
             ELSE attendance_status 
           END,
           accepted_at = CASE 
             WHEN attendance_status = 'waiting' AND accepted_at IS NULL THEN NOW() 
             ELSE accepted_at 
           END,
           accepted_by = CASE 
             WHEN attendance_status = 'waiting' AND accepted_by IS NULL THEN $2 
             ELSE accepted_by 
           END,
           assigned_to = CASE 
             WHEN attendance_status = 'waiting' AND assigned_to IS NULL THEN $2 
             ELSE assigned_to 
           END
       WHERE id = $1`,
      [id, req.userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Erro ao marcar como lida' });
  }
});

// Pin/Unpin conversation
router.post('/conversations/:id/pin', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { pinned } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    // Check if conversation belongs to user
    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    await query(
      `UPDATE conversations SET is_pinned = $1, updated_at = NOW() WHERE id = $2`,
      [pinned, id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Pin conversation error:', error);
    res.status(500).json({ error: 'Erro ao fixar conversa' });
  }
});

// Favorite/Unfavorite conversation
router.post('/conversations/:id/favorite', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { favorite } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    await query(
      `UPDATE conversations SET is_favorite = COALESCE($1, false), updated_at = NOW() WHERE id = $2`,
      [favorite, id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Favorite conversation error:', error);
    res.status(500).json({ error: 'Erro ao favoritar conversa' });
  }
});

// Mute/Unmute conversation (silences push notifications)
router.post('/conversations/:id/mute', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { muted } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    await query(
      `UPDATE conversations SET is_muted = COALESCE($1, false), updated_at = NOW() WHERE id = $2`,
      [!!muted, id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Mute conversation error:', error);
    res.status(500).json({ error: 'Erro ao silenciar conversa' });
  }
});

// Pin/Unpin a message in a conversation
router.post('/conversations/:id/pin-message', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { message_id } = req.body; // null to unpin
    const connectionIds = await getUserConnections(req.userId);

    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    if (message_id) {
      // Verify message belongs to this conversation
      const msgCheck = await query(
        `SELECT id FROM chat_messages WHERE id = $1 AND conversation_id = $2`,
        [message_id, id]
      );
      if (msgCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Mensagem não encontrada' });
      }
    }

    await query(
      `UPDATE conversations SET pinned_message_id = $1, updated_at = NOW() WHERE id = $2`,
      [message_id || null, id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Pin message error:', error);
    // If column doesn't exist, add it
    if (/pinned_message_id/i.test(String(error?.message || ''))) {
      try {
        await query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL`);
        await query(`UPDATE conversations SET pinned_message_id = $1, updated_at = NOW() WHERE id = $2`, [req.body.message_id || null, req.params.id]);
        return res.json({ success: true });
      } catch (e2) {
        console.error('Failed to add pinned_message_id column:', e2);
      }
    }
    res.status(500).json({ error: 'Erro ao fixar mensagem' });
  }
});


router.post('/conversations/:id/accept', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    // Check if conversation belongs to user's connections
    const check = await query(
      `SELECT id, attendance_status FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Update to attending status
    const result = await query(
      `UPDATE conversations 
       SET attendance_status = 'attending', 
           accepted_at = NOW(), 
           accepted_by = $1,
           assigned_to = COALESCE(assigned_to, $1),
           updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [req.userId, id]
    );

    res.json({ success: true, conversation: result.rows[0] });
  } catch (error) {
    console.error('Accept conversation error:', error);
    res.status(500).json({ error: 'Erro ao aceitar conversa' });
  }
});

// Release conversation (move back to waiting)
router.post('/conversations/:id/release', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    // Check if conversation belongs to user's connections
    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Update to waiting status and unarchive if archived
    const result = await query(
      `UPDATE conversations 
       SET attendance_status = 'waiting', 
           accepted_at = NULL, 
           accepted_by = NULL,
           assigned_to = NULL,
           is_archived = false,
           updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    res.json({ success: true, conversation: result.rows[0] });
  } catch (error) {
    console.error('Release conversation error:', error);
    res.status(500).json({ error: 'Erro ao liberar conversa' });
  }
});

// Finish conversation (move to finished status)
router.post('/conversations/:id/finish', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    // Check if conversation belongs to user's connections
    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Update to finished status (don't use finished_at/finished_by columns - may not exist)
    const result = await query(
      `UPDATE conversations 
       SET attendance_status = 'finished', 
           updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    res.json({ success: true, conversation: result.rows[0] });
  } catch (error) {
    console.error('Finish conversation error:', error);
    res.status(500).json({ error: 'Erro ao finalizar conversa' });
  }
});

// Reopen finished conversation (move back to waiting for new flow)
router.post('/conversations/:id/reopen', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    // Check if conversation belongs to user's connections
    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Update to waiting status (back to queue for chatbot flow)
    // Don't use finished_at/finished_by columns - may not exist yet
    const result = await query(
      `UPDATE conversations 
       SET attendance_status = 'waiting', 
           accepted_at = NULL, 
           accepted_by = NULL,
           assigned_to = NULL,
           is_archived = false,
           updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    res.json({ success: true, conversation: result.rows[0] });
  } catch (error) {
    console.error('Reopen conversation error:', error);
    res.status(500).json({ error: 'Erro ao reabrir conversa' });
  }
});

// Update conversation department
router.patch('/conversations/:id/department', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { department_id } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    // Check if conversation belongs to user's connections
    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const result = await query(
      `UPDATE conversations 
       SET department_id = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [department_id || null, id]
    );

    res.json({ success: true, conversation: result.rows[0] });
  } catch (error) {
    console.error('Update department error:', error);
    res.status(500).json({ error: 'Erro ao atualizar departamento' });
  }
});

// Remove conversation department
router.delete('/conversations/:id/department', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    // Check if conversation belongs to user's connections
    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const result = await query(
      `UPDATE conversations 
       SET department_id = NULL, updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    res.json({ success: true, conversation: result.rows[0] });
  } catch (error) {
    console.error('Remove department error:', error);
    res.status(500).json({ error: 'Erro ao remover departamento' });
  }
});

// Delete conversation (Admin only)
router.delete('/conversations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { keep_contact } = req.query;
    const connectionIds = await getUserConnections(req.userId);

    // Check if user is admin/owner in their organization
    const roleCheck = await query(
      `SELECT om.role FROM organization_members om WHERE om.user_id = $1`,
      [req.userId]
    );

    const userRole = roleCheck.rows[0]?.role;
    if (!userRole || !['owner', 'admin'].includes(userRole)) {
      return res.status(403).json({ error: 'Apenas administradores podem excluir conversas' });
    }

    // Get conversation details before deleting
    const convResult = await query(
      `SELECT id, connection_id, contact_name, contact_phone, remote_jid 
       FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const conv = convResult.rows[0];

    // If keep_contact is true, save contact before deleting
    if (keep_contact === 'true' && conv.contact_phone) {
      // Find or create a contact list for this connection
      let listResult = await query(
        `SELECT id FROM contact_lists WHERE connection_id = $1 AND name = 'Contatos Salvos' LIMIT 1`,
        [conv.connection_id]
      );

      let listId;
      if (listResult.rows.length === 0) {
        // Create a default list for saved contacts
        const newList = await query(
          `INSERT INTO contact_lists (user_id, name, connection_id) VALUES ($1, 'Contatos Salvos', $2) RETURNING id`,
          [req.userId, conv.connection_id]
        );
        listId = newList.rows[0].id;
      } else {
        listId = listResult.rows[0].id;
      }

      // Check if contact already exists
      const existingContact = await query(
        `SELECT id FROM contacts WHERE list_id = $1 AND phone = $2`,
        [listId, conv.contact_phone.replace(/\D/g, '')]
      );

      if (existingContact.rows.length === 0) {
        // Add contact to list
        await query(
          `INSERT INTO contacts (list_id, name, phone) VALUES ($1, $2, $3)`,
          [listId, conv.contact_name || conv.contact_phone, conv.contact_phone.replace(/\D/g, '')]
        );
      }
    }

    // Delete related records first
    await query(`DELETE FROM conversation_notes WHERE conversation_id = $1`, [id]);
    await query(`DELETE FROM conversation_tag_links WHERE conversation_id = $1`, [id]);
    await query(`DELETE FROM chat_messages WHERE conversation_id = $1`, [id]);
    await query(`DELETE FROM conversations WHERE id = $1`, [id]);

    res.json({ success: true, contact_saved: keep_contact === 'true' });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ error: 'Erro ao excluir conversa' });
  }
});

// Clean up duplicate @lid conversations (Admin only)
router.post('/conversations/cleanup-duplicates', authenticate, async (req, res) => {
  try {
    // Check if user is admin/owner
    const roleCheck = await query(
      `SELECT om.role FROM organization_members om WHERE om.user_id = $1`,
      [req.userId]
    );

    const userRole = roleCheck.rows[0]?.role;
    if (!userRole || !['owner', 'admin'].includes(userRole)) {
      return res.status(403).json({ error: 'Apenas administradores podem executar esta ação' });
    }

    const connectionIds = await getUserConnections(req.userId);
    
    if (connectionIds.length === 0) {
      return res.json({ deleted: 0, message: 'Nenhuma conexão encontrada' });
    }

    // Find and delete conversations with @lid that have duplicates with @s.whatsapp.net
    const duplicates = await query(`
      WITH lid_conversations AS (
        SELECT id, contact_phone, connection_id, remote_jid,
               (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = conversations.id) as msg_count
        FROM conversations 
        WHERE connection_id = ANY($1)
          AND remote_jid LIKE '%@lid'
      ),
      normal_conversations AS (
        SELECT contact_phone, connection_id
        FROM conversations 
        WHERE connection_id = ANY($1)
          AND remote_jid LIKE '%@s.whatsapp.net'
      )
      SELECT lc.id, lc.contact_phone, lc.remote_jid, lc.msg_count
      FROM lid_conversations lc
      INNER JOIN normal_conversations nc 
        ON lc.contact_phone = nc.contact_phone 
        AND lc.connection_id = nc.connection_id
    `, [connectionIds]);

    const toDelete = duplicates.rows.filter(r => r.msg_count === 0);
    
    for (const conv of toDelete) {
      await query(`DELETE FROM conversation_notes WHERE conversation_id = $1`, [conv.id]);
      await query(`DELETE FROM conversation_tag_links WHERE conversation_id = $1`, [conv.id]);
      await query(`DELETE FROM chat_messages WHERE conversation_id = $1`, [conv.id]);
      await query(`DELETE FROM conversations WHERE id = $1`, [conv.id]);
    }

    // For @lid conversations that have messages but a normal duplicate exists, merge them
    const toMerge = duplicates.rows.filter(r => r.msg_count > 0);
    let merged = 0;

    for (const lidConv of toMerge) {
      // Find the normal conversation
      const normalConv = await query(`
        SELECT id FROM conversations 
        WHERE connection_id = (SELECT connection_id FROM conversations WHERE id = $1)
          AND contact_phone = $2
          AND remote_jid LIKE '%@s.whatsapp.net'
        LIMIT 1
      `, [lidConv.id, lidConv.contact_phone]);

      if (normalConv.rows.length > 0) {
        const normalId = normalConv.rows[0].id;
        
        // Move messages to normal conversation
        await query(`
          UPDATE chat_messages SET conversation_id = $1 
          WHERE conversation_id = $2
        `, [normalId, lidConv.id]);
        
        // Move notes
        await query(`
          UPDATE conversation_notes SET conversation_id = $1 
          WHERE conversation_id = $2
        `, [normalId, lidConv.id]);
        
        // Delete the @lid conversation
        await query(`DELETE FROM conversation_tag_links WHERE conversation_id = $1`, [lidConv.id]);
        await query(`DELETE FROM conversations WHERE id = $1`, [lidConv.id]);
        
        merged++;
      }
    }

    res.json({ 
      deleted: toDelete.length, 
      merged,
      message: `${toDelete.length} conversas vazias removidas, ${merged} conversas mescladas` 
    });
  } catch (error) {
    console.error('Cleanup duplicates error:', error);
    res.status(500).json({ error: 'Erro ao limpar duplicatas' });
  }
});

// Clean up empty conversations (no messages) - Admin only
router.post('/conversations/cleanup-empty', authenticate, async (req, res) => {
  try {
    // Check if user is admin/owner
    const memberResult = await query(
      `SELECT om.role FROM organization_members om WHERE om.user_id = $1 LIMIT 1`,
      [req.userId]
    );
    
    const userRole = memberResult.rows[0]?.role;
    if (!userRole || !['owner', 'admin'].includes(userRole)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const connectionIds = await getUserConnections(req.userId);
    
    if (connectionIds.length === 0) {
      return res.json({ deleted: 0, message: 'Nenhuma conexão encontrada' });
    }

    // Find and delete conversations with no messages
    const result = await query(`
      DELETE FROM conversations
      WHERE connection_id = ANY($1)
        AND id NOT IN (
          SELECT DISTINCT conversation_id FROM chat_messages WHERE conversation_id IS NOT NULL
        )
      RETURNING id, contact_name, contact_phone
    `, [connectionIds]);

    console.log(`Cleaned up ${result.rows.length} empty conversations`);

    res.json({
      deleted: result.rows.length,
      conversations: result.rows,
      message: `${result.rows.length} conversa(s) vazia(s) removida(s)`
    });
  } catch (error) {
    console.error('Cleanup empty conversations error:', error);
    res.status(500).json({ error: 'Erro ao limpar conversas vazias' });
  }
});

// ==========================================
// MESSAGES
// ==========================================

// Get messages for a conversation
router.get('/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
     const { limit = 50, before, days } = req.query;
    const connectionIds = await getUserConnections(req.userId);

    // Check access
    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    let sql = `
      SELECT 
        m.*,
        COALESCE(m.sender_name, u.name) as sender_name,
        m.sender_phone,
        qm.content as quoted_content,
        qm.message_type as quoted_message_type,
        qm.from_me as quoted_from_me,
        COALESCE(qm.sender_name, qu.name) as quoted_sender_name
      FROM chat_messages m
      LEFT JOIN users u ON u.id = m.sender_id
      LEFT JOIN chat_messages qm ON qm.id = m.quoted_message_id
      LEFT JOIN users qu ON qu.id = qm.sender_id
      WHERE m.conversation_id = $1
    `;
    const params = [id];
    let paramIndex = 2;

      if (before) {
        sql += ` AND m.timestamp < $${paramIndex}`;
        params.push(before);
        paramIndex++;
      } else if (days && parseInt(days) > 0) {
        // If days is provided, we filter messages from the last N days
        sql += ` AND m.timestamp >= NOW() - ($${paramIndex} || ' days')::interval`;
        params.push(parseInt(days));
        paramIndex++;
      }

    sql += ` ORDER BY m.timestamp DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const result = await query(sql, params);
    
    // Return in chronological order
    res.json(result.rows.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

// Send message (optimistic: save DB first, send to WhatsApp async)
router.post('/conversations/:id/messages', authenticate, async (req, res) => {
  try {
    // Check if user is manager (view-only) - cannot send messages
    const userOrg = await getUserOrganization(req.userId);
    if (userOrg && isViewOnlyRole(userOrg.role)) {
      return res.status(403).json({ error: 'Supervisores não podem enviar mensagens, apenas visualizar' });
    }

    const { id } = req.params;
    const { content, message_type = 'text', media_url, media_mimetype, quoted_message_id, filename, duration } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    // Get conversation with connection details (including W-API, UAZAPI and Meta fields)
    const convResult = await query(
      `SELECT 
        conv.*,
        conn.api_url,
        conn.api_key,
        conn.instance_name,
        conn.provider,
        conn.instance_id,
        conn.wapi_token,
        conn.uazapi_url,
        conn.uazapi_token,
        conn.meta_token,
        conn.meta_phone_number_id,
        conn.meta_waba_id,
        conn.phone_number,
        conn.status as connection_status
      FROM conversations conv
      JOIN connections conn ON conn.id = conv.connection_id
      WHERE conv.id = $1 AND conv.connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const conversation = convResult.rows[0];

    // For W-API/UAZAPI, tolerate stale DB status and fall back to live status check.
    const provider = whatsappProvider.detectProvider(conversation);
    const isConnected = conversation.connection_status === 'connected' || 
      (provider === 'wapi' && conversation.instance_id && conversation.wapi_token) ||
      (provider === 'uazapi' && (conversation.instance_id || (conversation.uazapi_url && conversation.uazapi_token)));

    let resolvedConnected = Boolean(isConnected);

    if (!resolvedConnected) {
      try {
        const liveStatus = await whatsappProvider.checkStatus(conversation);
        const rawStatus = liveStatus?.status || 'disconnected';
        const phoneNumber = liveStatus?.phoneNumber || conversation.phone_number || null;
        const resolvedStatus =
          conversation.connection_status === 'connected' && rawStatus === 'disconnected' && liveStatus?.transient
            ? 'connected'
            : rawStatus;

        if (conversation.connection_status !== resolvedStatus || conversation.phone_number !== phoneNumber) {
          await query(
            'UPDATE connections SET status = $1, phone_number = $2, updated_at = NOW() WHERE id = $3',
            [resolvedStatus, phoneNumber, conversation.connection_id]
          );
        }

        resolvedConnected =
          resolvedStatus === 'connected' ||
          (provider === 'wapi' && conversation.instance_id && conversation.wapi_token) ||
          (provider === 'uazapi' && (conversation.instance_id || (conversation.uazapi_url && conversation.uazapi_token)));
      } catch (statusError) {
        console.warn('[Chat] Live status check failed during send:', statusError?.message || statusError);
      }
    }

    if (!resolvedConnected) {
      return res.status(400).json({ error: 'Conexão não está ativa' });
    }

    // ============================================================
    // OPTIMISTIC: Save message to DB first with status='pending'
    // Generate a temporary UUID to help webhook de-duplicate
    // ============================================================
    const tempMessageId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const chatMessagesHasConnectionId = await hasColumn('chat_messages', 'connection_id');
    let messageResult;

    if (chatMessagesHasConnectionId) {
      messageResult = await query(
        `INSERT INTO chat_messages 
          (conversation_id, message_id, from_me, sender_id, content, message_type, media_url, media_mimetype, quoted_message_id, status, timestamp, connection_id)
         VALUES ($1, $2, true, $3, $4, $5, $6, $7, $8, 'pending', NOW(), $9)
         RETURNING *`,
        [
          id,
          tempMessageId,
          req.userId,
          content,
          message_type,
          media_url || null,
          media_mimetype || null,
          quoted_message_id || null,
          conversation.connection_id
        ]
      );
    } else {
      messageResult = await query(
        `INSERT INTO chat_messages 
          (conversation_id, message_id, from_me, sender_id, content, message_type, media_url, media_mimetype, quoted_message_id, status, timestamp)
         VALUES ($1, $2, true, $3, $4, $5, $6, $7, $8, 'pending', NOW())
         RETURNING *`,
        [
          id,
          tempMessageId,
          req.userId,
          content,
          message_type,
          media_url || null,
          media_mimetype || null,
          quoted_message_id || null,
        ]
      );
    }

    const savedMessage = messageResult.rows[0];

    // Update conversation last_message_at immediately
    // Also auto-accept if conversation is in 'waiting' status
    await query(
      `UPDATE conversations 
       SET last_message_at = NOW(), 
           updated_at = NOW(),
           attendance_status = CASE WHEN attendance_status = 'waiting' THEN 'attending' ELSE attendance_status END,
           accepted_by = CASE WHEN attendance_status = 'waiting' THEN $2::uuid ELSE accepted_by END,
           accepted_at = CASE WHEN attendance_status = 'waiting' THEN NOW() ELSE accepted_at END,
           assigned_to = CASE WHEN attendance_status = 'waiting' THEN $2::uuid ELSE assigned_to END
       WHERE id = $1`,
      [id, req.userId]
    );

    const sendSavedMessageToWhatsapp = async () => {
      try {
        // IMPORTANT: groups must keep the full JID (@g.us). If we strip it,
        // providers will send to an invalid destination.
        const isGroup = String(conversation.remote_jid || '').includes('@g.us') || conversation.is_group === true;
        let to;
        if (isGroup) {
          to = conversation.remote_jid;
        } else {
          // For @lid JIDs, use contact_phone instead (the @lid ID is not a real phone number)
          const jid = String(conversation.remote_jid || '');
          if (jid.includes('@lid') && conversation.contact_phone) {
            to = conversation.contact_phone;
          } else {
            to = jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '');
          }
        }

        // Parse interactive menu content for clean display in local DB
        let cleanContent = content;
        if (message_type === 'interactive_menu') {
          try {
            const data = typeof content === 'string' ? JSON.parse(content) : content;
            if (data && data.text) {
              cleanContent = data.text;
              if (data.footer) cleanContent += `\n_${data.footer}_`;
            }
          } catch (e) {}
        }

        // Use unified provider to send message
        const result = await whatsappProvider.sendMessage(
          conversation,
          to,
          content,
          message_type,
          media_url,
          filename,
          duration,
          media_mimetype
        );

        if (result.success) {
          // Update message with provider message_id, status='sent' and clean content
          const sentUpdate = await query(
            `UPDATE chat_messages
             SET message_id = COALESCE($1, message_id),
                 status = 'sent',
                 content = $3,
                 error_message = NULL
             WHERE id = $2
             RETURNING *`,
            [result.messageId || null, savedMessage.id, cleanContent]
          );
          return { success: true, message: sentUpdate.rows[0] || savedMessage };
        } else {
          throw new Error(result.error || 'Falha ao enviar mensagem');
        }
      } catch (bgError) {
        console.error('Background send error:', bgError.message);
        // Mark as failed so UI can show error state, include error message for diagnostics
        const failedUpdate = await query(
          `UPDATE chat_messages SET status = 'failed', error_message = $2 WHERE id = $1 RETURNING *`,
          [savedMessage.id, bgError.message || 'Erro desconhecido']
        ).catch(() => {});
        return {
          success: false,
          error: bgError.message || 'Erro desconhecido',
          message: failedUpdate?.rows?.[0] || savedMessage,
        };
      }
    };

    // ============================================================
    // PAUSE AI AGENT: When a human sends a message, pause the AI
    // so it doesn't respond on top of the human agent
    // ============================================================
    pauseSessionForHumanReply(id).catch(err => {
      console.error('Error pausing AI agent session:', err.message);
    });

    const shouldWaitForProvider = Boolean(media_url) && ['image', 'video', 'audio', 'document', 'sticker', 'gif', 'ptv'].includes(String(message_type || '').toLowerCase());

    if (shouldWaitForProvider) {
      const sendResult = await sendSavedMessageToWhatsapp();
      if (sendResult.success) {
        return res.status(201).json(sendResult.message || savedMessage);
      }

      return res.status(502).json({
        error: sendResult.error || 'Falha ao enviar mídia para o WhatsApp',
        message: sendResult.message || savedMessage,
      });
    }

    // ============================================================
    // Return response immediately for text/interactive messages (optimistic)
    // ============================================================
    res.status(201).json(savedMessage);

    // ============================================================
    // ASYNC: Send to WhatsApp via unified provider (Evolution or W-API)
    // ============================================================
    sendSavedMessageToWhatsapp();
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: error.message || 'Erro ao enviar mensagem' });
  }
});

// Send Meta template message
router.post('/conversations/:id/send-template', authenticate, async (req, res) => {
  try {
    const userOrg = await getUserOrganization(req.userId);
    if (userOrg && isViewOnlyRole(userOrg.role)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { id } = req.params;
    const { template_name, language, components, param_values } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    const convResult = await query(
      `SELECT conv.*, conn.meta_token, conn.meta_phone_number_id, conn.meta_waba_id, conn.provider, conn.status as connection_status
       FROM conversations conv
       JOIN connections conn ON conn.id = conv.connection_id
       WHERE conv.id = $1 AND conv.connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const conversation = convResult.rows[0];

    if (conversation.provider !== 'meta') {
      return res.status(400).json({ error: 'Templates só podem ser enviados em conexões Meta' });
    }

    if (!conversation.meta_token || !conversation.meta_phone_number_id) {
      return res.status(400).json({ error: 'Token ou Phone Number ID não configurados' });
    }

    const cleanPhone = String(conversation.contact_phone || conversation.remote_jid || '').replace(/\D/g, '');
    if (!cleanPhone) {
      return res.status(400).json({ error: 'Telefone do contato não encontrado' });
    }

    // Build template components with parameter values
    const templateComponents = [];
    const bodyComp = (components || []).find(c => (c.type || '').toUpperCase() === 'BODY');
    const headerComp = (components || []).find(c => (c.type || '').toUpperCase() === 'HEADER');
    const buttonsComps = (components || []).filter(c => (c.type || '').toUpperCase() === 'BUTTONS');

    // Handle header component
    if (headerComp) {
      const headerFormat = (headerComp.format || '').toUpperCase();
      if (headerFormat === 'IMAGE' || headerFormat === 'VIDEO' || headerFormat === 'DOCUMENT') {
        // Media header — check if param_values has a media URL
        const mediaUrl = (param_values || {})['{{header_media}}'] || (param_values || {})['header_media'];
        if (mediaUrl) {
          const mediaType = headerFormat.toLowerCase();
          templateComponents.push({
            type: 'header',
            parameters: [{ type: mediaType, [mediaType]: { link: mediaUrl } }],
          });
        }
      } else if (headerComp.text) {
        const headerParams = (headerComp.text.match(/\{\{(\d+)\}\}/g) || []);
        if (headerParams.length > 0) {
          templateComponents.push({
            type: 'header',
            parameters: headerParams.map(p => ({
              type: 'text',
              text: String((param_values || {})[p] || '').trim() || ' ',
            })),
          });
        }
      }
    }

    // Handle body component
    if (bodyComp?.text) {
      const bodyParams = (bodyComp.text.match(/\{\{(\d+)\}\}/g) || []);
      if (bodyParams.length > 0) {
        templateComponents.push({
          type: 'body',
          parameters: bodyParams.map(p => ({
            type: 'text',
            text: String((param_values || {})[p] || '').trim() || ' ',
          })),
        });
      }
    }

    // Handle button URL parameters (e.g. {{1}} in button URLs)
    for (const btnComp of buttonsComps) {
      const buttons = btnComp.buttons || [];
      buttons.forEach((btn, idx) => {
        if (btn.type === 'URL' && btn.url && btn.url.includes('{{')) {
          const btnParamValue = (param_values || {})[`{{button_${idx}}}`] || (param_values || {})[`button_${idx}`];
          if (btnParamValue) {
            templateComponents.push({
              type: 'button',
              sub_type: 'url',
              index: String(idx),
              parameters: [{ type: 'text', text: String(btnParamValue).trim() }],
            });
          }
        }
      });
    }

    // Send template via Meta API
    const metaBody = {
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'template',
      template: {
        name: template_name,
        language: { code: language || 'pt_BR' },
        ...(templateComponents.length > 0 ? { components: templateComponents } : {}),
      },
    };

    console.log('[Template Send] Payload:', JSON.stringify(metaBody, null, 2));

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${conversation.meta_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${conversation.meta_token}`,
        },
        body: JSON.stringify(metaBody),
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const metaErr = result?.error || {};
      const errorMsg = metaErr.error_user_msg || metaErr.message || `HTTP ${response.status}`;
      console.error('Meta template send error:', { status: response.status, metaBody, metaError: metaErr });
      return res.status(response.status).json({ error: errorMsg, meta_error_code: metaErr.code, meta_error_subcode: metaErr.error_subcode });
    }

    const metaMessageId = result?.messages?.[0]?.id || `template_${Date.now()}`;

    // Build readable content from template
    let readableContent = bodyComp?.text || template_name;
    if (param_values) {
      Object.entries(param_values).forEach(([key, value]) => {
        readableContent = readableContent.replace(key, value);
      });
    }

    // Save to DB
    const messageResult = await query(
      `INSERT INTO chat_messages 
        (conversation_id, message_id, from_me, sender_id, content, message_type, status, timestamp)
       VALUES ($1, $2, true, $3, $4, 'text', 'sent', NOW())
       RETURNING *`,
      [id, metaMessageId, req.userId, `📋 ${readableContent}`]
    );

    // Update conversation
    await query(
      `UPDATE conversations 
       SET last_message_at = NOW(), updated_at = NOW(),
           attendance_status = CASE WHEN attendance_status = 'waiting' THEN 'attending' ELSE attendance_status END,
           accepted_by = CASE WHEN attendance_status = 'waiting' THEN $2::uuid ELSE accepted_by END,
           accepted_at = CASE WHEN attendance_status = 'waiting' THEN NOW() ELSE accepted_at END,
           assigned_to = CASE WHEN attendance_status = 'waiting' THEN $2::uuid ELSE assigned_to END
       WHERE id = $1`,
      [id, req.userId]
    );

    res.status(201).json(messageResult.rows[0]);
  } catch (error) {
    console.error('Send template error:', error);
    res.status(500).json({ error: error.message || 'Erro ao enviar template' });
  }
});

// Edit a message (text only, from_me only)
router.patch('/conversations/:id/messages/:messageId', authenticate, async (req, res) => {
  try {
    const userOrg = await getUserOrganization(req.userId);
    if (userOrg && isViewOnlyRole(userOrg.role)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { id, messageId } = req.params;
    const { content } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Conteúdo é obrigatório' });
    }

    // Get message + connection info
    const msgResult = await query(
      `SELECT m.*, conv.remote_jid, conv.is_group, conv.contact_phone,
              conn.provider, conn.instance_id, conn.wapi_token, conn.api_url, conn.api_key, conn.instance_name,
              conn.meta_token, conn.meta_phone_number_id, conn.uazapi_url, conn.uazapi_token
       FROM chat_messages m
       JOIN conversations conv ON conv.id = m.conversation_id
       JOIN connections conn ON conn.id = conv.connection_id
       WHERE m.id = $1 AND m.conversation_id = $2 AND conv.connection_id = ANY($3)
         AND m.from_me = true AND m.message_type = 'text' AND COALESCE(m.is_deleted, false) = false`,
      [messageId, id, connectionIds]
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Mensagem não encontrada ou não editável' });
    }

    const msg = msgResult.rows[0];

    const previousContent = msg.content || '';
    const phone = msg.is_group ? msg.remote_jid : (msg.contact_phone || msg.remote_jid?.replace('@s.whatsapp.net', '').replace('@c.us', ''));

    // Sempre confirmar no WhatsApp antes de marcar como editado localmente.
    // Caso contrário, o chat mostra "editado" mas a mensagem segue intacta no WhatsApp.
    const editResult = await whatsappProvider.editMessage(msg, phone, msg.message_id, content.trim(), {
      originalText: previousContent,
    });

    if (!editResult?.success) {
      console.error('[chat.edit] Provider edit failed:', editResult?.error, 'provider=', msg.provider, 'message_id=', msg.message_id);
      return res.status(400).json({ error: editResult?.error || 'Falha ao editar mensagem no WhatsApp' });
    }

    await query(
      `UPDATE chat_messages
       SET content = $1,
           is_edited = true,
           message_id = COALESCE($3, message_id)
       WHERE id = $2`,
      [content.trim(), messageId, editResult.messageId || null]
    );

    return res.json({ success: true, messageId: editResult.messageId || msg.message_id });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Erro ao editar mensagem' });
  }
});

// Delete/revoke a message (from_me only)
router.delete('/conversations/:id/messages/:messageId', authenticate, async (req, res) => {
  try {
    const userOrg = await getUserOrganization(req.userId);
    if (userOrg && isViewOnlyRole(userOrg.role)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }

    const { id, messageId } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    const msgResult = await query(
      `SELECT m.*, conv.remote_jid, conv.is_group, conv.contact_phone,
              conn.provider, conn.instance_id, conn.wapi_token, conn.api_url, conn.api_key, conn.instance_name,
              conn.meta_token, conn.meta_phone_number_id,
              conn.uazapi_url, conn.uazapi_token
       FROM chat_messages m
       JOIN conversations conv ON conv.id = m.conversation_id
       JOIN connections conn ON conn.id = conv.connection_id
       WHERE m.id = $1 AND m.conversation_id = $2 AND conv.connection_id = ANY($3)
         AND m.from_me = true AND COALESCE(m.is_deleted, false) = false`,
      [messageId, id, connectionIds]
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Mensagem não encontrada' });
    }

    const msg = msgResult.rows[0];

    // Apaga primeiro no WhatsApp para garantir que o estado local reflita o real.
    const phone = msg.is_group ? msg.remote_jid : (msg.contact_phone || msg.remote_jid?.replace('@s.whatsapp.net', '').replace('@c.us', ''));
    let waResult = { success: false, error: 'Provider não suportado' };
    try {
      waResult = await whatsappProvider.deleteMessage(msg, phone, msg.message_id, {
        originalText: msg.content || msg.message_content || '',
      });
    } catch (err) {
      console.error('Delete message on WhatsApp error:', err.message);
      waResult = { success: false, error: err.message };
    }

    if (!waResult?.success) {
      return res.status(400).json({
        error: waResult?.error || 'Falha ao apagar no WhatsApp',
      });
    }

    // Marca como apagada no banco apenas após sucesso no WhatsApp
    await query(
      `UPDATE chat_messages SET is_deleted = true WHERE id = $1`,
      [messageId]
    );

    res.json({ success: true, warning: waResult?.warning });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Erro ao apagar mensagem' });
  }
});

// ==========================================
// TAGS
// ==========================================

// Get all tags
router.get('/tags', authenticate, async (req, res) => {
  try {
    const userOrg = await getUserOrganization(req.userId);
    const organizationId = userOrg?.organization_id;
    
    if (!organizationId) {
      return res.json([]);
    }

    const result = await query(
      `SELECT * FROM conversation_tags WHERE organization_id = $1 ORDER BY name`,
      [organizationId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ error: 'Erro ao buscar tags' });
  }
});

// Get all tags with conversation count
router.get('/tags/with-count', authenticate, async (req, res) => {
  try {
    const userOrg = await getUserOrganization(req.userId);
    const organizationId = userOrg?.organization_id;
    
    if (!organizationId) {
      return res.json([]);
    }

    const result = await query(
      `SELECT t.*, 
        COALESCE(
          (SELECT COUNT(*) FROM conversation_tag_links ctl WHERE ctl.tag_id = t.id),
          0
        )::int as conversation_count
       FROM conversation_tags t
       WHERE t.organization_id = $1 
       ORDER BY t.name`,
      [organizationId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get tags with count error:', error);
    res.status(500).json({ error: 'Erro ao buscar tags' });
  }
});

// Update tag
router.patch('/tags/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;
    const userOrg = await getUserOrganization(req.userId);
    const organizationId = userOrg?.organization_id;

    if (!organizationId) {
      return res.status(400).json({ error: 'Usuário não pertence a uma organização' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name) {
      updates.push(`name = $${paramIndex}`);
      values.push(name);
      paramIndex++;
    }
    if (color) {
      updates.push(`color = $${paramIndex}`);
      values.push(color);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhuma atualização fornecida' });
    }

    values.push(id, organizationId);

    const result = await query(
      `UPDATE conversation_tags SET ${updates.join(', ')} 
       WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update tag error:', error);
    res.status(500).json({ error: 'Erro ao atualizar tag' });
  }
});

// Create tag
router.post('/tags', authenticate, async (req, res) => {
  try {
    const { name, color = '#6366f1' } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nome da tag é obrigatório' });
    }
    
    const userOrg = await getUserOrganization(req.userId);
    const organizationId = userOrg?.organization_id;
    console.log('Create tag - userId:', req.userId, 'orgId:', organizationId, 'name:', name);

    if (!organizationId) {
      return res.status(400).json({ error: 'Usuário não pertence a uma organização' });
    }

    const result = await query(
      `INSERT INTO conversation_tags (organization_id, name, color)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, name) DO UPDATE SET color = $3
       RETURNING *`,
      [organizationId, name.trim(), color]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create tag error:', error);
    res.status(500).json({ error: 'Erro ao criar tag', details: error.message });
  }
});

// Delete tag
router.delete('/tags/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userOrg = await getUserOrganization(req.userId);
    const organizationId = userOrg?.organization_id;

    if (!organizationId) {
      return res.status(400).json({ error: 'Usuário não pertence a uma organização' });
    }

    await query(
      `DELETE FROM conversation_tags WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Delete tag error:', error);
    res.status(500).json({ error: 'Erro ao deletar tag' });
  }
});

// Add tag to conversation
router.post('/conversations/:id/tags', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { tag_id } = req.body;

    await query(
      `INSERT INTO conversation_tag_links (conversation_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id, tag_id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Add tag error:', error);
    res.status(500).json({ error: 'Erro ao adicionar tag' });
  }
});

// Remove tag from conversation
router.delete('/conversations/:id/tags/:tagId', authenticate, async (req, res) => {
  try {
    const { id, tagId } = req.params;

    await query(
      `DELETE FROM conversation_tag_links WHERE conversation_id = $1 AND tag_id = $2`,
      [id, tagId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Remove tag error:', error);
    res.status(500).json({ error: 'Erro ao remover tag' });
  }
});

// ==========================================
// TEAM MEMBERS (for assignment)
// ==========================================

// Get team members
router.get('/team', authenticate, async (req, res) => {
  try {
    const userOrg = await getUserOrganization(req.userId);
    const organizationId = userOrg?.organization_id;
    const connectionId = typeof req.query.connection_id === 'string' ? req.query.connection_id : null;

    if (!organizationId) {
      return res.json([]);
    }

    if (!connectionId) {
      const result = await query(
        `SELECT u.id, u.name, u.email, om.role
         FROM organization_members om
         JOIN users u ON u.id = om.user_id
         WHERE om.organization_id = $1
           AND COALESCE(om.is_active, true) = true
         ORDER BY u.name`,
        [organizationId]
      );
      return res.json(result.rows);
    }

    const connectionIds = await getUserConnections(req.userId);
    if (!connectionIds.includes(connectionId)) {
      return res.status(403).json({ error: 'Sem acesso a esta conexão' });
    }

    const specificMembersResult = await query(
      `SELECT COUNT(*)::int AS total FROM connection_members WHERE connection_id = $1`,
      [connectionId]
    );
    const hasSpecificMembers = (specificMembersResult.rows[0]?.total || 0) > 0;

    const result = hasSpecificMembers
      ? await query(
          `SELECT u.id, u.name, u.email, om.role
           FROM connection_members cm
           JOIN organization_members om ON om.user_id = cm.user_id
           JOIN users u ON u.id = cm.user_id
           WHERE cm.connection_id = $1
             AND om.organization_id = $2
             AND COALESCE(om.is_active, true) = true
           ORDER BY u.name`,
          [connectionId, organizationId]
        )
      : await query(
          `SELECT u.id, u.name, u.email, om.role
           FROM organization_members om
           JOIN users u ON u.id = om.user_id
           WHERE om.organization_id = $1
             AND COALESCE(om.is_active, true) = true
           ORDER BY u.name`,
          [organizationId]
        );

    res.json(result.rows);
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: 'Erro ao buscar equipe' });
  }
});

// Transfer conversation
router.post('/conversations/:id/transfer', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { to_user_id, note } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    // Check access
    const check = await query(
      `SELECT id, assigned_to, connection_id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const previousAssigned = check.rows[0].assigned_to;
    const conversationConnectionId = check.rows[0].connection_id;

    // Validate target user access to this connection
    if (to_user_id) {
      if (to_user_id === req.userId) {
        return res.status(400).json({ error: 'Selecione outro usuário para transferir a conversa' });
      }

      const specificMembersResult = await query(
        `SELECT COUNT(*)::int AS total FROM connection_members WHERE connection_id = $1`,
        [conversationConnectionId]
      );
      const hasSpecificMembers = (specificMembersResult.rows[0]?.total || 0) > 0;

      if (hasSpecificMembers) {
        const targetMember = await query(
          `SELECT 1 FROM connection_members WHERE connection_id = $1 AND user_id = $2 LIMIT 1`,
          [conversationConnectionId, to_user_id]
        );

        if (targetMember.rows.length === 0) {
          return res.status(400).json({
            error: 'Usuário selecionado não está disponível nesta conexão',
          });
        }
      } else {
        const userOrg = await getUserOrganization(req.userId);
        const targetOrgMember = await query(
          `SELECT 1
           FROM organization_members
           WHERE organization_id = $1 AND user_id = $2
           LIMIT 1`,
          [userOrg?.organization_id, to_user_id]
        );

        if (targetOrgMember.rows.length === 0) {
          return res.status(400).json({
            error: 'Usuário selecionado não está disponível nesta conexão',
          });
        }
      }
    }

    // Update assignment
    await query(
      `UPDATE conversations SET assigned_to = $1, updated_at = NOW() WHERE id = $2`,
      [to_user_id, id]
    );

    // Add system message about transfer
    const fromUser = await query(`SELECT name FROM users WHERE id = $1`, [req.userId]);
    const toUser = to_user_id ? await query(`SELECT name FROM users WHERE id = $1`, [to_user_id]) : null;

    const transferMessage = to_user_id
      ? `📋 Conversa transferida por ${fromUser.rows[0]?.name || 'Sistema'} para ${toUser?.rows[0]?.name || 'Outro atendente'}${note ? `: "${note}"` : ''}`
      : `📋 Conversa liberada por ${fromUser.rows[0]?.name || 'Sistema'}${note ? `: "${note}"` : ''}`;

    await query(
      `INSERT INTO chat_messages 
        (conversation_id, from_me, content, message_type, status, timestamp)
       VALUES ($1, true, $2, 'system', 'sent', NOW())`,
      [id, transferMessage]
    );

    res.json({ success: true, message: 'Conversa transferida com sucesso' });
  } catch (error) {
    console.error('Transfer conversation error:', error);
    res.status(500).json({ error: 'Erro ao transferir conversa' });
  }
});

// Transfer conversation to another connection
router.post('/conversations/:id/transfer-connection', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { connection_id: targetConnectionId } = req.body;

    if (!targetConnectionId) {
      return res.status(400).json({ error: 'connection_id é obrigatório' });
    }

    const connectionIds = await getUserConnections(req.userId);

    // Check user has access to the conversation
    // Include: conversations on user's connections, orphaned (NULL), or on deleted connections
    const check = await query(
      `SELECT c.id, c.connection_id, c.remote_jid, c.contact_name, c.contact_phone 
       FROM conversations c 
       WHERE c.id = $1 AND (
         c.connection_id = ANY($2) 
         OR c.connection_id IS NULL
         OR c.connection_id NOT IN (SELECT id FROM connections)
       )`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Verify target connection exists in the same organization
    const targetCheck = await query(
      `SELECT co.id FROM connections co
       WHERE co.id = $1 AND co.organization_id = (
         SELECT om.organization_id FROM organization_members om WHERE om.user_id = $2 LIMIT 1
       )`,
      [targetConnectionId, req.userId]
    );
    if (targetCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Conexão de destino não encontrada na organização' });
    }

    const conversation = check.rows[0];
    const contactPhone = conversation.contact_phone;
    const contactName = conversation.contact_name;

    // Prevent unique conflict before transfer: (connection_id, remote_jid)
    if (conversation.remote_jid) {
      const conflict = await query(
        `SELECT id
         FROM conversations
         WHERE connection_id = $1
           AND remote_jid = $2
           AND id <> $3
         LIMIT 1`,
        [targetConnectionId, conversation.remote_jid, id]
      );

      if (conflict.rows.length > 0) {
        return res.status(409).json({
          error: 'Já existe uma conversa deste contato na conexão de destino. Mescle ou remova a conversa duplicada antes de transferir.',
          conflict_conversation_id: conflict.rows[0].id,
        });
      }
    }

    // Auto-create contact in target connection if not exists
    if (contactPhone) {
      try {
        // Find a contact list linked to the target connection
        let targetList = await query(
          `SELECT cl.id FROM contact_lists cl WHERE cl.connection_id = $1 LIMIT 1`,
          [targetConnectionId]
        );

        // If no list exists for target connection, create one
        if (targetList.rows.length === 0) {
          const targetConnName = await query(`SELECT name FROM connections WHERE id = $1`, [targetConnectionId]);
          const listName = `Contatos - ${targetConnName.rows[0]?.name || 'Conexão'}`;
          // Try with user_id first, fallback without it
          try {
            targetList = await query(
              `INSERT INTO contact_lists (name, user_id, connection_id) VALUES ($1, $2, $3) RETURNING id`,
              [listName, req.userId, targetConnectionId]
            );
          } catch (insertErr) {
            // Fallback: still include user_id as it's NOT NULL
            targetList = await query(
              `INSERT INTO contact_lists (name, user_id, connection_id) VALUES ($1, $2, $3) RETURNING id`,
              [listName, req.userId, targetConnectionId]
            );
          }
        }

        const listId = targetList.rows[0].id;

        // Check if contact already exists in any list of this connection
        const existingContact = await query(
          `SELECT c.id FROM contacts c
           JOIN contact_lists cl ON cl.id = c.list_id
           WHERE cl.connection_id = $1 AND c.phone = $2 LIMIT 1`,
          [targetConnectionId, contactPhone]
        );

        if (existingContact.rows.length === 0) {
          await query(
            `INSERT INTO contacts (list_id, name, phone) VALUES ($1, $2, $3)`,
            [listId, contactName || contactPhone, contactPhone]
          );
          console.log(`[transfer-connection] Auto-created contact ${contactPhone} in target connection ${targetConnectionId}`);
        }
      } catch (contactErr) {
        console.error('[transfer-connection] Error auto-creating contact:', contactErr);
        // Non-fatal: continue with transfer even if contact creation fails
      }
    }

    // Update conversation connection
    try {
      await query(
        `UPDATE conversations SET connection_id = $1, updated_at = NOW() WHERE id = $2`,
        [targetConnectionId, id]
      );
    } catch (updateError) {
      if (updateError?.code === '23505') {
        return res.status(409).json({
          error: 'Conflito ao transferir: já existe conversa para este contato na conexão de destino.',
        });
      }
      throw updateError;
    }

    // Update related chat_messages connection_id only when legacy column exists
    const chatMessagesHasConnectionId = await hasColumn('chat_messages', 'connection_id');
    if (chatMessagesHasConnectionId) {
      await query(
        `UPDATE chat_messages SET connection_id = $1 WHERE conversation_id = $2`,
        [targetConnectionId, id]
      );
    }

    // Add system message
    const targetConn = await query(`SELECT name FROM connections WHERE id = $1`, [targetConnectionId]);
    const fromUser = await query(`SELECT name FROM users WHERE id = $1`, [req.userId]);
    const systemMsg = `🔄 Conversa transferida para conexão "${targetConn.rows[0]?.name || 'Nova conexão'}" por ${fromUser.rows[0]?.name || 'Sistema'}`;

    if (chatMessagesHasConnectionId) {
      await query(
        `INSERT INTO chat_messages 
          (conversation_id, connection_id, from_me, content, message_type, status, timestamp)
         VALUES ($1, $2, true, $3, 'system', 'sent', NOW())`,
        [id, targetConnectionId, systemMsg]
      );
    } else {
      await query(
        `INSERT INTO chat_messages 
          (conversation_id, from_me, content, message_type, status, timestamp)
         VALUES ($1, true, $2, 'system', 'sent', NOW())`,
        [id, systemMsg]
      );
    }

    res.json({ success: true, message: 'Conversa transferida para outra conexão' });
  } catch (error) {
    console.error('Transfer conversation connection error:', error);
    res.status(500).json({ error: 'Erro ao transferir conversa de conexão' });
  }
});

// ==========================================
// INTERNAL NOTES
// ==========================================

// Get notes for a conversation
router.get('/conversations/:id/notes', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    // Verify user has access to this conversation
    const conv = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (conv.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const result = await query(
      `SELECT cn.*, u.name as user_name
       FROM conversation_notes cn
       LEFT JOIN users u ON u.id = cn.user_id
       WHERE cn.conversation_id = $1
       ORDER BY cn.created_at DESC`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ error: 'Erro ao buscar anotações' });
  }
});

// Create note
router.post('/conversations/:id/notes', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Conteúdo é obrigatório' });
    }

    // Verify user has access to this conversation
    const conv = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (conv.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const result = await query(
      `INSERT INTO conversation_notes (conversation_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, req.userId, content.trim()]
    );

    // Get user name
    const user = await query(`SELECT name FROM users WHERE id = $1`, [req.userId]);
    const note = {
      ...result.rows[0],
      user_name: user.rows[0]?.name || null,
    };

    res.status(201).json(note);
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({ error: 'Erro ao criar anotação' });
  }
});

// Update note
router.patch('/conversations/:id/notes/:noteId', authenticate, async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const { content } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Conteúdo é obrigatório' });
    }

    // Verify user has access to this conversation
    const conv = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (conv.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Only allow editing own notes
    const result = await query(
      `UPDATE conversation_notes 
       SET content = $1, updated_at = NOW()
       WHERE id = $2 AND conversation_id = $3 AND user_id = $4
       RETURNING *`,
      [content.trim(), noteId, id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anotação não encontrada ou sem permissão' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({ error: 'Erro ao atualizar anotação' });
  }
});

// Delete note
router.delete('/conversations/:id/notes/:noteId', authenticate, async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    // Verify user has access to this conversation
    const conv = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (conv.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Only allow deleting own notes
    const result = await query(
      `DELETE FROM conversation_notes 
       WHERE id = $1 AND conversation_id = $2 AND user_id = $3
       RETURNING id`,
      [noteId, id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anotação não encontrada ou sem permissão' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({ error: 'Erro ao excluir anotação' });
  }
});

// ==========================================
// SCHEDULED MESSAGES
// ==========================================

// Get scheduled messages for a conversation
router.get('/conversations/:id/scheduled', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    // Check access
    const check = await query(
      `SELECT id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const result = await query(
      `SELECT sm.*, u.name as sender_name
       FROM scheduled_messages sm
       LEFT JOIN users u ON u.id = sm.sender_id
       WHERE sm.conversation_id = $1 AND sm.status = 'pending'
       ORDER BY sm.scheduled_at ASC`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get scheduled messages error:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens agendadas' });
  }
});

// Schedule a message
router.post('/conversations/:id/schedule', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, message_type = 'text', media_url, media_mimetype, scheduled_at, timezone = 'America/Sao_Paulo', send_text_separate = false } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    if (!scheduled_at) {
      return res.status(400).json({ error: 'Data/hora de agendamento é obrigatória' });
    }

    // Check access and get connection_id
    const convResult = await query(
      `SELECT id, connection_id FROM conversations WHERE id = $1 AND connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const scheduledDate = new Date(scheduled_at);
    if (scheduledDate <= new Date()) {
      return res.status(400).json({ error: 'Data de agendamento deve ser no futuro' });
    }

    const result = await query(
      `INSERT INTO scheduled_messages 
        (conversation_id, connection_id, sender_id, content, message_type, media_url, media_mimetype, scheduled_at, timezone, send_text_separate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id,
        convResult.rows[0].connection_id,
        req.userId,
        content,
        message_type,
        media_url || null,
        media_mimetype || null,
        scheduledDate,
        timezone,
        send_text_separate
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Schedule message error:', error);
    res.status(500).json({ error: 'Erro ao agendar mensagem' });
  }
});

// Cancel a scheduled message
router.delete('/scheduled/:messageId', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    const result = await query(
      `UPDATE scheduled_messages 
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 
         AND connection_id = ANY($2)
         AND status = 'pending'
       RETURNING id`,
      [messageId, connectionIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mensagem agendada não encontrada' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Cancel scheduled message error:', error);
    res.status(500).json({ error: 'Erro ao cancelar mensagem agendada' });
  }
});

// Get all pending scheduled messages count for user
router.get('/scheduled/count', authenticate, async (req, res) => {
  try {
    const connectionIds = await getUserConnections(req.userId);

    const result = await query(
      `SELECT COUNT(*) as count
       FROM scheduled_messages
       WHERE connection_id = ANY($1) AND status = 'pending'`,
      [connectionIds]
    );

    res.json({ count: parseInt(result.rows[0].count) || 0 });
  } catch (error) {
    console.error('Get scheduled count error:', error);
    res.status(500).json({ error: 'Erro ao buscar contagem' });
  }
});

// Get all scheduled messages (for Agendamentos page)
router.get('/scheduled/all', authenticate, async (req, res) => {
  try {
    const connectionIds = await getUserConnections(req.userId);
    const { status } = req.query;

    if (connectionIds.length === 0) {
      return res.json([]);
    }

    let sql = `
      SELECT sm.*, 
        u.name as sender_name,
        c.contact_name,
        c.contact_phone,
        conn.name as connection_name
      FROM scheduled_messages sm
      LEFT JOIN users u ON u.id = sm.sender_id
      LEFT JOIN conversations c ON c.id = sm.conversation_id
      LEFT JOIN connections conn ON conn.id = sm.connection_id
      WHERE sm.connection_id = ANY($1)
    `;
    
    const params = [connectionIds];
    
    if (status && status !== 'all') {
      sql += ` AND sm.status = $2`;
      params.push(status);
    }
    
    sql += ` ORDER BY sm.scheduled_at DESC`;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get all scheduled messages error:', error);
    res.status(500).json({ error: 'Erro ao buscar agendamentos' });
  }
});

// Get scheduled messages by phone number (for CRM deal view)
router.get('/scheduled-messages-by-phone', authenticate, async (req, res) => {
  try {
    const { phone } = req.query;
    const connectionIds = await getUserConnections(req.userId);

    if (!phone) {
      return res.status(400).json({ error: 'Telefone é obrigatório' });
    }

    if (connectionIds.length === 0) {
      return res.json([]);
    }

    // Normalize phone for search
    const normalizedPhone = phone.replace(/\D/g, '');
    
    const result = await query(
      `SELECT sm.*, 
        u.name as sender_name,
        c.contact_name,
        c.contact_phone
      FROM scheduled_messages sm
      LEFT JOIN users u ON u.id = sm.sender_id
      LEFT JOIN conversations c ON c.id = sm.conversation_id
      WHERE sm.connection_id = ANY($1) 
        AND sm.status = 'pending'
        AND (c.contact_phone LIKE '%' || $2 || '%' OR c.remote_jid LIKE '%' || $2 || '%')
      ORDER BY sm.scheduled_at ASC`,
      [connectionIds, normalizedPhone]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get scheduled messages by phone error:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens agendadas' });
  }
});

// Schedule a message by phone number (for CRM deal view)
router.post('/schedule-message-by-phone', authenticate, async (req, res) => {
  try {
    const { phone, content, message_type = 'text', media_url, media_mimetype, scheduled_at, timezone = 'America/Sao_Paulo' } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    if (!phone) {
      return res.status(400).json({ error: 'Telefone é obrigatório' });
    }

    if (!content && !media_url) {
      return res.status(400).json({ error: 'Conteúdo ou mídia é obrigatório' });
    }

    if (!scheduled_at) {
      return res.status(400).json({ error: 'Data/hora de agendamento é obrigatória' });
    }

    const scheduledDate = new Date(scheduled_at);
    if (scheduledDate <= new Date()) {
      return res.status(400).json({ error: 'Data de agendamento deve ser no futuro' });
    }

    // Normalize phone
    const normalizedPhone = phone.replace(/\D/g, '');

    // Find conversation by phone
    const convResult = await query(
      `SELECT c.id, c.connection_id 
       FROM conversations c
       WHERE c.connection_id = ANY($1) 
         AND (c.contact_phone LIKE '%' || $2 || '%' OR c.remote_jid LIKE '%' || $2 || '%')
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT 1`,
      [connectionIds, normalizedPhone]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada para este telefone' });
    }

    const conversation = convResult.rows[0];

    const result = await query(
      `INSERT INTO scheduled_messages 
        (conversation_id, connection_id, sender_id, content, message_type, media_url, media_mimetype, scheduled_at, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        conversation.id,
        conversation.connection_id,
        req.userId,
        content,
        message_type,
        media_url || null,
        media_mimetype || null,
        scheduledDate,
        timezone
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Schedule message by phone error:', error);
    res.status(500).json({ error: 'Erro ao agendar mensagem' });
  }
});

// Update scheduled message
router.patch('/scheduled/:messageId', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content, scheduled_at } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (content !== undefined) {
      updates.push(`content = $${paramIndex}`);
      values.push(content);
      paramIndex++;
    }

    if (scheduled_at) {
      const newDate = new Date(scheduled_at);
      if (newDate <= new Date()) {
        return res.status(400).json({ error: 'Data de agendamento deve ser no futuro' });
      }
      updates.push(`scheduled_at = $${paramIndex}`);
      values.push(newDate);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhuma atualização fornecida' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(messageId, connectionIds);

    const result = await query(
      `UPDATE scheduled_messages 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex} 
         AND connection_id = ANY($${paramIndex + 1})
         AND status = 'pending'
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agendamento não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update scheduled message error:', error);
    res.status(500).json({ error: 'Erro ao atualizar agendamento' });
  }
});

// ==========================================
// CHAT CONTACTS
// ==========================================

// Get all contacts from conversations (legacy/debug)
// NOTE: The main agenda endpoint is GET /contacts further below (chat_contacts + auto-populate).
router.get('/contacts/conversations', authenticate, async (req, res) => {
  try {
    const connectionIds = await getUserConnections(req.userId);

    if (connectionIds.length === 0) {
      return res.json([]);
    }

    const result = await query(
      `
      SELECT 
        conv.id,
        conv.id as conversation_id,
        conv.contact_name,
        conv.contact_phone,
        conv.connection_id,
        conn.name as connection_name,
        conv.last_message_at,
        conv.unread_count
      FROM conversations conv
      JOIN connections conn ON conn.id = conv.connection_id
      WHERE conv.connection_id = ANY($1) AND conv.is_archived = false
      ORDER BY conv.contact_name NULLS LAST, conv.contact_phone
      `,
      [connectionIds]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get conversation contacts error:', error);
    res.status(500).json({ error: 'Erro ao buscar contatos' });
  }
});

// Update conversation contact name
router.patch('/conversations/:id/contact', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { contact_name } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    const result = await query(
      `UPDATE conversations 
       SET contact_name = $1, updated_at = NOW()
       WHERE id = $2 AND connection_id = ANY($3)
       RETURNING *`,
      [contact_name, id, connectionIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({ error: 'Erro ao atualizar contato' });
  }
});

// ==========================================
// ALERTS / NOTIFICATIONS
// ==========================================

// Get unread alerts for user
router.get('/alerts', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM user_alerts 
       WHERE user_id = $1 AND is_read = false 
       ORDER BY created_at DESC 
       LIMIT 20`,
      [req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: 'Erro ao buscar alertas' });
  }
});

// Mark alerts as read
router.post('/alerts/read', authenticate, async (req, res) => {
  try {
    const { alert_ids } = req.body;

    if (!alert_ids || !Array.isArray(alert_ids) || alert_ids.length === 0) {
      return res.status(400).json({ error: 'IDs de alertas são obrigatórios' });
    }

    await query(
      `UPDATE user_alerts 
       SET is_read = true 
       WHERE id = ANY($1) AND user_id = $2`,
      [alert_ids, req.userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Mark alerts read error:', error);
    res.status(500).json({ error: 'Erro ao marcar alertas como lidos' });
  }
});

// Mark all alerts as read
router.post('/alerts/read-all', authenticate, async (req, res) => {
  try {
    await query(
      `UPDATE user_alerts SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [req.userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Mark all alerts read error:', error);
    res.status(500).json({ error: 'Erro ao marcar alertas como lidos' });
  }
});

// ==========================================
// IMPORT CONTACTS TO AGENDA (chat_contacts - not conversations)
// ==========================================

router.post('/contacts/import', authenticate, async (req, res) => {
  try {
    const { contacts, connection_id } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'Lista de contatos é obrigatória' });
    }

    if (!connection_id) {
      return res.status(400).json({ error: 'Conexão é obrigatória' });
    }

    const connectionIds = await getUserConnections(req.userId);

    // Verify user has access to this connection
    if (!connectionIds.includes(connection_id)) {
      return res.status(403).json({ error: 'Sem acesso a esta conexão' });
    }

    // Check if connection exists
    const connResult = await query(
      `SELECT id, status, instance_name FROM connections WHERE id = $1`,
      [connection_id]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    let imported = 0;
    let duplicates = 0;
    const errors = [];

    for (const contact of contacts) {
      const { name, phone } = contact;

      if (!phone) {
        errors.push(`Contato sem telefone: ${name || 'sem nome'}`);
        continue;
      }

      // Normalize phone number
      let normalizedPhone = phone.replace(/\D/g, '');
      
      // Ensure country code
      if (!normalizedPhone.startsWith('55') && normalizedPhone.length <= 11) {
        normalizedPhone = '55' + normalizedPhone;
      }

      // Generate JID
      const jid = `${normalizedPhone}@s.whatsapp.net`;

      try {
        // Insert or update contact in agenda (restore if was deleted)
        const result = await query(
          `INSERT INTO chat_contacts 
            (connection_id, name, phone, jid, created_by, created_at, updated_at, is_deleted)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), false)
           ON CONFLICT (connection_id, phone) 
           DO UPDATE SET 
             name = EXCLUDED.name, 
             updated_at = NOW(),
             is_deleted = false,
             deleted_at = NULL
           RETURNING id, (xmax = 0) as is_new, (is_deleted = false AND xmax <> 0) as was_restored`,
          [connection_id, name || normalizedPhone, normalizedPhone, jid, req.userId]
        );

        // Count as imported if new OR was restored from deleted state
        if (result.rows[0].is_new || result.rows[0].was_restored) {
          imported++;
        } else {
          duplicates++;
        }
      } catch (err) {
        errors.push(`Erro ao importar ${name || phone}: ${err.message}`);
      }
    }

    res.json({ imported, duplicates, errors: errors.slice(0, 10) });
  } catch (error) {
    console.error('Import contacts error:', error);
    res.status(500).json({ error: 'Erro ao importar contatos' });
  }
});

// Get contacts from agenda (chat_contacts). Also auto-populate from existing conversations.
router.get('/contacts', authenticate, async (req, res) => {
  try {
    const connectionIds = await getUserConnections(req.userId);

    if (connectionIds.length === 0) {
      return res.json([]);
    }

    const { search, connection } = req.query;

    // Auto-populate agenda with contacts from existing conversations
    // IMPORTANT: do not resurrect contacts that the user deleted (is_deleted=true)
    // IMPORTANT: exclude group chats (JIDs ending with @g.us)
    try {
      await query(
        `INSERT INTO chat_contacts (connection_id, name, phone, jid, created_by, created_at, updated_at, is_deleted)
         SELECT 
           conv.connection_id,
           COALESCE(NULLIF(conv.contact_name, ''), conv.contact_phone) as name,
           conv.contact_phone as phone,
           conv.remote_jid as jid,
           conv.assigned_to as created_by,
           conv.created_at,
           NOW(),
           false
         FROM conversations conv
         WHERE conv.connection_id = ANY($1)
           AND conv.contact_phone IS NOT NULL
           AND conv.contact_phone <> ''
           AND (conv.remote_jid IS NULL OR conv.remote_jid NOT LIKE '%@g.us')
         ON CONFLICT (connection_id, phone)
         DO UPDATE SET
           name = CASE
             WHEN chat_contacts.name IS NULL
               OR chat_contacts.name = ''
               OR regexp_replace(chat_contacts.name, '\D', '', 'g') = regexp_replace(COALESCE(chat_contacts.phone, ''), '\D', '', 'g')
             THEN COALESCE(NULLIF(EXCLUDED.name, ''), chat_contacts.name)
             ELSE chat_contacts.name
           END,
           jid = COALESCE(EXCLUDED.jid, chat_contacts.jid),
           updated_at = NOW()
         WHERE COALESCE(chat_contacts.is_deleted, false) = false`,
        [connectionIds]
      );
    } catch (autoPopulateError) {
      // Log but don't fail if auto-populate has issues
      console.warn('Auto-populate chat contacts failed (non-critical):', autoPopulateError.message);
    }

    // Build filter conditions
    const params = [connectionIds];
    let paramIndex = 2;
    let connectionFilter = '';
    let searchFilter = '';

    if (connection && connection !== 'all') {
      connectionFilter = ` AND cc.connection_id = $${paramIndex}`;
      params.push(connection);
      paramIndex++;
    }

    if (search) {
      searchFilter = ` AND (cc.name ILIKE $${paramIndex} OR cc.phone ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Union chat_contacts + contacts from contact_lists (campaign lists)
    let sql = `
      SELECT DISTINCT ON (combined.phone, combined.connection_id)
        combined.*
      FROM (
        -- Source 1: chat_contacts (from conversations auto-populate + manual adds)
        SELECT 
          cc.id,
          cc.name,
          cc.phone,
          cc.jid,
          cc.connection_id,
          c.name as connection_name,
          EXISTS (
            SELECT 1 FROM conversations conv 
            WHERE conv.connection_id = cc.connection_id
              AND (conv.contact_phone = cc.phone OR conv.remote_jid = cc.jid)
          ) as has_conversation,
          cc.created_at
        FROM chat_contacts cc
        JOIN connections c ON c.id = cc.connection_id
        WHERE cc.connection_id = ANY($1)
          AND COALESCE(cc.is_deleted, false) = false
          AND (cc.jid IS NULL OR cc.jid NOT LIKE '%@g.us')
          ${connectionFilter}
          ${searchFilter}

        UNION ALL

        -- Source 2: contacts from contact_lists (linked via connection or user ownership)
        SELECT 
          ct.id,
          ct.name,
          ct.phone,
          NULL as jid,
          cl.connection_id,
          cn.name as connection_name,
          EXISTS (
            SELECT 1 FROM conversations conv 
            WHERE conv.connection_id = cl.connection_id
              AND conv.contact_phone = ct.phone
          ) as has_conversation,
          ct.created_at
        FROM contacts ct
        JOIN contact_lists cl ON cl.id = ct.list_id
        JOIN connections cn ON cn.id = cl.connection_id
        WHERE cl.connection_id = ANY($1)
          AND ct.phone IS NOT NULL
          AND ct.phone <> ''
          ${connectionFilter ? connectionFilter.replace(/cc\./g, 'cl.') : ''}
          ${searchFilter ? searchFilter.replace(/cc\./g, 'ct.') : ''}
      ) combined
      ORDER BY combined.phone, combined.connection_id, combined.has_conversation DESC, combined.name ASC NULLS LAST
      LIMIT 10000
    `;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get chat contacts error:', error);
    res.status(500).json({ error: 'Erro ao buscar contatos' });
  }
});

// Update contact in agenda
router.patch('/contacts/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const result = await query(
      `UPDATE chat_contacts 
       SET name = $1, updated_at = NOW()
       WHERE id = $2 AND connection_id = ANY($3)
       RETURNING *`,
      [name.trim(), id, connectionIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    const updatedContact = result.rows[0];

    await query(
      `UPDATE conversations
       SET contact_name = $1, updated_at = NOW()
       WHERE connection_id = $2
         AND (
           regexp_replace(COALESCE(contact_phone, ''), '\D', '', 'g') = regexp_replace(COALESCE($3, ''), '\D', '', 'g')
           OR regexp_replace(split_part(COALESCE(remote_jid, ''), '@', 1), '\D', '', 'g') = regexp_replace(COALESCE($3, ''), '\D', '', 'g')
         )`,
      [name.trim(), updatedContact.connection_id, updatedContact.phone]
    );

    res.json(updatedContact);
  } catch (error) {
    console.error('Update chat contact error:', error);
    res.status(500).json({ error: 'Erro ao atualizar contato' });
  }
});

// Update or create contact by phone and connection_id (for inline editing from chat)
router.post('/contacts/by-phone', authenticate, async (req, res) => {
  try {
    const { phone, connection_id, name } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    if (!phone || !connection_id || !name) {
      return res.status(400).json({ error: 'phone, connection_id e name são obrigatórios' });
    }

    // Verify connection belongs to user
    if (!connectionIds.includes(connection_id)) {
      return res.status(403).json({ error: 'Conexão não autorizada' });
    }

    // Upsert contact
    const contactResult = await query(
      `INSERT INTO chat_contacts (connection_id, phone, name, created_by, created_at, updated_at, is_deleted)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), false)
       ON CONFLICT (connection_id, phone)
       DO UPDATE SET name = $3, updated_at = NOW(), is_deleted = false
       RETURNING *`,
      [connection_id, phone, name.trim(), req.userId]
    );

    // Also update contact_name in all conversations with this phone
    await query(
      `UPDATE conversations
       SET contact_name = $1, updated_at = NOW()
       WHERE connection_id = $2
         AND (contact_phone = $3 OR remote_jid LIKE $4 OR remote_jid LIKE $5)`,
      [name.trim(), connection_id, phone, `${phone}@s.whatsapp.net`, `${phone}@%`]
    );

    res.json(contactResult.rows[0]);
  } catch (error) {
    console.error('Upsert chat contact error:', error);
    res.status(500).json({ error: 'Erro ao salvar contato' });
  }
});

// Delete contact from agenda (soft delete to prevent reappearing from conversation sync)
router.delete('/contacts/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const connectionIds = await getUserConnections(req.userId);

    const result = await query(
      `UPDATE chat_contacts
       SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND connection_id = ANY($2)
       RETURNING id`,
      [id, connectionIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete chat contact error:', error);
    res.status(500).json({ error: 'Erro ao excluir contato' });
  }
});

// Bulk delete contacts from agenda (soft delete)
router.post('/contacts/bulk-delete', authenticate, async (req, res) => {
  try {
    const { contact_ids } = req.body;

    if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
      return res.status(400).json({ error: 'Nenhum contato selecionado' });
    }

    const connectionIds = await getUserConnections(req.userId);

    const result = await query(
      `UPDATE chat_contacts
       SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
       WHERE id = ANY($1) AND connection_id = ANY($2)
       RETURNING id`,
      [contact_ids, connectionIds]
    );

    res.json({ 
      success: true, 
      deleted: result.rows.length 
    });
  } catch (error) {
    console.error('Bulk delete chat contacts error:', error);
    res.status(500).json({ error: 'Erro ao excluir contatos' });
  }
});

// ==========================================
// CREATE NEW CONVERSATION
// ==========================================

// Create a new conversation (start chat with a contact)
router.post('/conversations', authenticate, async (req, res) => {
  try {
    const { contact_phone, contact_name, connection_id } = req.body;

    if (!contact_phone || !connection_id) {
      return res.status(400).json({ error: 'Telefone e conexão são obrigatórios' });
    }

    const connectionIds = await getUserConnections(req.userId);

    // Verify user has access to this connection
    if (!connectionIds.includes(connection_id)) {
      return res.status(403).json({ error: 'Sem acesso a esta conexão' });
    }

    // Check if connection exists and is active (prefer live status over stale DB value)
    const connResult = await query(
      `SELECT id, status, provider, instance_name, instance_id, wapi_token, api_url, api_key, phone_number
       FROM connections WHERE id = $1`,
      [connection_id]
    );

    if (connResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conexão não encontrada' });
    }

    const connection = connResult.rows[0];
    const provider = whatsappProvider.detectProvider(connection);
    let isConnected = connection.status === 'connected' ||
      (provider === 'wapi' && connection.instance_id) ||
      (provider === 'uazapi' && connection.instance_id);

    if (!isConnected) {
      try {
        const liveStatus = await whatsappProvider.checkStatus(connection);
        const rawStatus = liveStatus?.status || 'disconnected';
        const phoneNumber = liveStatus?.phoneNumber || null;
        const resolvedStatus =
          connection.status === 'connected' && rawStatus === 'disconnected' && liveStatus?.transient
            ? 'connected'
            : rawStatus;

        if (connection.status !== resolvedStatus || connection.phone_number !== phoneNumber) {
          await query(
            'UPDATE connections SET status = $1, phone_number = $2, updated_at = NOW() WHERE id = $3',
            [resolvedStatus, phoneNumber, connection_id]
          );
        }

        isConnected = resolvedStatus === 'connected' ||
          (provider === 'wapi' && connection.instance_id) ||
          (provider === 'uazapi' && connection.instance_id);
      } catch (statusError) {
        console.warn('[Chat] Live status check failed:', statusError?.message || statusError);
      }
    }

    if (!isConnected) {
      return res.status(400).json({ error: 'Conexão não está ativa' });
    }

    // Normalize phone number - remove all non-digits
    let phone = contact_phone.replace(/\D/g, '');
    
    // Remove country code 55 if present for comparison, then add it back
    let phoneWithoutCountry = phone;
    if (phone.startsWith('55') && phone.length > 11) {
      phoneWithoutCountry = phone.substring(2);
    }
    
    // Ensure country code
    if (!phone.startsWith('55')) {
      phone = '55' + phone;
    }

    // Generate remote JID variants
    const remoteJid = `${phone}@s.whatsapp.net`;
    const remoteJidLid = `${phone}@lid`;

    // Check if conversation already exists - comprehensive search
    // Search by: exact remote_jid, @lid variant, contact_phone with/without country code
    const existingConv = await query(
      `SELECT id FROM conversations 
       WHERE connection_id = $1 AND (
         remote_jid = $2 OR 
         remote_jid = $3 OR 
         remote_jid LIKE $4 OR
         contact_phone = $5 OR 
         contact_phone = $6 OR
         contact_phone = $7
       )
       ORDER BY last_message_at DESC NULLS LAST
       LIMIT 1`,
      [
        connection_id, 
        remoteJid, 
        remoteJidLid,
        `%${phoneWithoutCountry}@%`,
        phone, 
        phoneWithoutCountry,
        contact_phone.replace(/\D/g, '') // original input cleaned
      ]
    );

    if (existingConv.rows.length > 0) {
      // Update contact name if provided and different
      if (contact_name) {
        await query(
          `UPDATE conversations SET contact_name = $1, updated_at = NOW() 
           WHERE id = $2 AND (contact_name IS NULL OR contact_name = contact_phone OR contact_name = '')`,
          [contact_name, existingConv.rows[0].id]
        );
      }
      
      // Return existing conversation
      const fullConv = await query(
        `SELECT 
          conv.*,
          conn.name as connection_name,
          u.name as assigned_name,
          COALESCE(
            (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FROM conversation_tag_links ctl
             JOIN conversation_tags t ON t.id = ctl.tag_id
             WHERE ctl.conversation_id = conv.id
            ), '[]'::json
          ) as tags
        FROM conversations conv
        JOIN connections conn ON conn.id = conv.connection_id
        LEFT JOIN users u ON u.id = conv.assigned_to
        WHERE conv.id = $1`,
        [existingConv.rows[0].id]
      );
      return res.json({ ...fullConv.rows[0], existed: true });
    }

    // Create new conversation - when user creates manually, they are attending it
    const result = await query(
      `INSERT INTO conversations 
        (connection_id, remote_jid, contact_phone, contact_name, assigned_to, is_archived, unread_count, attendance_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, 0, 'attending', NOW(), NOW())
       RETURNING *`,
      [connection_id, remoteJid, phone, contact_name || phone, req.userId]
    );

    const conversation = result.rows[0];

    // Return full conversation with connection info
    const fullConv = await query(
      `SELECT 
        conv.*,
        conn.name as connection_name,
        u.name as assigned_name,
        '[]'::json as tags
      FROM conversations conv
      JOIN connections conn ON conn.id = conv.connection_id
      LEFT JOIN users u ON u.id = conv.assigned_to
      WHERE conv.id = $1`,
      [conversation.id]
    );

    res.status(201).json(fullConv.rows[0]);
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: 'Erro ao criar conversa' });
  }
});

// ==========================================
// CALL LOGS - Voice call tracking
// ==========================================

// Log a voice call (records it as a special message type in the conversation)
router.post('/conversations/:id/call-log', authenticate, async (req, res) => {
  try {
    const userOrg = await getUserOrganization(req.userId);
    if (userOrg && isViewOnlyRole(userOrg.role)) {
      return res.status(403).json({ error: 'Supervisores não podem registrar chamadas' });
    }

    const { id } = req.params;
    const { call_type, duration_seconds, outcome, notes } = req.body;
    const connectionIds = await getUserConnections(req.userId);

    // Verify conversation access
    const convResult = await query(
      `SELECT conv.* FROM conversations conv
       WHERE conv.id = $1 AND conv.connection_id = ANY($2)`,
      [id, connectionIds]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Format duration for display
    const minutes = Math.floor(duration_seconds / 60);
    const seconds = duration_seconds % 60;
    const durationFormatted = duration_seconds > 0 
      ? `${minutes}:${seconds.toString().padStart(2, '0')}`
      : 'N/A';

    // Build call log content
    const callTypeLabels = {
      outgoing: '📞 Chamada realizada',
      incoming: '📲 Chamada recebida',
      missed: '📵 Chamada perdida'
    };

    const content = [
      callTypeLabels[call_type] || '📞 Chamada',
      `⏱️ Duração: ${durationFormatted}`,
      `📋 Resultado: ${outcome}`,
      notes ? `📝 Notas: ${notes}` : null
    ].filter(Boolean).join('\n');

    // Insert as a special 'call_log' message type
    const messageResult = await query(
      `INSERT INTO chat_messages 
        (conversation_id, message_id, from_me, sender_id, content, message_type, status, timestamp)
       VALUES ($1, $2, true, $3, $4, 'call_log', 'sent', NOW())
       RETURNING *`,
      [
        id,
        `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        req.userId,
        content
      ]
    );

    // Update conversation last_message_at
    await query(
      `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );

    // Also add to conversation notes for CRM purposes
    await query(
      `INSERT INTO conversation_notes (conversation_id, user_id, content, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [
        id,
        req.userId,
        `${callTypeLabels[call_type]} - ${outcome}${notes ? `\n${notes}` : ''}`
      ]
    );

    res.status(201).json(messageResult.rows[0]);
  } catch (error) {
    console.error('Log call error:', error);
    res.status(500).json({ error: 'Erro ao registrar chamada' });
  }
});

// ==========================================
// AI AGENT SESSIONS (manual control from chat)
// ==========================================

// Get active agent session for a conversation
router.get('/conversations/:id/agent-session', authenticate, async (req, res) => {
  try {
    const session = await getActiveAgentSession(req.params.id);
    res.json(session || null);
  } catch (error) {
    console.error('Get agent session error:', error);
    res.status(500).json({ error: 'Erro ao buscar sessão do agente' });
  }
});

// Start an agent session for a conversation
router.post('/conversations/:id/agent-session', authenticate, async (req, res) => {
  try {
    const { agent_id } = req.body;
    if (!agent_id) {
      return res.status(400).json({ error: 'agent_id é obrigatório' });
    }

    // Get conversation info
    const convResult = await query(
      `SELECT contact_phone, contact_name FROM conversations WHERE id = $1`,
      [req.params.id]
    );
    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const conv = convResult.rows[0];
    const session = await startAgentSession(
      agent_id,
      req.params.id,
      conv.contact_phone,
      conv.contact_name
    );

    // Return with agent info
    const agentResult = await query(
      `SELECT name, avatar_url, greeting_message FROM ai_agents WHERE id = $1`,
      [agent_id]
    );
    const agent = agentResult.rows[0];

    // Trigger immediate AI response in background after reading recent chat history.
    // Manual activation should continue the current conversation instead of sending a generic greeting.
    triggerAgentFirstMessage(agent_id, req.params.id).catch(err => {
      console.error('Error triggering agent first message:', err);
    });

    res.json({
      ...session,
      agent_name: agent?.name,
      agent_avatar: agent?.avatar_url,
    });
  } catch (error) {
    console.error('Start agent session error:', error);
    res.status(500).json({ error: 'Erro ao iniciar sessão do agente' });
  }
});

// Stop agent session for a conversation
router.delete('/conversations/:id/agent-session', authenticate, async (req, res) => {
  try {
    const result = await stopAgentSession(req.params.id);
    res.json({ success: true, stopped: result });
  } catch (error) {
    console.error('Stop agent session error:', error);
    res.status(500).json({ error: 'Erro ao encerrar sessão do agente' });
  }
});

// Enable/disable human takeover (disables AI for this conversation)
router.post('/conversations/:id/agent-session/takeover', authenticate, async (req, res) => {
  try {
    const { enabled } = req.body;
    const result = await setHumanTakeover(req.params.id, enabled !== false, req.userId);
    res.json({ success: true, takeover: result, enabled: enabled !== false });
  } catch (error) {
    console.error('Human takeover error:', error);
    res.status(500).json({ error: 'Erro ao alterar controle humano' });
  }
});

/**
 * Retry downloading media for a specific message
 * This is useful when the provider failed to deliver the media initially
 */
router.post('/messages/:messageId/retry-download', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;

    // Find the message and its connection
    const msgResult = await query(
      `SELECT m.*, c.id as conn_id, c.provider, c.instance_id, c.wapi_token, c.uazapi_url, c.uazapi_token, c.api_url, c.api_key, c.instance_name
       FROM chat_messages m
       JOIN conversations conv ON conv.id = m.conversation_id
       JOIN connections c ON c.id = conv.connection_id
       WHERE m.message_id = $1 OR m.id::text = $1
       LIMIT 1`,
      [messageId]
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Mensagem não encontrada' });
    }

    const msg = msgResult.rows[0];
    const connection = {
      id: msg.conn_id,
      provider: msg.provider,
      instance_id: msg.instance_id,
      wapi_token: msg.wapi_token,
      uazapi_url: msg.uazapi_url,
      uazapi_token: msg.uazapi_token,
      api_url: msg.api_url,
      api_key: msg.api_key,
      instance_name: msg.instance_name
    };

    console.log(`[Chat] Retrying download for message ${msg.message_id} via provider ${connection.provider}`);

    const dl = await whatsappProvider.downloadMedia(connection, msg.message_id);

    if (!dl?.success) {
      return res.status(400).json({ error: dl?.error || 'Falha ao baixar mídia do provedor' });
    }

    let publicUrl = null;
    let mimetype = dl.mimetype || msg.media_mimetype;

    if (dl.url) {
      // If the provider returned a direct URL
      if (dl.url.startsWith('http')) {
        publicUrl = dl.url;
      } else {
        const baseUrl = String(process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
        const cleanPath = dl.url.startsWith('/') ? dl.url : `/uploads/${dl.url}`;
        publicUrl = baseUrl ? `${baseUrl}${cleanPath}` : cleanPath;
      }
    } else if (dl.buffer || dl.base64) {
      // If the provider returned binary data, save it locally
      const buf = dl.buffer || Buffer.from(dl.base64, 'base64');
      const mt = (dl.mimetype || 'application/octet-stream').toLowerCase();
      
      const extMap = {
        'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
        'image/gif': '.gif', 'image/webp': '.webp',
        'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/3gpp': '.3gp',
        'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
        'audio/wav': '.wav', 'audio/webm': '.webm',
        'application/pdf': '.pdf',
      };
      
      const ext = extMap[mt] || '.bin';
      const fname = `${Date.now()}_retry_${crypto.randomBytes(4).toString('hex')}${ext}`;
      const uploadsDir = path.join(process.cwd(), 'uploads');
      
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, fname), buf);
      
      const baseUrl = String(process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
      const localPath = `/uploads/${fname}`;
      publicUrl = baseUrl ? `${baseUrl}${localPath}` : localPath;
    }

    if (!publicUrl) {
      return res.status(400).json({ error: 'Mídia baixada mas sem URL disponível' });
    }

    // Update the message in the database
    // Also clear the content if it was an error message
    let newContent = msg.content;
    const errorStrings = [
      'o audio nao esta mais disponivel',
      'audio nao esta mais disponivel',
      'midia nao esta mais disponivel',
      'não está mais disponível'
    ];
    
    const contentLower = String(newContent || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (errorStrings.some(s => contentLower.includes(s))) {
      if (msg.message_type === 'audio') newContent = '[Áudio]';
      else if (msg.message_type === 'image') newContent = '[Imagem]';
      else if (msg.message_type === 'video') newContent = '[Vídeo]';
      else if (msg.message_type === 'document') newContent = '[Documento]';
    }

    await query(
      `UPDATE chat_messages 
       SET media_url = $1, 
           media_mimetype = COALESCE($2, media_mimetype),
           content = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [publicUrl, mimetype, newContent, msg.id]
    );

    res.json({ 
      success: true, 
      media_url: publicUrl, 
      media_mimetype: mimetype,
      content: newContent
    });

  } catch (error) {
    console.error('Retry download error:', error);
    res.status(500).json({ error: 'Erro ao reprocessar download de mídia' });
  }
});

export default router;

