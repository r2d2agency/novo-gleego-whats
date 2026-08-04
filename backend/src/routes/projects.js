import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';

const router = Router();
router.use(authenticate);

// Ensure required tables exist
(async () => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS project_note_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      project_id UUID NOT NULL,
      note_id UUID NOT NULL,
      project_title TEXT,
      sender_name TEXT,
      content_preview TEXT,
      read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS project_stages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      name VARCHAR(100) NOT NULL,
      position INTEGER DEFAULT 0,
      color VARCHAR(50) DEFAULT '#6366f1',
      is_final BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS project_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS project_template_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id UUID REFERENCES project_templates(id) ON DELETE CASCADE NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      position INTEGER DEFAULT 0,
      duration_days INTEGER DEFAULT 1,
      depends_on_position INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      deal_id UUID,
      stage_id UUID,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      requested_by UUID,
      assigned_to UUID,
      priority VARCHAR(20) DEFAULT 'medium',
      due_date TIMESTAMPTZ,
      position INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS project_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      position INTEGER DEFAULT 0,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      duration_days INTEGER DEFAULT 1,
      depends_on UUID,
      assigned_to UUID,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS project_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
      user_id UUID,
      content TEXT NOT NULL,
      parent_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS project_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
      name VARCHAR(255),
      url TEXT NOT NULL,
      mimetype VARCHAR(100),
      size INTEGER,
      uploaded_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  } catch (_) { console.error('Projects table init error:', _); }
})();

