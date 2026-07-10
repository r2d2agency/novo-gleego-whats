import express from 'express';
import multer from 'multer';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { logInfo, logError } from '../logger.js';
import { callAI } from '../lib/ai-caller.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Detect ffmpeg availability once (used to shrink audio before Whisper)
let FFMPEG_AVAILABLE = null;
function hasFfmpeg() {
  if (FFMPEG_AVAILABLE !== null) return FFMPEG_AVAILABLE;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', timeout: 5000 });
    FFMPEG_AVAILABLE = true;
  } catch {
    FFMPEG_AVAILABLE = false;
  }
  return FFMPEG_AVAILABLE;
}

// Convert any input audio to a compact mono 16kHz MP3.
// A 30-min mic recording becomes ~7 MB — Whisper's 25 MB limit stops being a problem.
function transcodeToCompactMp3(inputPath) {
  if (!hasFfmpeg()) return null;
  const outPath = inputPath.replace(/\.[^.]+$/, '') + '.compact.mp3';
  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -vn -ac 1 -ar 16000 -b:a 32k "${outPath}"`,
      { stdio: 'ignore', timeout: 10 * 60 * 1000 }
    );
    return fs.existsSync(outPath) ? outPath : null;
  } catch (err) {
    logError('ffmpeg transcode failed', err);
    return null;
  }
}

const router = express.Router();

const uploadDir = path.join(process.cwd(), 'uploads', 'telehealth');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.webm`),
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

// Multer for chunked uploads — stored in per-session temp folder
const chunkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadDir, `upload-${req.params.id}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const idx = String(req.headers['x-chunk-index'] || '0').padStart(6, '0');
    cb(null, `chunk_${idx}.part`);
  },
});
const chunkUpload = multer({ storage: chunkStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// Helper to get user's organization
async function getUserOrganization(userId) {
  const result = await query(
    `SELECT om.organization_id, om.role, u.name
     FROM organization_members om
     JOIN users u ON u.id = om.user_id
     WHERE om.user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

