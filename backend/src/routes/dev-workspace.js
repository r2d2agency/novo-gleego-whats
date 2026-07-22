import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';
import { getOrganizationAIConfig } from '../lib/ai-config.js';
import { callAI } from '../lib/ai-caller.js';
import { logInfo, logError } from '../logger.js';

const router = Router();

// -------------------- Self-heal schema --------------------
(async () => {
  try {
    await query(`CREATE TABLE IF NOT EXISTS dev_projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      owner_user_id UUID NOT NULL,
      client_contact_id UUID,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      portal_token TEXT UNIQUE,
      portal_enabled BOOLEAN DEFAULT true,
      cover_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS dev_modules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      position INT DEFAULT 0,
      color TEXT DEFAULT '#6366f1',
      icon TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS dev_phases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
      module_id UUID REFERENCES dev_modules(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      position INT DEFAULT 0,
      start_date TIMESTAMPTZ,
      due_date TIMESTAMPTZ,
      status TEXT DEFAULT 'planned',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS dev_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
      module_id UUID REFERENCES dev_modules(id) ON DELETE SET NULL,
      phase_id UUID REFERENCES dev_phases(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT DEFAULT 'feature',
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'backlog',
      source TEXT DEFAULT 'manual',
      client_note TEXT,
      ai_reasoning TEXT,
      due_date TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      position INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS dev_knowledge (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
      kind TEXT DEFAULT 'markdown',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_url TEXT,
      tokens INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS dev_activity (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES dev_projects(id) ON DELETE CASCADE,
      actor TEXT DEFAULT 'user',
      action TEXT NOT NULL,
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_dev_projects_org ON dev_projects(organization_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_dev_projects_owner ON dev_projects(owner_user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_dev_tasks_proj ON dev_tasks(project_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_dev_phases_proj ON dev_phases(project_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_dev_knowledge_proj ON dev_knowledge(project_id)`);
    // Self-heal new columns for client feedback loop
    await query(`ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS client_feedback TEXT`);
    await query(`ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS client_feedback_note TEXT`);
    await query(`ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS client_feedback_at TIMESTAMPTZ`);
    await query(`ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS contact_email TEXT`);
  } catch (e) { console.error('dev-workspace init error:', e.message); }
})();

// -------------------- Helpers --------------------
async function getUserOrg(userId) {
  const r = await query(
    `SELECT organization_id, role FROM organization_members WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
}

function isAdmin(role) { return ['owner', 'admin', 'manager'].includes(role); }

async function assertProjectAccess(userId, projectId) {
  const org = await getUserOrg(userId);
  if (!org) return null;
  const p = await query(
    `SELECT * FROM dev_projects WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [projectId, org.organization_id]
  );
  if (p.rows.length === 0) return null;
  const proj = p.rows[0];
  // Owner of project or admin of org
  if (proj.owner_user_id === userId || isAdmin(org.role)) return { project: proj, org };
  return null;
}

async function logActivity(projectId, actor, action, payload = {}) {
  try {
    await query(
      `INSERT INTO dev_activity (project_id, actor, action, payload) VALUES ($1, $2, $3, $4)`,
      [projectId, actor, action, JSON.stringify(payload)]
    );
  } catch (_) {}
}

function newPortalToken() {
  return crypto.randomBytes(20).toString('hex');
}

// -------------------- AI helper --------------------
async function aiJSON(organizationId, systemPrompt, userPrompt) {
  const result = await runAI(organizationId, systemPrompt, userPrompt, {
    temperature: 0.3,
    maxTokens: 2500,
    json: true,
  });
  const raw = (result.content || '').trim();
  const jsonText = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    // fallback: find first { .. } block
    const m = jsonText.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
    throw new Error('IA retornou resposta fora do formato JSON esperado');
  }
}

async function aiText(organizationId, systemPrompt, userPrompt, maxTokens = 3000) {
  const result = await runAI(organizationId, systemPrompt, userPrompt, {
    temperature: 0.5,
    maxTokens,
  });
  return result.content || '';
}

// Always use the organization AI config for Workspace AI.
async function runAI(organizationId, systemPrompt, userPrompt, opts) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const cfg = await getOrganizationAIConfig(organizationId).catch(() => null);

  if (cfg && cfg.apiKey) {
    // Use the organization's configured provider directly. If it fails, surface
    // the actual error to the user instead of silently falling back to another
    // provider — the user configured OpenAI/Gemini on purpose.
    return await callAI(
      { provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey },
      messages,
      {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        responseFormat: opts.json && cfg.provider !== 'gemini' ? { type: 'json_object' } : null,
      }
    );
  }

  throw new Error('Chave de IA da organização não encontrada. Em Ajustes → IA, teste a conexão e clique em Salvar Configurações.');
}

