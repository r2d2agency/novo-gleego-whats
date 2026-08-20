import express from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { logInfo, logError } from '../logger.js';

const router = express.Router();

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ---------- helpers ----------
async function getUserOrg(userId) {
  const r = await query(
    `SELECT om.organization_id, om.role
       FROM organization_members om
      WHERE om.user_id = $1 LIMIT 1`,
    [userId]
  );
  return r.rows[0];
}

function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function graphGet(path, accessToken) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${GRAPH_BASE}${path}${sep}access_token=${encodeURIComponent(accessToken)}`;
  const r = await fetchWithTimeout(url);
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = json?.error?.message || `Graph error ${r.status}`;
    throw new Error(err);
  }
  return json;
}

function normalizePhone(p) {
  return (p || '').toString().replace(/\D/g, '');
}

function applyFieldMapping(fieldData, mapping) {
  // fieldData: [{ name, values: [..] }]
  const flat = {};
  for (const f of fieldData || []) {
    flat[f.name] = Array.isArray(f.values) ? f.values.join(', ') : (f.values || '');
  }
  const mapped = { name: '', phone: '', email: '', city: '', state: '', custom: {} };
  const m = mapping && Object.keys(mapping).length ? mapping : {
    full_name: 'name', name: 'name',
    phone_number: 'phone', phone: 'phone',
    email: 'email',
    city: 'city', state: 'state',
  };
  for (const [src, dst] of Object.entries(m)) {
    const v = flat[src];
    if (v === undefined) continue;
    if (['name', 'phone', 'email', 'city', 'state'].includes(dst)) {
      mapped[dst] = v;
    } else {
      mapped.custom[dst] = v;
    }
  }
  // Sweep anything not mapped into custom for auditing
  for (const [k, v] of Object.entries(flat)) {
    if (!(k in m)) mapped.custom[k] = v;
  }
  return mapped;
}

// ---------- pages ----------
router.get('/pages', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });
    const r = await query(
      `SELECT mp.id, mp.external_id, mp.external_name, mp.kind, mp.status,
              mp.created_at, mp.updated_at,
              (SELECT COUNT(*) FROM meta_lead_forms f WHERE f.meta_page_id = mp.id) AS forms_count
         FROM meta_pages mp
        WHERE mp.organization_id = $1 AND mp.kind = 'facebook_page'
        ORDER BY mp.external_name NULLS LAST, mp.created_at DESC`,
      [org.organization_id]
    );
    res.json(r.rows);
  } catch (e) { logError('lead-ads list pages', e); res.status(500).json({ error: e.message }); }
});

// Manual page registration (for testing while OAuth flow is not live)
router.post('/pages', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });
    const { page_id, page_name, page_access_token } = req.body || {};
    if (!page_id || !page_access_token) {
      return res.status(400).json({ error: 'page_id e page_access_token são obrigatórios' });
    }
    const r = await query(
      `INSERT INTO meta_pages (organization_id, kind, external_id, external_name, page_access_token, status)
       VALUES ($1, 'facebook_page', $2, $3, $4, 'active')
       ON CONFLICT (organization_id, kind, external_id) DO UPDATE
         SET external_name = COALESCE(EXCLUDED.external_name, meta_pages.external_name),
             page_access_token = EXCLUDED.page_access_token,
             status = 'active',
             updated_at = NOW()
       RETURNING id, external_id, external_name, status`,
      [org.organization_id, page_id, page_name || null, page_access_token]
    );
    res.json(r.rows[0]);
  } catch (e) { logError('lead-ads create page', e); res.status(500).json({ error: e.message }); }
});

router.delete('/pages/:id', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });
    await query(`DELETE FROM meta_pages WHERE id = $1 AND organization_id = $2`,
      [req.params.id, org.organization_id]);
    res.json({ success: true });
  } catch (e) { logError('lead-ads delete page', e); res.status(500).json({ error: e.message }); }
});

// Sync forms from Meta for a page
router.post('/pages/:id/sync-forms', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });
    const pageRes = await query(
      `SELECT id, external_id, page_access_token FROM meta_pages
        WHERE id = $1 AND organization_id = $2 AND kind = 'facebook_page'`,
      [req.params.id, org.organization_id]
    );
    const page = pageRes.rows[0];
    if (!page) return res.status(404).json({ error: 'Página não encontrada' });
    if (!page.page_access_token) return res.status(400).json({ error: 'Página sem token de acesso' });

    const data = await graphGet(`/${page.external_id}/leadgen_forms?fields=id,name,status,locale,questions&limit=100`, page.page_access_token);
    const forms = data.data || [];
    const upserted = [];
    for (const f of forms) {
      const u = await query(
        `INSERT INTO meta_lead_forms (organization_id, meta_page_id, form_id, form_name, metadata, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (meta_page_id, form_id) DO UPDATE
           SET form_name = EXCLUDED.form_name,
               metadata = EXCLUDED.metadata,
               updated_at = NOW()
         RETURNING *`,
        [org.organization_id, page.id, f.id, f.name || null, JSON.stringify(f)]
      );
      upserted.push(u.rows[0]);
    }
    res.json({ synced: upserted.length, forms: upserted });
  } catch (e) { logError('lead-ads sync-forms', e); res.status(500).json({ error: e.message }); }
});

// ---------- forms ----------
router.get('/forms', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });
    const r = await query(
      `SELECT f.*, mp.external_name AS page_name, mp.external_id AS page_external_id,
              (SELECT COUNT(*) FROM meta_lead_events e WHERE e.meta_lead_form_id = f.id) AS leads_count
         FROM meta_lead_forms f
         JOIN meta_pages mp ON mp.id = f.meta_page_id
        WHERE f.organization_id = $1
        ORDER BY f.updated_at DESC`,
      [org.organization_id]
    );
    res.json(r.rows);
  } catch (e) { logError('lead-ads list forms', e); res.status(500).json({ error: e.message }); }
});

router.get('/forms/:id', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });
    const r = await query(
      `SELECT f.*, mp.external_name AS page_name, mp.external_id AS page_external_id
         FROM meta_lead_forms f
         JOIN meta_pages mp ON mp.id = f.meta_page_id
        WHERE f.id = $1 AND f.organization_id = $2`,
      [req.params.id, org.organization_id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Formulário não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { logError('lead-ads get form', e); res.status(500).json({ error: e.message }); }
});

router.put('/forms/:id', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });
    const {
      is_active, funnel_id, stage_id, assignee_user_id, distribution_rule_id,
      trigger_flow_id, connection_id, field_mapping, default_tags, open_chat
    } = req.body || {};
    const r = await query(
      `UPDATE meta_lead_forms SET
         is_active = COALESCE($3, is_active),
         funnel_id = $4,
         stage_id = $5,
         assignee_user_id = $6,
         distribution_rule_id = $7,
         trigger_flow_id = $8,
         connection_id = $9,
         field_mapping = COALESCE($10::jsonb, field_mapping),
         default_tags = COALESCE($11, default_tags),
         open_chat = COALESCE($12, open_chat),
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [
        req.params.id, org.organization_id,
        is_active ?? null,
        funnel_id || null,
        stage_id || null,
        assignee_user_id || null,
        distribution_rule_id || null,
        trigger_flow_id || null,
        connection_id || null,
        field_mapping ? JSON.stringify(field_mapping) : null,
        default_tags || null,
        open_chat ?? null,
      ]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Formulário não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { logError('lead-ads update form', e); res.status(500).json({ error: e.message }); }
});