// Init tables
async function ensureTables() {
  try {
    await query(`CREATE TABLE IF NOT EXISTS telehealth_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      created_by UUID NOT NULL,
      title VARCHAR(500),
      reason TEXT,
      notes TEXT,
      contact_id UUID,
      contact_name VARCHAR(255),
      deal_id UUID,
      deal_title VARCHAR(255),
      status VARCHAR(30) NOT NULL DEFAULT 'waiting',
      audio_url TEXT,
      audio_size BIGINT,
      audio_duration INTEGER,
      audio_mime VARCHAR(100),
      transcript TEXT,
      structured_content JSONB,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      consent_given BOOLEAN DEFAULT false,
      attachments JSONB DEFAULT '[]'::jsonb,
      audio_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    )`);
    await query(`CREATE TABLE IF NOT EXISTS telehealth_audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL,
      organization_id UUID NOT NULL,
      user_id UUID NOT NULL,
      user_name VARCHAR(255),
      action VARCHAR(100) NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    logInfo('Telehealth tables ensured');
  } catch (e) {
    logError('Failed to ensure telehealth tables', e);
  }
}
ensureTables();

async function auditLog(sessionId, orgId, userId, userName, action, details = null) {
  try {
    await query(
      `INSERT INTO telehealth_audit_logs (session_id, organization_id, user_id, user_name, action, details)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [sessionId, orgId, userId, userName, action, details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    logError('Audit log error', e);
  }
}

async function getAIConfig(userId) {
  try {
    const r = await query(
      `SELECT o.ai_provider, o.ai_model, o.ai_api_key
       FROM organizations o
       JOIN organization_members om ON om.organization_id = o.id
       WHERE om.user_id = $1 LIMIT 1`,
      [userId]
    );
    if (!r.rows.length || !r.rows[0].ai_api_key) return null;
    return { provider: r.rows[0].ai_provider || 'openai', model: r.rows[0].ai_model, apiKey: r.rows[0].ai_api_key };
  } catch { return null; }
}

// LIST sessions
router.get('/', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    const { status, contact_id, deal_id, search } = req.query;
    let sql = `SELECT * FROM telehealth_sessions WHERE organization_id = $1 AND deleted_at IS NULL`;
    const params = [org.organization_id];
    let idx = 2;
    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }
    if (contact_id) { sql += ` AND contact_id = $${idx++}`; params.push(contact_id); }
    if (deal_id) { sql += ` AND deal_id = $${idx++}`; params.push(deal_id); }
    if (search) { sql += ` AND (title ILIKE $${idx} OR contact_name ILIKE $${idx} OR reason ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    sql += ` ORDER BY created_at DESC LIMIT 100`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (e) {
    logError('List telehealth sessions error', e);
    res.status(500).json({ error: e.message });
  }
});

// GET single session
router.get('/:id', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    const r = await query(
      `SELECT * FROM telehealth_sessions WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [req.params.id, org.organization_id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Sessão não encontrada' });
    const logs = await query(
      `SELECT * FROM telehealth_audit_logs WHERE session_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ ...r.rows[0], audit_logs: logs.rows });
  } catch (e) {
    logError('Get telehealth session error', e);
    res.status(500).json({ error: e.message });
  }
});

// CREATE session
router.post('/', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    const { title, reason, contact_id, contact_name, deal_id, deal_title, consent_given } = req.body;
    const r = await query(
      `INSERT INTO telehealth_sessions (organization_id, created_by, title, reason, contact_id, contact_name, deal_id, deal_title, consent_given)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [org.organization_id, req.userId, title, reason, contact_id || null, contact_name || null, deal_id || null, deal_title || null, consent_given || false]
    );
    await auditLog(r.rows[0].id, org.organization_id, req.userId, org.name, 'session_created');
    res.json(r.rows[0]);
  } catch (e) {
    logError('Create telehealth session error', e);
    res.status(500).json({ error: e.message });
  }
});

// UPDATE session (notes, reason, attachments, etc)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    const allowed = ['title', 'reason', 'notes', 'contact_id', 'contact_name', 'deal_id', 'deal_title', 'consent_given', 'attachments', 'status'];
    const sets = [];
    const params = [];
    let idx = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = $${idx++}`);
        params.push(key === 'attachments' ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id, org.organization_id);
    const r = await query(
      `UPDATE telehealth_sessions SET ${sets.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Sessão não encontrada' });
    await auditLog(r.rows[0].id, org.organization_id, req.userId, org.name, 'session_updated', { fields: Object.keys(req.body) });
    res.json(r.rows[0]);
  } catch (e) {
    logError('Update telehealth session error', e);
    res.status(500).json({ error: e.message });
  }
});