// =====================================================
// PUBLIC PORTAL (no auth) — mount BEFORE authenticate
// =====================================================
router.get('/portal/:token', async (req, res) => {
  try {
    const p = await query(
      `SELECT id, name, description, cover_url, created_at
         FROM dev_projects
        WHERE portal_token = $1 AND portal_enabled = true
        LIMIT 1`,
      [req.params.token]
    );
    if (p.rows.length === 0) return res.status(404).json({ error: 'Portal não encontrado' });
    const project = p.rows[0];

    const modules = await query(
      `SELECT id, name, description, color, position FROM dev_modules WHERE project_id = $1 ORDER BY position ASC`,
      [project.id]
    );
    const phases = await query(
      `SELECT id, module_id, name, position, start_date, due_date, status
         FROM dev_phases WHERE project_id = $1 ORDER BY position ASC`,
      [project.id]
    );
    const taskCounts = await query(
      `SELECT phase_id,
              COUNT(*)::int AS total,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::int AS done
         FROM dev_tasks WHERE project_id = $1 GROUP BY phase_id`,
      [project.id]
    );
    const cmap = {};
    for (const r of taskCounts.rows) cmap[r.phase_id] = { total: r.total, done: r.done };

    // Client-visible task list — client requests + anything already sent to testing
    const tasksQ = await query(
      `SELECT id, title, description, status, type, priority, phase_id, module_id, source, client_feedback, client_feedback_note, contact_email, created_at, completed_at, due_date
         FROM dev_tasks
        WHERE project_id = $1
          AND (source = 'client' OR status IN ('testing','done'))
        ORDER BY created_at DESC
        LIMIT 200`,
      [project.id]
    );

    res.json({
      project,
      modules: modules.rows,
      phases: phases.rows.map((ph) => ({ ...ph, task_stats: cmap[ph.id] || { total: 0, done: 0 } })),
      tasks: tasksQ.rows,
    });
  } catch (e) {
    logError('dev_workspace.portal_error', e);
    res.status(500).json({ error: 'Erro ao carregar portal' });
  }
});

router.post('/portal/:token/requests', async (req, res) => {
  try {
    const { title, description, contact_email } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title obrigatório' });
    const p = await query(
      `SELECT id, organization_id FROM dev_projects WHERE portal_token = $1 AND portal_enabled = true LIMIT 1`,
      [req.params.token]
    );
    if (p.rows.length === 0) return res.status(404).json({ error: 'Portal não encontrado' });
    const project = p.rows[0];

    const ins = await query(
      `INSERT INTO dev_tasks (project_id, title, description, type, status, source, client_note)
       VALUES ($1, $2, $3, 'feature', 'backlog', 'client', $4) RETURNING *`,
      [project.id, title.slice(0, 240), (description || '').slice(0, 5000), contact_email || null]
    );
    if (contact_email) {
      try { await query(`UPDATE dev_tasks SET contact_email = $1 WHERE id = $2`, [contact_email, ins.rows[0].id]); } catch (_) {}
    }
    await logActivity(project.id, 'client', 'request_created', { task_id: ins.rows[0].id, contact_email });

    // Async: classify with AI (fire and forget)
    (async () => {
      try {
        const modules = (await query(`SELECT id, name FROM dev_modules WHERE project_id = $1`, [project.id])).rows;
        const phases = (await query(`SELECT id, name, module_id FROM dev_phases WHERE project_id = $1`, [project.id])).rows;
        if (modules.length === 0) return;
        const classification = await aiJSON(
          project.organization_id,
          `Você classifica demandas de clientes de um projeto de software. Responda SEMPRE JSON válido.`,
          `Módulos disponíveis: ${JSON.stringify(modules)}
Fases: ${JSON.stringify(phases)}
Demanda: "${title}\n${description || ''}"
Responda no formato {"module_id": "...", "phase_id": "...", "type": "support|implementation|fix|feature|chore", "priority": "low|medium|high", "reasoning": "..."}`
        );
        await query(
          `UPDATE dev_tasks SET module_id = $1, phase_id = $2, type = COALESCE($3, type), priority = COALESCE($4, priority), ai_reasoning = $5 WHERE id = $6`,
          [classification.module_id || null, classification.phase_id || null, classification.type || null, classification.priority || null, classification.reasoning || null, ins.rows[0].id]
        );
      } catch (e) { logError('dev_workspace.portal_classify_error', e); }
    })();

    res.status(201).json({ ok: true, id: ins.rows[0].id });
  } catch (e) {
    logError('dev_workspace.portal_request_error', e);
    res.status(500).json({ error: 'Erro ao registrar pedido' });
  }
});