// ---------- events / leads ----------
router.get('/events', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const r = await query(
      `SELECT e.*, f.form_name, mp.external_name AS page_name,
              p.name AS prospect_name
         FROM meta_lead_events e
         LEFT JOIN meta_lead_forms f ON f.id = e.meta_lead_form_id
         LEFT JOIN meta_pages mp ON mp.id = f.meta_page_id
         LEFT JOIN crm_prospects p ON p.id = e.prospect_id
        WHERE e.organization_id = $1
        ORDER BY e.received_at DESC
        LIMIT $2`,
      [org.organization_id, limit]
    );
    res.json(r.rows);
  } catch (e) { logError('lead-ads list events', e); res.status(500).json({ error: e.message }); }
});

router.post('/events/:id/reprocess', authenticate, async (req, res) => {
  try {
    const org = await getUserOrg(req.userId);
    if (!org) return res.status(403).json({ error: 'No organization' });
    const r = await query(
      `SELECT * FROM meta_lead_events WHERE id = $1 AND organization_id = $2`,
      [req.params.id, org.organization_id]
    );
    const ev = r.rows[0];
    if (!ev) return res.status(404).json({ error: 'Evento não encontrado' });
    const result = await processLeadEvent(ev.id);
    res.json(result);
  } catch (e) { logError('lead-ads reprocess', e); res.status(500).json({ error: e.message }); }
});