// UPLOAD audio
router.post('/:id/audio', authenticate, upload.single('audio'), async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    if (!req.file) return res.status(400).json({ error: 'Arquivo de áudio obrigatório' });
    const reason = req.headers['x-session-reason'] || '';
    const notes = req.headers['x-session-notes'] || '';
    const duration = parseInt(req.headers['x-session-duration'] || '0');
    const audioUrl = `/uploads/telehealth/${req.file.filename}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const r = await query(
      `UPDATE telehealth_sessions SET
        audio_url = $1, audio_size = $2, audio_duration = $3, audio_mime = $4,
        reason = COALESCE(NULLIF($5,''), reason), notes = COALESCE(NULLIF($6,''), notes),
        status = 'processing', audio_expires_at = $7, updated_at = NOW()
       WHERE id = $8 AND organization_id = $9 RETURNING *`,
      [audioUrl, req.file.size, duration, req.file.mimetype, reason, notes, expiresAt, req.params.id, org.organization_id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Sessão não encontrada' });
    await auditLog(r.rows[0].id, org.organization_id, req.userId, org.name, 'audio_uploaded', { size: req.file.size, duration });

    // Start async processing
    processSession(r.rows[0].id, req.userId, org.organization_id, org.name).catch(e => logError('Process session error', e));

    res.json(r.rows[0]);
  } catch (e) {
    logError('Upload telehealth audio error', e);
    res.status(500).json({ error: e.message });
  }
});

// RETRY processing
router.post('/:id/retry', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    // Allow retry for sessions that errored OR got stuck (still marked processing/transcribing without a transcript)
    const r = await query(
      `UPDATE telehealth_sessions
       SET status = 'processing', error_message = NULL, retry_count = retry_count + 1, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
         AND (status = 'error' OR (status IN ('processing','transcribing') AND transcript IS NULL))
       RETURNING *`,
      [req.params.id, org.organization_id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Sessão não pode ser reprocessada (já concluída ou inexistente)' });
    if (!r.rows[0].audio_url) return res.status(400).json({ error: 'Sessão sem áudio para reprocessar' });
    await auditLog(r.rows[0].id, org.organization_id, req.userId, org.name, 'retry_processing');
    processSession(r.rows[0].id, req.userId, org.organization_id, org.name).catch(e => logError('Retry process error', e));
    res.json(r.rows[0]);
  } catch (e) {
    logError('Retry telehealth error', e);
    res.status(500).json({ error: e.message });
  }
});

// UPLOAD chunk - resilient upload for long recordings
// Client streams chunks (e.g. 15s each) as they are recorded; each chunk can retry
// independently without restarting the whole upload.
router.post('/:id/audio/chunk', authenticate, chunkUpload.single('chunk'), async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    if (!req.file) return res.status(400).json({ error: 'Chunk obrigatório' });
    // Verify session belongs to org
    const r = await query(
      `SELECT id FROM telehealth_sessions WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [req.params.id, org.organization_id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Sessão não encontrada' });
    const idx = parseInt(req.headers['x-chunk-index'] || '0');
    res.json({ ok: true, index: idx, size: req.file.size });
  } catch (e) {
    logError('Chunk upload error', e);
    res.status(500).json({ error: e.message });
  }
});

