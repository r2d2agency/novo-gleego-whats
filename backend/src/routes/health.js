import express from 'express';
import { pool } from '../db.js';
import { logInfo, logError } from '../logger.js';

const router = express.Router();

router.get('/db', async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await pool.query('SELECT NOW() as now, version() as version');
    
    // Diagnostic for external_forms
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'external_forms'
    `);

    res.json({
      status: 'ok',
      timestamp: result.rows[0].now,
      version: result.rows[0].version,
      duration_ms: Date.now() - startedAt,
      database_url_present: Boolean(process.env.DATABASE_URL),
      external_forms_exists: tableCheck.rows.length > 0
    });
  } catch (error) {
    logError('Health check DB failed', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      duration_ms: Date.now() - startedAt
    });
  }
});

// Repair endpoint to manually trigger table creation if needed
router.post('/repair-forms', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS external_forms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        logo_url TEXT,
        logo_size INTEGER DEFAULT 48,
        primary_color VARCHAR(20) DEFAULT '#6366f1',
        background_color VARCHAR(20) DEFAULT '#ffffff',
        text_color VARCHAR(20) DEFAULT '#1f2937',
        button_text VARCHAR(100) DEFAULT 'Enviar',
        welcome_message TEXT DEFAULT 'Olá! Vamos começar?',
        thank_you_message TEXT DEFAULT 'Obrigado pelo contato! Em breve entraremos em contato.',
        redirect_url TEXT,
        trigger_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
        connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
        display_mode VARCHAR(20) DEFAULT 'typeform',
        transition_type VARCHAR(20) DEFAULT 'slide-right',
        views_count INTEGER DEFAULT 0,
        submissions_count INTEGER DEFAULT 0,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(organization_id, slug)
      );

      CREATE TABLE IF NOT EXISTS external_form_fields (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form_id UUID NOT NULL REFERENCES external_forms(id) ON DELETE CASCADE,
        field_key VARCHAR(100) NOT NULL,
        field_label VARCHAR(255) NOT NULL,
        field_type VARCHAR(50) DEFAULT 'text',
        placeholder TEXT,
        is_required BOOLEAN DEFAULT false,
        validation_regex TEXT,
        options JSONB,
        position INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(form_id, field_key)
      );

      CREATE TABLE IF NOT EXISTS external_form_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form_id UUID NOT NULL REFERENCES external_forms(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}',
        name VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(50),
        ip_address INET,
        user_agent TEXT,
        referrer TEXT,
        utm_source VARCHAR(100),
        utm_medium VARCHAR(100),
        utm_campaign VARCHAR(100),
        prospect_id UUID REFERENCES crm_prospects(id),
        contact_id UUID REFERENCES chat_contacts(id),
        flow_session_id UUID,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_external_forms_org ON external_forms(organization_id);
      CREATE INDEX IF NOT EXISTS idx_external_forms_slug ON external_forms(slug);
    `);
    res.json({ success: true, message: 'Tabelas criadas com sucesso no banco de dados principal' });
  } catch (error) {
    logError('Repair forms failed', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