// Client feedback on a task (approve / needs-changes). Public via portal token.
router.post('/portal/:token/tasks/:taskId/feedback', async (req, res) => {
  try {
    const { feedback, note } = req.body || {};
    if (!['approved', 'needs_changes'].includes(feedback)) {
      return res.status(400).json({ error: 'feedback deve ser approved ou needs_changes' });
    }
    const p = await query(
      `SELECT id FROM dev_projects WHERE portal_token = $1 AND portal_enabled = true LIMIT 1`,
      [req.params.token]
    );
    if (p.rows.length === 0) return res.status(404).json({ error: 'Portal não encontrado' });
    const projectId = p.rows[0].id;

    const t = await query(
      `SELECT id, status, source FROM dev_tasks WHERE id = $1 AND project_id = $2 LIMIT 1`,
      [req.params.taskId, projectId]
    );
    if (t.rows.length === 0) return res.status(404).json({ error: 'Solicitação não encontrada' });

    // Client can only give feedback on their own requests OR tasks flagged in testing
    const task = t.rows[0];
    if (task.source !== 'client' && task.status !== 'testing') {
      return res.status(403).json({ error: 'Feedback não permitido para esta tarefa' });
    }

    let newStatus = task.status;
    if (feedback === 'approved') newStatus = 'done';
    else if (feedback === 'needs_changes') newStatus = 'in_progress';

    await query(
      `UPDATE dev_tasks
          SET client_feedback = $1,
              client_feedback_note = $2,
              client_feedback_at = NOW(),
              status = $3,
              completed_at = CASE WHEN $3 = 'done' THEN NOW() ELSE completed_at END,
              updated_at = NOW()
        WHERE id = $4`,
      [feedback, (note || '').slice(0, 2000), newStatus, req.params.taskId]
    );
    await logActivity(projectId, 'client', 'task_feedback', { task_id: req.params.taskId, feedback, note });
    res.json({ ok: true, status: newStatus });
  } catch (e) {
    logError('dev_workspace.portal_feedback_error', e);
    res.status(500).json({ error: 'Erro ao registrar feedback' });
  }
});

// =====================================================
// AUTHENTICATED ROUTES
// =====================================================
router.use(authenticate);

// -------- Global tasks across all projects (kanban) --------
router.get('/tasks-all', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.json([]);
    const rows = await query(
      `SELECT t.*, p.name AS project_name, ph.name AS phase_name, m.name AS module_name, m.color AS module_color
         FROM dev_tasks t
         JOIN dev_projects p ON p.id = t.project_id
         LEFT JOIN dev_phases ph ON ph.id = t.phase_id
         LEFT JOIN dev_modules m ON m.id = t.module_id
        WHERE p.organization_id = $1
          AND (p.owner_user_id = $2 OR $3)
        ORDER BY
          CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
          t.created_at DESC
        LIMIT 1000`,
      [org.organization_id, req.userId, isAdmin(org.role)]
    );
    res.json(rows.rows);
  } catch (e) { logError('dev.tasks_all', e); res.status(500).json({ error: e.message }); }
});

// -------- Projects --------
router.get('/projects', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.json([]);
    const rows = await query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM dev_tasks WHERE project_id = p.id)::int AS total_tasks,
              (SELECT COUNT(*) FROM dev_tasks WHERE project_id = p.id AND status = 'done')::int AS done_tasks,
              (SELECT MIN(due_date) FROM dev_phases WHERE project_id = p.id AND status <> 'done' AND due_date IS NOT NULL) AS next_due
         FROM dev_projects p
        WHERE p.organization_id = $1
          AND (p.owner_user_id = $2 OR $3)
        ORDER BY p.updated_at DESC`,
      [org.organization_id, req.userId, isAdmin(org.role)]
    );
    res.json(rows.rows);
  } catch (e) { logError('dev.list_projects', e); res.status(500).json({ error: e.message }); }
});

router.post('/projects', async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    const { name, description, client_contact_id } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name obrigatório' });
    const r = await query(
      `INSERT INTO dev_projects (organization_id, owner_user_id, client_contact_id, name, description, portal_token)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [org.organization_id, req.userId, client_contact_id || null, name, description || null, newPortalToken()]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { logError('dev.create_project', e); res.status(500).json({ error: e.message }); }
});