// Helper
async function getUserOrg(userId) {
  try {
    const r = await query(
      `SELECT organization_id, role FROM organization_members WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (r.rows.length > 0) return r.rows[0];
    
    // Fallback for superadmin or orphaned users
    const userRes = await query(`SELECT is_superadmin FROM users WHERE id = $1`, [userId]);
    if (userRes.rows[0]?.is_superadmin) {
      const anyOrg = await query(`SELECT id as organization_id, 'owner' as role FROM organizations LIMIT 1`);
      return anyOrg.rows[0] || null;
    }
    
    return null;
  } catch (e) {
    console.error('getUserOrg error:', e);
    return null;
  }
}

function isMissing(e) {
  return e.message?.includes('does not exist') || e.message?.includes('relation');
}

const canManage = (role) => ['owner', 'admin', 'manager'].includes(role);

// Check if user belongs to a group with "projeto" in the name
async function isDesigner(userId, orgId) {
  try {
    const r = await query(
      `SELECT 1 FROM crm_user_group_members gm
       JOIN crm_user_groups g ON g.id = gm.group_id
       WHERE gm.user_id = $1 AND g.organization_id = $2 AND LOWER(g.name) LIKE '%projeto%'
       LIMIT 1`,
      [userId, orgId]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

// Permission: can edit projects (admin/manager/designer)
async function canEditProject(userId, org) {
  if (canManage(org.role)) return true;
  return isDesigner(userId, org.organization_id);
}

// ========================
// STAGES (Kanban columns)
// ========================

// List stages
router.get('/stages', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No org' });
    const r = await query(
      `SELECT * FROM project_stages WHERE organization_id = $1 ORDER BY position ASC`,
      [org.organization_id]
    );
    res.json(r.rows);
  } catch (e) {
    if (isMissing(e)) return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

// Create stage
router.post('/stages', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !canManage(org.role)) return res.status(403).json({ error: 'Forbidden' });
    const { name, color, is_final } = req.body;
    const posR = await query(
      `SELECT COALESCE(MAX(position), -1) + 1 as pos FROM project_stages WHERE organization_id = $1`,
      [org.organization_id]
    );
    const r = await query(
      `INSERT INTO project_stages (organization_id, name, color, is_final, position)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [org.organization_id, name, color || '#6366f1', is_final || false, posR.rows[0].pos]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update stage
router.patch('/stages/:id', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !canManage(org.role)) return res.status(403).json({ error: 'Forbidden' });
    const { name, color, is_final, position } = req.body;
    const r = await query(
      `UPDATE project_stages SET name = COALESCE($1, name), color = COALESCE($2, color),
       is_final = COALESCE($3, is_final), position = COALESCE($4, position)
       WHERE id = $5 AND organization_id = $6 RETURNING *`,
      [name, color, is_final, position, req.params.id, org.organization_id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete stage
router.delete('/stages/:id', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !canManage(org.role)) return res.status(403).json({ error: 'Forbidden' });
    await query(
      `DELETE FROM project_stages WHERE id = $1 AND organization_id = $2`,
      [req.params.id, org.organization_id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reorder stages
router.post('/stages/reorder', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !canManage(org.role)) return res.status(403).json({ error: 'Forbidden' });
    const { stages } = req.body; // [{id, position}]
    for (const s of stages) {
      await query(`UPDATE project_stages SET position = $1 WHERE id = $2 AND organization_id = $3`,
        [s.position, s.id, org.organization_id]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================
// TEMPLATES (must be before /:id to avoid conflict)
// ========================

router.get('/templates', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No org' });
    const r = await query(
      `SELECT pt.*, 
        (SELECT COUNT(*) FROM project_template_tasks ptt WHERE ptt.template_id = pt.id) as task_count
       FROM project_templates pt WHERE pt.organization_id = $1 ORDER BY pt.name ASC`,
      [org.organization_id]
    );
    res.json(r.rows);
  } catch (e) {
    if (isMissing(e)) return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !canManage(org.role)) return res.status(403).json({ error: 'Forbidden' });
    const { name, description, tasks } = req.body;
    const r = await query(
      `INSERT INTO project_templates (organization_id, name, description, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [org.organization_id, name, description, req.userId]
    );
    const template = r.rows[0];
    if (tasks?.length) {
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        await query(
          `INSERT INTO project_template_tasks (template_id, title, description, position, duration_days, depends_on_position)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [template.id, t.title, t.description || null, i, t.duration_days || 1, t.depends_on_position ?? null]
        );
      }
    }
    res.json(template);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/templates/:id', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !canManage(org.role)) return res.status(403).json({ error: 'Forbidden' });
    const { name, description, tasks } = req.body;
    await query(
      `UPDATE project_templates SET name = COALESCE($1, name), description = COALESCE($2, description)
       WHERE id = $3 AND organization_id = $4`,
      [name, description, req.params.id, org.organization_id]
    );
    if (tasks) {
      await query(`DELETE FROM project_template_tasks WHERE template_id = $1`, [req.params.id]);
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        await query(
          `INSERT INTO project_template_tasks (template_id, title, description, position, duration_days, depends_on_position)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.params.id, t.title, t.description || null, i, t.duration_days || 1, t.depends_on_position ?? null]
        );
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !canManage(org.role)) return res.status(403).json({ error: 'Forbidden' });
    await query(`DELETE FROM project_templates WHERE id = $1 AND organization_id = $2`, [req.params.id, org.organization_id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/templates/:id/tasks', async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM project_template_tasks WHERE template_id = $1 ORDER BY position ASC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (e) {
    if (isMissing(e)) return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

// Check if user is in a "projects" group (must be before /:id)
router.get('/check-designer', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.json({ isDesigner: false });
    const r = await query(
      `SELECT 1 FROM crm_user_group_members gm
       JOIN crm_user_groups g ON g.id = gm.group_id
       WHERE gm.user_id = $1 AND g.organization_id = $2 AND LOWER(g.name) LIKE '%projeto%'
       LIMIT 1`,
      [req.userId, org.organization_id]
    );
    res.json({ isDesigner: r.rows.length > 0 });
  } catch (e) {
    res.json({ isDesigner: false });
  }
});

// Get projects by deal (must be before /:id)
router.get('/by-deal/:dealId', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No org' });
    const r = await query(
      `SELECT p.*, ps.name as stage_name, ps.color as stage_color,
        (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id) as total_tasks,
        (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id AND pt.status = 'completed') as completed_tasks
       FROM projects p
       LEFT JOIN project_stages ps ON p.stage_id = ps.id
       WHERE p.deal_id = $1 AND p.organization_id = $2
       ORDER BY p.created_at DESC`,
      [req.params.dealId, org.organization_id]
    );
    res.json(r.rows);
  } catch (e) {
    if (isMissing(e)) return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

// ========================
// PROJECTS
// ========================

// List projects
router.get('/', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No org' });
    const r = await query(
      `SELECT p.*, 
        u1.name as requested_by_name, u2.name as assigned_to_name,
        ps.name as stage_name, ps.color as stage_color,
        d.title as deal_title,
        (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id) as total_tasks,
        (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id AND pt.status = 'completed') as completed_tasks
       FROM projects p
       LEFT JOIN users u1 ON p.requested_by = u1.id
       LEFT JOIN users u2 ON p.assigned_to = u2.id
       LEFT JOIN project_stages ps ON p.stage_id = ps.id
       LEFT JOIN crm_deals d ON p.deal_id = d.id
       WHERE p.organization_id = $1
       ORDER BY p.position ASC, p.created_at DESC`,
      [org.organization_id]
    );
    res.json(r.rows);
  } catch (e) {
    if (isMissing(e)) return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

// Get single project
router.get('/:id', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No org' });
    const r = await query(
      `SELECT p.*, 
        u1.name as requested_by_name, u2.name as assigned_to_name,
        ps.name as stage_name, ps.color as stage_color,
        d.title as deal_title
       FROM projects p
       LEFT JOIN users u1 ON p.requested_by = u1.id
       LEFT JOIN users u2 ON p.assigned_to = u2.id
       LEFT JOIN project_stages ps ON p.stage_id = ps.id
       LEFT JOIN crm_deals d ON p.deal_id = d.id
       WHERE p.id = $1 AND p.organization_id = $2`,
      [req.params.id, org.organization_id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create project (admin/manager/designer only)
router.post('/', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No org' });
    if (!(await canEditProject(req.userId, org))) return res.status(403).json({ error: 'Forbidden' });
    const { title, description, deal_id, assigned_to, priority, due_date, template_id } = req.body;

    // Get first stage as default
    let stage_id = null;
    try {
      const stageR = await query(
        `SELECT id FROM project_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1`,
        [org.organization_id]
      );
      if (stageR.rows[0]) stage_id = stageR.rows[0].id;
    } catch (_) {}

    const r = await query(
      `INSERT INTO projects (organization_id, title, description, deal_id, stage_id, requested_by, assigned_to, priority, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [org.organization_id, title, description, deal_id || null, stage_id, req.userId, assigned_to || null, priority || 'medium', due_date || null]
    );

    const project = r.rows[0];

    // Apply template tasks if template_id provided
    if (template_id) {
      try {
        const tmplTasks = await query(
          `SELECT * FROM project_template_tasks WHERE template_id = $1 ORDER BY position ASC`,
          [template_id]
        );
        const taskIdMap = {};
        for (const t of tmplTasks.rows) {
          const startDate = new Date();
          const endDate = new Date();
          endDate.setDate(endDate.getDate() + (t.duration_days || 1));
          const tr = await query(
            `INSERT INTO project_tasks (project_id, title, description, position, duration_days, start_date, end_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [project.id, t.title, t.description, t.position, t.duration_days, startDate, endDate]
          );
          taskIdMap[t.position] = tr.rows[0].id;
        }
        // Set dependencies
        for (const t of tmplTasks.rows) {
          if (t.depends_on_position != null && taskIdMap[t.depends_on_position]) {
            await query(
              `UPDATE project_tasks SET depends_on = $1 WHERE id = $2`,
              [taskIdMap[t.depends_on_position], taskIdMap[t.position]]
            );
          }
        }
      } catch (_) {}
    }

    res.json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update project (admin/manager/designer only)
router.patch('/:id', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No org' });
    if (!(await canEditProject(req.userId, org))) return res.status(403).json({ error: 'Forbidden' });
    const { title, description, stage_id, assigned_to, priority, due_date, position } = req.body;
    const r = await query(
      `UPDATE projects SET 
        title = COALESCE($1, title), description = COALESCE($2, description),
        stage_id = COALESCE($3, stage_id), assigned_to = COALESCE($4, assigned_to),
        priority = COALESCE($5, priority), due_date = COALESCE($6, due_date),
        position = COALESCE($7, position), updated_at = NOW()
       WHERE id = $8 AND organization_id = $9 RETURNING *`,
      [title, description, stage_id, assigned_to, priority, due_date, position, req.params.id, org.organization_id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Move project (admin/manager/designer only)
router.post('/:id/move', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No org' });
    if (!(await canEditProject(req.userId, org))) return res.status(403).json({ error: 'Forbidden' });
    const { stage_id, position } = req.body;
    const r = await query(
      `UPDATE projects SET stage_id = $1, position = COALESCE($2, position), updated_at = NOW()
       WHERE id = $3 AND organization_id = $4 RETURNING *`,
      [stage_id, position, req.params.id, org.organization_id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Apply template to existing project (adds tasks from template)
router.post('/:id/apply-template', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !(await canEditProject(req.userId, org))) return res.status(403).json({ error: 'Forbidden' });
    const { template_id, assigned_to, start_date } = req.body;
    if (!template_id) return res.status(400).json({ error: 'template_id required' });
    const tmplTasks = await query(
      `SELECT * FROM project_template_tasks WHERE template_id = $1 ORDER BY position ASC`,
      [template_id]
    );
    const taskIdMap = {};
    const maxPosR = await query(`SELECT COALESCE(MAX(position), -1) + 1 as pos FROM project_tasks WHERE project_id = $1`, [req.params.id]);
    let basePos = maxPosR.rows[0].pos;
    let cumulativeDays = 0;
    for (const t of tmplTasks.rows) {
      const baseDate = start_date ? new Date(start_date) : new Date();
      const startD = new Date(baseDate);
      startD.setDate(startD.getDate() + cumulativeDays);
      const endD = new Date(startD);
      endD.setDate(endD.getDate() + (t.duration_days || 1));
      cumulativeDays += (t.duration_days || 1);
      const tr = await query(
        `INSERT INTO project_tasks (project_id, title, description, position, duration_days, start_date, end_date, assigned_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [req.params.id, t.title, t.description, basePos + t.position, t.duration_days, startD, endD, assigned_to || null]
      );
      taskIdMap[t.position] = tr.rows[0].id;
    }
    for (const t of tmplTasks.rows) {
      if (t.depends_on_position != null && taskIdMap[t.depends_on_position]) {
        await query(`UPDATE project_tasks SET depends_on = $1 WHERE id = $2`, [taskIdMap[t.depends_on_position], taskIdMap[t.position]]);
      }
    }
    res.json({ success: true, count: tmplTasks.rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete project (admin/manager only)
router.delete('/:id', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !canManage(org.role)) return res.status(403).json({ error: 'Forbidden' });
    await query(`DELETE FROM projects WHERE id = $1 AND organization_id = $2`, [req.params.id, org.organization_id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================
// ATTACHMENTS
// ========================

router.get('/:id/attachments', async (req, res) => {
  try {
    const r = await query(
      `SELECT pa.*, u.name as uploaded_by_name FROM project_attachments pa
       LEFT JOIN users u ON pa.uploaded_by = u.id
       WHERE pa.project_id = $1 ORDER BY pa.created_at DESC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (e) {
    if (isMissing(e)) return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/attachments', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !(await canEditProject(req.userId, org))) return res.status(403).json({ error: 'Forbidden' });
    const { name, url, mimetype, size } = req.body;
    const r = await query(
      `INSERT INTO project_attachments (project_id, name, url, mimetype, size, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, name, url, mimetype, size, req.userId]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/attachments/:attId', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !(await canEditProject(req.userId, org))) return res.status(403).json({ error: 'Forbidden' });
    await query(`DELETE FROM project_attachments WHERE id = $1`, [req.params.attId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================
// NOTES (chat-like)
// ========================

router.get('/:id/notes', async (req, res) => {
  try {
    const r = await query(
      `SELECT pn.*, u.name as user_name FROM project_notes pn
       LEFT JOIN users u ON pn.user_id = u.id
       WHERE pn.project_id = $1 ORDER BY pn.created_at ASC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (e) {
    if (isMissing(e)) return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/notes', async (req, res) => {
  try {
    const { content, parent_id } = req.body;
    const r = await query(
      `INSERT INTO project_notes (project_id, user_id, content, parent_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, req.userId, content, parent_id || null]
    );
    const full = await query(
      `SELECT pn.*, u.name as user_name FROM project_notes pn LEFT JOIN users u ON pn.user_id = u.id WHERE pn.id = $1`,
      [r.rows[0].id]
    );

    // Create notification for other project participants
    try {
      const project = await query(`SELECT p.title, p.deal_id, p.requested_by, p.assigned_to FROM projects p WHERE p.id = $1`, [req.params.id]);
      if (project.rows[0]) {
        const proj = project.rows[0];
        const notifyUserIds = new Set([proj.requested_by, proj.assigned_to].filter(id => id && id !== req.userId));
        
        // Also notify deal owner if applicable
        if (proj.deal_id) {
          const dealOwner = await query(`SELECT owner_id FROM crm_deals WHERE id = $1`, [proj.deal_id]);
          if (dealOwner.rows[0]?.owner_id && dealOwner.rows[0].owner_id !== req.userId) {
            notifyUserIds.add(dealOwner.rows[0].owner_id);
          }
        }

        const senderName = full.rows[0]?.user_name || 'Usuário';
        for (const uid of notifyUserIds) {
          try {
            await query(
              `INSERT INTO project_note_notifications (user_id, project_id, note_id, project_title, sender_name, content_preview)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [uid, req.params.id, r.rows[0].id, proj.title, senderName, content.substring(0, 100)]
            );
          } catch (_) {}
        }
      }
    } catch (_) {}

    res.json(full.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/notes/:noteId', async (req, res) => {
  try {
    await query(`DELETE FROM project_notes WHERE id = $1 AND user_id = $2`, [req.params.noteId, req.userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================
// TASKS (Gantt)
// ========================

router.get('/:id/tasks', async (req, res) => {
  try {
    const r = await query(
      `SELECT pt.*, u.name as assigned_to_name FROM project_tasks pt
       LEFT JOIN users u ON pt.assigned_to = u.id
       WHERE pt.project_id = $1 ORDER BY pt.position ASC`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (e) {
    if (isMissing(e)) return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/tasks', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !(await canEditProject(req.userId, org))) return res.status(403).json({ error: 'Forbidden' });
    const { title, description, start_date, end_date, duration_days, depends_on, assigned_to } = req.body;
    const posR = await query(
      `SELECT COALESCE(MAX(position), -1) + 1 as pos FROM project_tasks WHERE project_id = $1`,
      [req.params.id]
    );
    const r = await query(
      `INSERT INTO project_tasks (project_id, title, description, position, start_date, end_date, duration_days, depends_on, assigned_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.params.id, title, description, posR.rows[0].pos, start_date || null, end_date || null, duration_days || 1, depends_on || null, assigned_to || null]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/tasks/:taskId', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !(await canEditProject(req.userId, org))) return res.status(403).json({ error: 'Forbidden' });
    const { title, description, status, start_date, end_date, duration_days, depends_on, assigned_to, position } = req.body;
    const r = await query(
      `UPDATE project_tasks SET 
        title = COALESCE($1, title), description = COALESCE($2, description),
        status = COALESCE($3, status), start_date = COALESCE($4, start_date),
        end_date = COALESCE($5, end_date), duration_days = COALESCE($6, duration_days),
        depends_on = $7, assigned_to = $8, position = COALESCE($9, position),
        completed_at = CASE WHEN $3 = 'completed' THEN NOW() WHEN $3 IS NOT NULL THEN NULL ELSE completed_at END
       WHERE id = $10 RETURNING *`,
      [title, description, status, start_date, end_date, duration_days, depends_on, assigned_to, position, req.params.taskId]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/tasks/:taskId', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org || !(await canEditProject(req.userId, org))) return res.status(403).json({ error: 'Forbidden' });
    await query(`DELETE FROM project_tasks WHERE id = $1`, [req.params.taskId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ========================
// NOTE NOTIFICATIONS
// ========================

router.get('/note-notifications/unread', async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM project_note_notifications WHERE user_id = $1 AND read = false ORDER BY created_at DESC LIMIT 20`,
      [req.userId]
    );
    res.json(r.rows);
  } catch (e) {
    if (isMissing(e)) return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

router.post('/note-notifications/read-all', async (req, res) => {
  try {
    await query(`UPDATE project_note_notifications SET read = true WHERE user_id = $1`, [req.userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/note-notifications/:id/read', async (req, res) => {
  try {
    await query(`UPDATE project_note_notifications SET read = true WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