// FINALIZE chunked upload - concatenate chunks and trigger processing
router.post('/:id/audio/finalize', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    const { reason = '', notes = '', duration = 0, mime = 'audio/webm', total_chunks } = req.body || {};

    const sessionR = await query(
      `SELECT * FROM telehealth_sessions WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [req.params.id, org.organization_id]
    );
    if (!sessionR.rows.length) return res.status(404).json({ error: 'Sessão não encontrada' });

    const chunkDir = path.join(uploadDir, `upload-${req.params.id}`);
    if (!fs.existsSync(chunkDir)) return res.status(400).json({ error: 'Nenhum chunk recebido' });
    const files = fs.readdirSync(chunkDir).filter(f => f.startsWith('chunk_')).sort();
    if (!files.length) return res.status(400).json({ error: 'Nenhum chunk encontrado' });
    if (total_chunks && files.length < parseInt(total_chunks)) {
      return res.status(400).json({ error: `Chunks incompletos: ${files.length}/${total_chunks}` });
    }

    // Concatenate binary chunks into single file (webm/opus tolerates naive concat;
    // ffmpeg re-encoding downstream normalizes any container issues).
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : 'webm';
    const finalName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const finalPath = path.join(uploadDir, finalName);
    const out = fs.createWriteStream(finalPath);
    for (const f of files) {
      const buf = fs.readFileSync(path.join(chunkDir, f));
      out.write(buf);
    }
    await new Promise(resolve => out.end(resolve));
    const stats = fs.statSync(finalPath);
    // Cleanup chunk folder
    try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch {}

    const audioUrl = `/uploads/telehealth/${finalName}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const upd = await query(
      `UPDATE telehealth_sessions SET
        audio_url = $1, audio_size = $2, audio_duration = $3, audio_mime = $4,
        reason = COALESCE(NULLIF($5,''), reason), notes = COALESCE(NULLIF($6,''), notes),
        status = 'processing', audio_expires_at = $7, updated_at = NOW()
       WHERE id = $8 AND organization_id = $9 RETURNING *`,
      [audioUrl, stats.size, parseInt(duration) || 0, mime, reason, notes, expiresAt, req.params.id, org.organization_id]
    );
    await auditLog(upd.rows[0].id, org.organization_id, req.userId, org.name, 'audio_uploaded_chunked', {
      size: stats.size, duration, chunks: files.length,
    });

    processSession(upd.rows[0].id, req.userId, org.organization_id, org.name).catch(e => logError('Process session error', e));
    res.json(upd.rows[0]);
  } catch (e) {
    logError('Finalize chunked upload error', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE session (soft)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    const r = await query(
      `UPDATE telehealth_sessions SET deleted_at = NOW() WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [req.params.id, org.organization_id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Sessão não encontrada' });
    await auditLog(req.params.id, org.organization_id, req.userId, org.name, 'session_deleted');
    res.json({ success: true });
  } catch (e) {
    logError('Delete telehealth session error', e);
    res.status(500).json({ error: e.message });
  }
});

// GET audit logs for session
router.get('/:id/audit', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });
    const r = await query(
      `SELECT * FROM telehealth_audit_logs WHERE session_id = $1 AND organization_id = $2 ORDER BY created_at ASC`,
      [req.params.id, org.organization_id]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Async processing pipeline - transcription only (no auto-organize)
async function processSession(sessionId, userId, orgId, userName) {
  try {
    // Step 1: Transcription
    await query(`UPDATE telehealth_sessions SET status = 'transcribing', updated_at = NOW() WHERE id = $1`, [sessionId]);
    await auditLog(sessionId, orgId, userId, userName, 'transcription_started');

    const session = (await query(`SELECT * FROM telehealth_sessions WHERE id = $1`, [sessionId])).rows[0];
    if (!session || !session.audio_url) throw new Error('Sessão ou áudio não encontrado');

    const audioPath = path.join(process.cwd(), session.audio_url);
    if (!fs.existsSync(audioPath)) throw new Error('Arquivo de áudio não encontrado no disco');

    const aiConfig = await getAIConfig(userId);
    // Fallback: if org has no AI config but the platform has LOVABLE_API_KEY, use it for transcription
    const effectiveConfig = aiConfig || (process.env.LOVABLE_API_KEY ? { provider: 'lovable', apiKey: process.env.LOVABLE_API_KEY, model: null } : null);
    if (!effectiveConfig) throw new Error('Configuração de IA não encontrada. Peça ao administrador para configurar um provedor de IA nas configurações da organização.');

    // Pre-transcode to compact MP3 (mono 16kHz 32kbps) so 30-min recordings fit under Whisper's 25MB limit
    let workingPath = audioPath;
    const compact = transcodeToCompactMp3(audioPath);
    if (compact) workingPath = compact;

    let transcript = '';
    try {
      const stats = fs.statSync(workingPath);
      if (stats.size > 24 * 1024 * 1024 && hasFfmpeg()) {
        // Still too big — chunk into 5-min MP3 segments (with re-encode to guarantee size)
        const chunkDir = path.join(uploadDir, `chunks-${sessionId}`);
        if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });
        try {
          execSync(
            `ffmpeg -y -i "${workingPath}" -vn -ac 1 -ar 16000 -b:a 32k -f segment -segment_time 300 "${chunkDir}/chunk_%03d.mp3"`,
            { stdio: 'ignore', timeout: 10 * 60 * 1000 }
          );
          const chunks = fs.readdirSync(chunkDir).sort();
          for (const chunk of chunks) {
            const chunkTranscript = await transcribeAudio(path.join(chunkDir, chunk), effectiveConfig);
            transcript += chunkTranscript + ' ';
          }
        } finally {
          fs.rmSync(chunkDir, { recursive: true, force: true });
        }
      } else {
        transcript = await transcribeAudio(workingPath, effectiveConfig);
      }
    } finally {
      if (compact && compact !== audioPath && fs.existsSync(compact)) {
        try { fs.unlinkSync(compact); } catch {}
      }
    }

    // Step 2: Speaker diarization via AI post-processing
    let diarizedTranscript = transcript;
    try {
      diarizedTranscript = await identifySpeakers(transcript, aiConfig || effectiveConfig, session);
    } catch (diarErr) {
      logError('Speaker diarization failed, using raw transcript', diarErr);
    }

    // Complete after transcription
    await query(
      `UPDATE telehealth_sessions SET transcript = $1, status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [diarizedTranscript, sessionId]
    );
    await auditLog(sessionId, orgId, userId, userName, 'transcription_completed');

  } catch (e) {
    logError(`Telehealth processing error session=${sessionId}`, e);
    await query(
      `UPDATE telehealth_sessions SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [e.message, sessionId]
    );
    await auditLog(sessionId, orgId, userId, userName, 'processing_error', { error: e.message });
  }
}

async function transcribeAudio(audioPath, aiConfig) {
  const audioBuffer = fs.readFileSync(audioPath);
  const ext = path.extname(audioPath).replace('.', '') || 'webm';
  const mimeMap = { webm: 'audio/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };
  const mime = mimeMap[ext] || 'audio/webm';

  // Path 1: OpenAI directly (org has openai key)
  if (aiConfig.provider === 'openai' && aiConfig.apiKey) {
    const audioFile = new File([audioBuffer], `recording.${ext}`, { type: mime });
    const form = new FormData();
    form.append('file', audioFile);
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.append('prompt', 'Transcrição de reunião com múltiplos participantes. Identifique mudanças de falante.');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${aiConfig.apiKey}` },
      body: form,
    });
    if (!resp.ok) throw new Error(`Whisper (OpenAI) ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    if (data.segments && data.segments.length > 0) {
      return data.segments.map(s => {
        const min = Math.floor(s.start / 60);
        const sec = Math.floor(s.start % 60).toString().padStart(2, '0');
        return `[${min}:${sec}] ${s.text.trim()}`;
      }).join('\n');
    }
    return data.text || '';
  }

  // Path 2: Lovable AI Gateway (works for any org — uses platform LOVABLE_API_KEY)
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) {
    const audioFile = new File([audioBuffer], `recording.${ext}`, { type: mime });
    const form = new FormData();
    form.append('file', audioFile);
    form.append('model', 'openai/gpt-4o-mini-transcribe');
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${lovableKey}` },
      body: form,
    });
    if (!resp.ok) throw new Error(`Transcrição (Lovable AI) ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return data.text || '';
  }

  // Gemini fallback
  const audioData = fs.readFileSync(audioPath).toString('base64');
  const messages = [
    { role: 'user', content: [
      { type: 'text', text: `Transcreva o áudio a seguir em português. Esta é uma reunião com múltiplos participantes.
REGRAS IMPORTANTES:
1. Identifique cada falante diferente e atribua um rótulo (ex: "Participante 1:", "Participante 2:" ou o nome se mencionado)
2. Adicione timestamps aproximados no formato [MM:SS] a cada mudança de falante
3. Mantenha a transcrição fiel ao que foi dito
4. Quando detectar mudança de voz/tom, inicie um novo parágrafo com o rótulo do falante

Formato esperado:
[0:00] Participante 1: Texto falado...
[0:15] Participante 2: Resposta...

Retorne apenas a transcrição formatada.` },
      { type: 'input_audio', input_audio: { data: audioData, format: 'webm' } }
    ]}
  ];
  const result = await callAI(aiConfig, messages, { temperature: 0.1, maxTokens: 8000 });
  return result || '';
}

// Post-process transcript to identify speakers using AI
async function identifySpeakers(rawTranscript, aiConfig, session) {
  if (!rawTranscript || rawTranscript.length < 50) return rawTranscript;
  
  const participantInfo = [];
  if (session.contact_name) participantInfo.push(`Contato/Convidado: ${session.contact_name}`);
  if (session.title) participantInfo.push(`Título da reunião: ${session.title}`);
  if (session.reason) participantInfo.push(`Motivo: ${session.reason}`);

  const messages = [
    { role: 'system', content: `Você é um especialista em identificação de falantes em transcrições de reuniões.
Sua tarefa é analisar a transcrição e identificar quem está falando em cada trecho.

REGRAS:
1. Identifique mudanças de falante baseado em: contexto, turnos de fala, mudanças de assunto, respostas diretas
2. Use nomes quando mencionados na conversa, caso contrário use "Participante 1", "Participante 2", etc.
3. Mantenha os timestamps originais se existirem
4. Formato de saída: "[timestamp] Nome/Participante: texto"
5. Se a transcrição já tiver identificação de falantes boa, retorne como está
6. NÃO altere o conteúdo das falas, apenas adicione/corrija os rótulos de falante
7. Retorne APENAS a transcrição formatada, sem explicações adicionais` },
    { role: 'user', content: `${participantInfo.length > 0 ? 'Contexto da reunião:\n' + participantInfo.join('\n') + '\n\n' : ''}Transcrição para processar:\n\n${rawTranscript}` }
  ];

  const result = await callAI(aiConfig, messages, { temperature: 0.1, maxTokens: 8000 });
  return result || rawTranscript;
}

// On-demand AI analysis of transcript
const AI_PROMPTS = {
  resumo: {
    label: 'Resumo da Reunião',
    prompt: `Analise a transcrição a seguir e gere um resumo executivo claro e objetivo da reunião. 
Identifique os participantes mencionados, os principais temas discutidos e as conclusões.
Retorne um JSON: { "titulo": "...", "participantes": ["..."], "resumo": "...", "pontos_principais": ["..."] }`
  },
  ata: {
    label: 'Ata da Reunião',
    prompt: `Analise a transcrição e gere uma ata formal da reunião em formato JSON:
{ "titulo": "...", "data": "...", "participantes": ["..."], "pauta": ["..."], "discussoes": [{"tema": "...", "detalhes": "..."}], "deliberacoes": ["..."], "encerramento": "..." }`
  },
  pendencias: {
    label: 'Pendências',
    prompt: `Analise a transcrição e identifique todas as pendências, itens em aberto e compromissos assumidos. 
Retorne JSON: { "pendencias": [{"descricao": "...", "responsavel": "...", "prazo": "...", "prioridade": "alta|media|baixa"}] }`
  },
  tarefas: {
    label: 'Tarefas e Ações',
    prompt: `Analise a transcrição e extraia TODAS as tarefas, ações a serem tomadas e próximos passos mencionados.
Retorne JSON: { "tarefas": [{"titulo": "...", "descricao": "...", "responsavel": "...", "prazo": "...", "prioridade": "alta|media|baixa"}], "retornos": [{"descricao": "...", "data_sugerida": "...", "participantes": ["..."]}] }`
  },
};

// POST /:id/analyze - on-demand AI analysis
router.post('/:id/analyze', authenticate, async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    if (!org) return res.status(403).json({ error: 'Sem organização' });

    const { prompt_type } = req.body;
    if (!prompt_type || !AI_PROMPTS[prompt_type]) {
      return res.status(400).json({ error: 'Tipo de análise inválido', available: Object.keys(AI_PROMPTS) });
    }

    const session = (await query(
      `SELECT * FROM telehealth_sessions WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [req.params.id, org.organization_id]
    )).rows[0];
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
    if (!session.transcript) return res.status(400).json({ error: 'Sessão ainda não possui transcrição' });

    const aiConfig = await getAIConfig(req.userId);
    if (!aiConfig) return res.status(400).json({ error: 'Configuração de IA não encontrada' });

    const promptConfig = AI_PROMPTS[prompt_type];
    const messages = [
      { role: 'system', content: `${promptConfig.prompt}\nRetorne APENAS o JSON, sem markdown ou texto adicional.` },
      { role: 'user', content: `Motivo da reunião: ${session.reason || 'Não informado'}\nAnotações: ${session.notes || 'Nenhuma'}\n\nTranscrição:\n${session.transcript}` }
    ];

    const aiResult = await callAI(aiConfig, messages, { temperature: 0.2, maxTokens: 4000 });
    // callAI returns { model, content, toolCalls, tokensUsed } — extract string content
    const rawText = typeof aiResult === 'string'
      ? aiResult
      : (aiResult?.content ?? aiResult?.text ?? '');
    let parsed;
    try {
      const cleaned = String(rawText).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { raw: String(rawText || '') };
    }

    // Save to structured_content (merge with existing)
    const existing = session.structured_content || {};
    existing[prompt_type] = parsed;
    await query(
      `UPDATE telehealth_sessions SET structured_content = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(existing), session.id]
    );

    await auditLog(session.id, org.organization_id, req.userId, org.name, `ai_analysis_${prompt_type}`, { prompt_type });

    res.json({ type: prompt_type, data: parsed });
  } catch (e) {
    logError('Telehealth analyze error', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