// ---------- core processor ----------
async function processLeadEvent(eventId) {
  const evRes = await query(`SELECT * FROM meta_lead_events WHERE id = $1`, [eventId]);
  const ev = evRes.rows[0];
  if (!ev) return { status: 'not_found' };

  try {
    const formRes = await query(
      `SELECT f.*, mp.page_access_token, mp.external_id AS page_external_id, mp.id AS page_pk
         FROM meta_lead_forms f
         JOIN meta_pages mp ON mp.id = f.meta_page_id
        WHERE f.id = $1`,
      [ev.meta_lead_form_id]
    );
    const form = formRes.rows[0];
    if (!form) throw new Error('Formulário não configurado');
    if (!form.is_active) throw new Error('Formulário inativo');
    if (!form.page_access_token) throw new Error('Página sem token');

    // Fetch leadgen data
    const lead = await graphGet(
      `/${ev.leadgen_id}?fields=id,created_time,ad_id,adset_id,campaign_id,form_id,field_data`,
      form.page_access_token
    );

    const mapped = applyFieldMapping(lead.field_data || [], form.field_mapping || {});
    const phone = normalizePhone(mapped.phone);
    const name = mapped.name || 'Lead Facebook';
    const email = mapped.email || null;
    const city = mapped.city || null;
    const state = mapped.state || null;

    const customFields = {
      ...mapped.custom,
      source: 'facebook_lead_ads',
      facebook_lead_id: lead.id,
      facebook_form_id: lead.form_id,
      facebook_ad_id: lead.ad_id,
      facebook_adset_id: lead.adset_id,
      facebook_campaign_id: lead.campaign_id,
      received_at: ev.received_at,
    };

    let prospectId = null;
    if (phone) {
      const p = await query(
        `INSERT INTO crm_prospects (organization_id, name, phone, email, city, state, source, custom_fields, assigned_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (organization_id, phone) DO UPDATE SET
           name = COALESCE(NULLIF(EXCLUDED.name, ''), crm_prospects.name),
           email = COALESCE(NULLIF(EXCLUDED.email, ''), crm_prospects.email),
           city = COALESCE(NULLIF(EXCLUDED.city, ''), crm_prospects.city),
           state = COALESCE(NULLIF(EXCLUDED.state, ''), crm_prospects.state),
           custom_fields = crm_prospects.custom_fields || EXCLUDED.custom_fields,
           assigned_to = COALESCE(crm_prospects.assigned_to, EXCLUDED.assigned_to)
         RETURNING id`,
        [form.organization_id, name, phone, email, city, state,
         `Facebook Lead Ads — ${form.form_name || ''}`.trim(),
         JSON.stringify(customFields),
         form.assignee_user_id || null]
      );
      prospectId = p.rows[0]?.id || null;
    }

    // Optionally open chat on chosen connection
    if (prospectId && phone && form.open_chat && form.connection_id) {
      try {
        await query(
          `INSERT INTO chat_contacts (connection_id, phone, name, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (connection_id, phone) DO UPDATE
             SET name = COALESCE(NULLIF(EXCLUDED.name, ''), chat_contacts.name),
                 updated_at = NOW()`,
          [form.connection_id, phone, name]
        );
      } catch (chatErr) { logError('lead-ads chat contact', chatErr); }
    }

    await query(
      `UPDATE meta_lead_events
         SET status = 'processed', prospect_id = $2, processed_at = NOW(), error = NULL,
             raw_payload = COALESCE(raw_payload, '{}'::jsonb) || $3::jsonb
       WHERE id = $1`,
      [eventId, prospectId, JSON.stringify({ lead })]
    );
    return { status: 'processed', prospect_id: prospectId };
  } catch (err) {
    logError('processLeadEvent', err);
    await query(
      `UPDATE meta_lead_events SET status = 'failed', error = $2, processed_at = NOW() WHERE id = $1`,
      [eventId, String(err.message || err).slice(0, 1000)]
    );
    return { status: 'failed', error: err.message };
  }
}