router.get('/projects/:id', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  res.json(acc.project);
});

router.patch('/projects/:id', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const fields = ['name', 'description', 'status', 'client_contact_id', 'portal_enabled', 'cover_url'];
  const sets = []; const vals = []; let i = 1;
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(req.body[f]); }
  if (sets.length === 0) return res.json(acc.project);
  sets.push(`updated_at = NOW()`);
  vals.push(req.params.id);
  const r = await query(`UPDATE dev_projects SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  res.json(r.rows[0]);
});

router.post('/projects/:id/regenerate-token', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const t = newPortalToken();
  await query(`UPDATE dev_projects SET portal_token = $1, updated_at = NOW() WHERE id = $2`, [t, req.params.id]);
  res.json({ portal_token: t });
});

router.delete('/projects/:id', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  await query(`DELETE FROM dev_projects WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// -------- Modules --------
router.get('/projects/:id/modules', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const r = await query(`SELECT * FROM dev_modules WHERE project_id = $1 ORDER BY position ASC`, [req.params.id]);
  res.json(r.rows);
});

router.post('/projects/:id/modules', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const { name, description, color, icon } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name obrigatório' });
  const pos = (await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM dev_modules WHERE project_id = $1`, [req.params.id])).rows[0].p;
  const r = await query(
    `INSERT INTO dev_modules (project_id, name, description, color, icon, position)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.params.id, name, description || null, color || '#6366f1', icon || null, pos]
  );
  res.status(201).json(r.rows[0]);
});