// ---------- Meta webhook (public) ----------
// Mounted at /api/meta/webhook in index.js
export const webhookRouter = express.Router();

webhookRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  // Prioritize global token (Centralized App)
  const globalToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  
  if (mode === 'subscribe' && token) {
    if (globalToken && token === globalToken) {
      return res.status(200).send(challenge);
    }
    
    // Support separate token for leads if needed
    if (process.env.META_LEAD_ADS_VERIFY_TOKEN && token === process.env.META_LEAD_ADS_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
  }
  
  return res.sendStatus(403);
});

webhookRouter.post('/', async (req, res) => {
  try {
    // Signature validation (skip silently if secret not configured yet)
    const secret = process.env.META_APP_SECRET;
    const sig = req.headers['x-hub-signature-256'];
    if (secret && sig && req.rawBody) {
      const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
      if (sig !== expected) {
        logError('meta webhook signature mismatch', { got: sig });
        return res.sendStatus(401);
      }
    }
    // Always 200 fast; process async
    res.sendStatus(200);

    const body = req.body || {};
    if (body.object !== 'page') return;
    for (const entry of body.entry || []) {
      const pageId = entry.id;
      for (const change of entry.changes || []) {
        if (change.field !== 'leadgen') continue;
        const v = change.value || {};
        const leadgenId = v.leadgen_id;
        const formId = v.form_id;
        if (!leadgenId || !pageId) continue;

        // Find page + form
        const pageRes = await query(
          `SELECT id, organization_id FROM meta_pages WHERE external_id = $1 AND kind = 'facebook_page' LIMIT 1`,
          [pageId.toString()]
        );
        const page = pageRes.rows[0];
        if (!page) { logInfo('meta webhook leadgen for unknown page', { pageId }); continue; }

        const formRes = await query(
          `SELECT id FROM meta_lead_forms WHERE meta_page_id = $1 AND form_id = $2 LIMIT 1`,
          [page.id, formId?.toString() || '']
        );
        let metaFormPk = formRes.rows[0]?.id || null;
        if (!metaFormPk) {
          // Auto-register unknown form so user can configure it later
          const ins = await query(
            `INSERT INTO meta_lead_forms (organization_id, meta_page_id, form_id, form_name, is_active)
             VALUES ($1, $2, $3, $4, false)
             ON CONFLICT (meta_page_id, form_id) DO UPDATE SET updated_at = NOW()
             RETURNING id`,
            [page.organization_id, page.id, formId.toString(), null]
          );
          metaFormPk = ins.rows[0].id;
        }

        const evIns = await query(
          `INSERT INTO meta_lead_events
             (organization_id, meta_lead_form_id, leadgen_id, ad_id, adset_id, campaign_id, raw_payload, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'received')
           ON CONFLICT (leadgen_id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload
           RETURNING id`,
          [page.organization_id, metaFormPk, leadgenId.toString(),
           v.ad_id || null, v.adset_id || null, v.campaign_id || null,
           JSON.stringify(v)]
        );
        try { await processLeadEvent(evIns.rows[0].id); } catch (e) { logError('process lead', e); }
      }
    }
  } catch (e) {
    logError('meta webhook handler', e);
  }
});

export default router;