router.patch('/modules/:id', async (req, res) => {
  const r = await query(`SELECT project_id FROM dev_modules WHERE id = $1`, [req.params.id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  const acc = await assertProjectAccess(req.userId, r.rows[0].project_id);
  if (!acc) return res.status(403).json({ error: 'Acesso negado' });
  const fields = ['name', 'description', 'color', 'icon', 'position'];
  const sets = []; const vals = []; let i = 1;
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(req.body[f]); }
  if (sets.length === 0) return res.json({ ok: true });
  vals.push(req.params.id);
  const upd = await query(`UPDATE dev_modules SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  res.json(upd.rows[0]);
});

router.delete('/modules/:id', async (req, res) => {
  const r = await query(`SELECT project_id FROM dev_modules WHERE id = $1`, [req.params.id]);
  if (r.rows.length === 0) return res.json({ ok: true });
  const acc = await assertProjectAccess(req.userId, r.rows[0].project_id);
  if (!acc) return res.status(403).json({ error: 'Acesso negado' });
  await query(`DELETE FROM dev_modules WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// -------- Phases --------
router.get('/projects/:id/phases', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const r = await query(`SELECT * FROM dev_phases WHERE project_id = $1 ORDER BY position ASC`, [req.params.id]);
  res.json(r.rows);
});

router.post('/projects/:id/phases', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const { module_id, name, description, start_date, due_date, status } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name obrigatório' });
  const pos = (await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM dev_phases WHERE project_id = $1`, [req.params.id])).rows[0].p;
  const r = await query(
    `INSERT INTO dev_phases (project_id, module_id, name, description, start_date, due_date, status, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.params.id, module_id || null, name, description || null, start_date || null, due_date || null, status || 'planned', pos]
  );
  res.status(201).json(r.rows[0]);
});

router.patch('/phases/:id', async (req, res) => {
  const r = await query(`SELECT project_id FROM dev_phases WHERE id = $1`, [req.params.id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  const acc = await assertProjectAccess(req.userId, r.rows[0].project_id);
  if (!acc) return res.status(403).json({ error: 'Acesso negado' });
  const fields = ['module_id', 'name', 'description', 'start_date', 'due_date', 'status', 'position', 'completed_at'];
  const sets = []; const vals = []; let i = 1;
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(req.body[f]); }
  if (req.body.status === 'done' && !req.body.completed_at) { sets.push(`completed_at = NOW()`); }
  if (sets.length === 0) return res.json({ ok: true });
  vals.push(req.params.id);
  const upd = await query(`UPDATE dev_phases SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  res.json(upd.rows[0]);
});

router.delete('/phases/:id', async (req, res) => {
  const r = await query(`SELECT project_id FROM dev_phases WHERE id = $1`, [req.params.id]);
  if (r.rows.length === 0) return res.json({ ok: true });
  const acc = await assertProjectAccess(req.userId, r.rows[0].project_id);
  if (!acc) return res.status(403).json({ error: 'Acesso negado' });
  await query(`DELETE FROM dev_phases WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// -------- Tasks --------
router.get('/projects/:id/tasks', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const r = await query(`SELECT * FROM dev_tasks WHERE project_id = $1 ORDER BY created_at DESC`, [req.params.id]);
  res.json(r.rows);
});

router.post('/projects/:id/tasks', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const { module_id, phase_id, title, description, type, priority, status, due_date } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title obrigatório' });
  const r = await query(
    `INSERT INTO dev_tasks (project_id, module_id, phase_id, title, description, type, priority, status, source, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', $9) RETURNING *`,
    [req.params.id, module_id || null, phase_id || null, title, description || null,
     type || 'feature', priority || 'medium', status || 'backlog', due_date || null]
  );
  res.status(201).json(r.rows[0]);
});

router.patch('/tasks/:id', async (req, res) => {
  const r = await query(`SELECT project_id FROM dev_tasks WHERE id = $1`, [req.params.id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  const acc = await assertProjectAccess(req.userId, r.rows[0].project_id);
  if (!acc) return res.status(403).json({ error: 'Acesso negado' });
  const fields = ['module_id', 'phase_id', 'title', 'description', 'type', 'priority', 'status', 'due_date', 'completed_at', 'position'];
  const sets = []; const vals = []; let i = 1;
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(req.body[f]); }
  if (req.body.status === 'done' && req.body.completed_at === undefined) { sets.push(`completed_at = NOW()`); }
  sets.push(`updated_at = NOW()`);
  if (sets.length === 1) return res.json({ ok: true });
  vals.push(req.params.id);
  const upd = await query(`UPDATE dev_tasks SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  res.json(upd.rows[0]);
});

router.delete('/tasks/:id', async (req, res) => {
  const r = await query(`SELECT project_id FROM dev_tasks WHERE id = $1`, [req.params.id]);
  if (r.rows.length === 0) return res.json({ ok: true });
  const acc = await assertProjectAccess(req.userId, r.rows[0].project_id);
  if (!acc) return res.status(403).json({ error: 'Acesso negado' });
  await query(`DELETE FROM dev_tasks WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// -------- Knowledge (brain) --------
router.get('/projects/:id/knowledge', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const r = await query(
    `SELECT id, kind, title, source_url, tokens, created_at, LEFT(content, 200) AS preview
       FROM dev_knowledge WHERE project_id = $1 ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json(r.rows);
});

router.post('/projects/:id/knowledge', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const { title, content, kind, source_url } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'title e content obrigatórios' });
  const tokens = Math.ceil(content.length / 4);
  const r = await query(
    `INSERT INTO dev_knowledge (project_id, kind, title, content, source_url, tokens)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title, kind, created_at, tokens`,
    [req.params.id, kind || 'markdown', title, content.slice(0, 500000), source_url || null, tokens]
  );
  res.status(201).json(r.rows[0]);
});

router.delete('/knowledge/:id', async (req, res) => {
  const r = await query(`SELECT project_id FROM dev_knowledge WHERE id = $1`, [req.params.id]);
  if (r.rows.length === 0) return res.json({ ok: true });
  const acc = await assertProjectAccess(req.userId, r.rows[0].project_id);
  if (!acc) return res.status(403).json({ error: 'Acesso negado' });
  await query(`DELETE FROM dev_knowledge WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

async function loadBrain(projectId, limitChars = 60000) {
  const r = await query(
    `SELECT title, content FROM dev_knowledge WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  let out = '';
  for (const row of r.rows) {
    const block = `\n\n### ${row.title}\n${row.content}`;
    if ((out + block).length > limitChars) { out += block.slice(0, limitChars - out.length); break; }
    out += block;
  }
  return out.trim();
}

// -------- AI endpoints --------
router.post('/projects/:id/ai/breakdown', async (req, res) => {
  try {
    const acc = await assertProjectAccess(req.userId, req.params.id);
    if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
    const { briefing, extra_context } = req.body || {};
    if (!briefing) return res.status(400).json({ error: 'briefing obrigatório' });

    const brain = await loadBrain(req.params.id, 20000);
    const data = await aiJSON(
      acc.org.organization_id,
      `Você é um arquiteto de software. Divida projetos em módulos, fases sequenciais e tarefas iniciais. Responda EXCLUSIVAMENTE JSON válido.`,
      `Projeto: ${acc.project.name}
Briefing: ${briefing}
Contexto extra: ${extra_context || 'nenhum'}
Base de conhecimento existente:
${brain || '(vazia)'}

Estrutura esperada (responda apenas com JSON):
{
  "modules": [
    { "name": "Nome do módulo", "description": "...", "color": "#hex",
      "phases": [
        { "name": "Descoberta", "description": "...", "duration_days": 7,
          "tasks": [ { "title": "...", "description": "...", "type": "implementation|feature|fix|support|chore", "priority": "low|medium|high" } ] }
      ] }
  ]
}`
    );
    res.json(data);
  } catch (e) { logError('dev.ai_breakdown', e); res.status(500).json({ error: e.message }); }
});

router.post('/projects/:id/ai/apply-breakdown', async (req, res) => {
  try {
    const acc = await assertProjectAccess(req.userId, req.params.id);
    if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
    const { modules } = req.body || {};
    if (!Array.isArray(modules)) return res.status(400).json({ error: 'modules obrigatório (array)' });

    const projectId = req.params.id;
    const startBase = new Date();
    let phaseOffset = 0;
    let modPos = (await query(`SELECT COALESCE(MAX(position),-1)+1 AS p FROM dev_modules WHERE project_id = $1`, [projectId])).rows[0].p;

    for (const m of modules) {
      const mr = await query(
        `INSERT INTO dev_modules (project_id, name, description, color, position) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [projectId, m.name || 'Módulo', m.description || null, m.color || '#6366f1', modPos++]
      );
      const moduleId = mr.rows[0].id;
      let phPos = 0;
      for (const ph of (m.phases || [])) {
        const start = new Date(startBase.getTime() + phaseOffset * 24 * 3600 * 1000);
        const duration = Number(ph.duration_days) || 7;
        const due = new Date(start.getTime() + duration * 24 * 3600 * 1000);
        phaseOffset += duration;
        const pr = await query(
          `INSERT INTO dev_phases (project_id, module_id, name, description, start_date, due_date, status, position)
           VALUES ($1,$2,$3,$4,$5,$6,'planned',$7) RETURNING id`,
          [projectId, moduleId, ph.name || 'Fase', ph.description || null, start.toISOString(), due.toISOString(), phPos++]
        );
        const phaseId = pr.rows[0].id;
        for (const t of (ph.tasks || [])) {
          await query(
            `INSERT INTO dev_tasks (project_id, module_id, phase_id, title, description, type, priority, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'ai')`,
            [projectId, moduleId, phaseId, t.title || 'Task', t.description || null, t.type || 'feature', t.priority || 'medium']
          );
        }
      }
    }
    await logActivity(projectId, 'ai', 'breakdown_applied', { module_count: modules.length });
    res.json({ ok: true });
  } catch (e) { logError('dev.apply_breakdown', e); res.status(500).json({ error: e.message }); }
});

router.post('/projects/:id/ai/classify-demand', async (req, res) => {
  try {
    const acc = await assertProjectAccess(req.userId, req.params.id);
    if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text obrigatório' });

    const modules = (await query(`SELECT id, name, description FROM dev_modules WHERE project_id = $1`, [req.params.id])).rows;
    const phases = (await query(`SELECT id, name, module_id FROM dev_phases WHERE project_id = $1`, [req.params.id])).rows;

    const data = await aiJSON(
      acc.org.organization_id,
      `Você classifica demandas de clientes em projetos de software. Responda apenas JSON.`,
      `Módulos: ${JSON.stringify(modules)}
Fases: ${JSON.stringify(phases)}
Demanda do cliente: "${text}"
Responda: {"title": "resumo curto (max 80 chars)", "description": "detalhamento", "module_id": "uuid|null", "phase_id": "uuid|null", "type": "support|implementation|fix|feature|chore", "priority": "low|medium|high", "reasoning": "por que classificou assim"}`
    );

    // Optionally create the task
    if (req.body.create) {
      const t = await query(
        `INSERT INTO dev_tasks (project_id, module_id, phase_id, title, description, type, priority, source, ai_reasoning, client_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ai',$8,$9) RETURNING *`,
        [req.params.id, data.module_id || null, data.phase_id || null,
         data.title || text.slice(0, 80), data.description || text,
         data.type || 'feature', data.priority || 'medium',
         data.reasoning || null, text.slice(0, 5000)]
      );
      return res.json({ classification: data, task: t.rows[0] });
    }
    res.json({ classification: data });
  } catch (e) { logError('dev.classify_demand', e); res.status(500).json({ error: e.message }); }
});

router.post('/projects/:id/ai/ask', async (req, res) => {
  try {
    const acc = await assertProjectAccess(req.userId, req.params.id);
    if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
    const { question } = req.body || {};
    if (!question) return res.status(400).json({ error: 'question obrigatório' });
    const brain = await loadBrain(req.params.id, 50000);
    if (!brain) return res.json({ answer: 'Nenhum documento no cérebro deste projeto ainda. Suba um .md ou cole conteúdo para eu conseguir responder.' });
    const ans = await aiText(
      acc.org.organization_id,
      `Você responde perguntas com base APENAS no contexto do projeto abaixo. Se a resposta não estiver no contexto, diga que não sabe.`,
      `CONTEXTO DO PROJETO ${acc.project.name}:\n${brain}\n\nPergunta: ${question}`,
      1500
    );
    res.json({ answer: ans });
  } catch (e) { logError('dev.ai_ask', e); res.status(500).json({ error: e.message }); }
});

router.post('/projects/:id/ai/roadmap', async (req, res) => {
  try {
    const acc = await assertProjectAccess(req.userId, req.params.id);
    if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
    const modules = (await query(`SELECT * FROM dev_modules WHERE project_id = $1 ORDER BY position`, [req.params.id])).rows;
    const phases = (await query(`SELECT * FROM dev_phases WHERE project_id = $1 ORDER BY position`, [req.params.id])).rows;
    const tasks = (await query(`SELECT * FROM dev_tasks WHERE project_id = $1 ORDER BY created_at`, [req.params.id])).rows;
    const brain = await loadBrain(req.params.id, 20000);

    const md = await aiText(
      acc.org.organization_id,
      `Você gera roadmaps em Markdown limpo (títulos, listas, tabelas). Não invente informação — use apenas o que está nos dados.`,
      `Projeto: ${acc.project.name}
Descrição: ${acc.project.description || ''}

Módulos: ${JSON.stringify(modules)}
Fases: ${JSON.stringify(phases)}
Tasks: ${JSON.stringify(tasks.map(t => ({ title: t.title, status: t.status, type: t.type, priority: t.priority, phase_id: t.phase_id, module_id: t.module_id, due_date: t.due_date })))}

Cérebro: ${brain || '(vazio)'}

Gere um roadmap Markdown com:
1. Resumo do projeto
2. Status atual (o que foi entregue)
3. Em andamento
4. Próximos passos por fase (com datas)
5. Riscos e itens em atraso
`,
      3500
    );
    res.json({ markdown: md });
  } catch (e) { logError('dev.ai_roadmap', e); res.status(500).json({ error: e.message }); }
});

// -------- Gantt / deadlines --------
router.get('/projects/:id/gantt', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const phases = (await query(
    `SELECT p.id, p.name, p.start_date, p.due_date, p.status, p.module_id, m.name AS module_name, m.color AS module_color, p.position
       FROM dev_phases p LEFT JOIN dev_modules m ON m.id = p.module_id
      WHERE p.project_id = $1
      ORDER BY p.position ASC`,
    [req.params.id]
  )).rows;

  const now = Date.now();
  const withStatus = phases.map((ph) => {
    let deadline_status = 'ok';
    if (ph.due_date && ph.status !== 'done') {
      const diff = new Date(ph.due_date).getTime() - now;
      if (diff < 0) deadline_status = 'overdue';
      else if (diff < 48 * 3600 * 1000) deadline_status = 'warning';
    }
    return { ...ph, deadline_status };
  });
  res.json({ phases: withStatus });
});

router.get('/projects/:id/activity', async (req, res) => {
  const acc = await assertProjectAccess(req.userId, req.params.id);
  if (!acc) return res.status(404).json({ error: 'Projeto não encontrado' });
  const r = await query(
    `SELECT * FROM dev_activity WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.params.id]
  );
  res.json(r.rows);
});

export default router;