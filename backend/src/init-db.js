import { pool } from './db.js';

// ============================================
// STEP 1: ENUMS (must be first)
// ============================================
const step1Enums = `
DO $$
BEGIN
  -- Create enum if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE app_role AS ENUM ('owner', 'admin', 'manager', 'agent', 'supervisor', 'user');
  ELSE
    -- Ensure all expected values exist (supports older schemas)
    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'owner';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'admin';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'manager';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'agent';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'supervisor';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'user';
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
`;

// ============================================
// STEP 2: CORE TABLES (no foreign key dependencies)
// ============================================
const step2CoreTables = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_superadmin BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add is_superadmin column if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT false;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Plans table (SaaS)
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    max_connections INTEGER NOT NULL DEFAULT 1,
    max_monthly_messages INTEGER NOT NULL DEFAULT 1000,
    max_users INTEGER NOT NULL DEFAULT 5,
    max_supervisors INTEGER NOT NULL DEFAULT 1,
    has_asaas_integration BOOLEAN DEFAULT false,
    has_chat BOOLEAN DEFAULT true,
    has_whatsapp_groups BOOLEAN DEFAULT false,
    has_campaigns BOOLEAN DEFAULT true,
    has_chatbots BOOLEAN DEFAULT true,
    has_scheduled_messages BOOLEAN DEFAULT true,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    billing_period VARCHAR(20) DEFAULT 'monthly',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add new plan columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 5;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_supervisors INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_whatsapp_groups BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_campaigns BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_chatbots BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_scheduled_messages BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS visible_on_signup BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT 3;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_departments BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_lead_scoring BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_ai_summary BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_group_secretary BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_ghost BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_projects BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_lead_gleego BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_supervisor BOOLEAN DEFAULT false;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS integration_settings jsonb DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(50);
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;
`;

// ============================================
// STEP 3: ORGANIZATIONS (depends on plans)
// ============================================
const step3Organizations = `
-- Organizations (multi-tenant)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    asaas_customer_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add plan columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS asaas_customer_id VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS modules_enabled JSONB DEFAULT '{"campaigns": true, "billing": true, "groups": true, "scheduled_messages": true, "chatbots": true, "chat": true}'::jsonb;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Organização: configuração global de IA (OpenAI/Gemini)
DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_provider VARCHAR(20) DEFAULT 'none';
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_model VARCHAR(100);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_api_key TEXT;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS theme_preset VARCHAR(50);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS theme_custom_colors TEXT;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Organização: horário de trabalho para agendamento inteligente
DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS work_schedule JSONB DEFAULT '{
      "timezone": "America/Sao_Paulo",
      "work_days": [1,2,3,4,5],
      "work_start": "08:00",
      "work_end": "18:00",
      "lunch_start": "12:00",
      "lunch_end": "13:00",
      "slot_duration_minutes": 60,
      "buffer_minutes": 15
    }'::jsonb;
EXCEPTION WHEN duplicate_column THEN null; END $$;
`;

// ============================================
// STEP 4: USER RELATIONS (depends on users, organizations)
// ============================================
const step4UserRelations = `
-- Organization Members
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'agent',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, user_id)
);

-- User roles (legacy/global roles)
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    UNIQUE (user_id, role)
);
`;

// ============================================
// STEP 5: CONNECTIONS (depends on users, organizations)
// ============================================
const step5Connections = `
-- WhatsApp Connections (Evolution API + W-API)
CREATE TABLE IF NOT EXISTS connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,

    -- Evolution provider fields (nullable because W-API doesn't use them)
    api_url VARCHAR(500),
    api_key VARCHAR(500),
    instance_name VARCHAR(255),

    -- Multi-provider fields
    provider VARCHAR(20) NOT NULL DEFAULT 'evolution',
    instance_id VARCHAR(255),
    wapi_token TEXT,

    status VARCHAR(50) DEFAULT 'disconnected',
    phone_number VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add organization_id column if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add webhook_url column if not exists
DO $$ BEGIN
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS webhook_url TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- W-API / multi-provider columns (for existing databases)
DO $$ BEGIN
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'evolution';
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS instance_id VARCHAR(255);
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS wapi_token TEXT;
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS show_groups BOOLEAN DEFAULT false;
    -- Meta Cloud API columns
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS meta_token TEXT;
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS meta_phone_number_id VARCHAR(255);
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS meta_waba_id VARCHAR(255);
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS meta_webhook_verify_token VARCHAR(255);
    -- UAZAPI columns
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS uazapi_url TEXT;
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS uazapi_token TEXT;
    -- Business hours automation
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS out_of_office_message_enabled BOOLEAN DEFAULT false;
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS out_of_office_message TEXT;
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS business_hours_start TIME DEFAULT '08:00';
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS business_hours_end TIME DEFAULT '18:00';
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS business_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5];
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT '[]'::jsonb;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Ensure nullable Evolution-only columns (required by Evolution, but unused by W-API)
DO $$ BEGIN
    ALTER TABLE connections ALTER COLUMN api_url DROP NOT NULL;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE connections ALTER COLUMN api_key DROP NOT NULL;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE connections ALTER COLUMN instance_name DROP NOT NULL;
EXCEPTION WHEN others THEN null; END $$;

-- Enforce required fields per provider (drop old constraints and recreate to include meta)
DO $$
BEGIN
    -- Normalize provider
    UPDATE connections SET provider = 'evolution' WHERE provider IS NULL;

    -- Drop old constraints to recreate with meta support
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connections_provider_chk') THEN
        ALTER TABLE connections DROP CONSTRAINT connections_provider_chk;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connections_provider_required_fields_chk') THEN
        ALTER TABLE connections DROP CONSTRAINT connections_provider_required_fields_chk;
    END IF;

    -- Provider value constraint (now includes meta)
    ALTER TABLE connections
    ADD CONSTRAINT connections_provider_chk
    CHECK (provider IN ('evolution', 'wapi', 'meta', 'uazapi'));

    -- Required fields per provider constraint (now includes meta + uazapi)
    ALTER TABLE connections
    ADD CONSTRAINT connections_provider_required_fields_chk
    CHECK (
        (provider = 'wapi' AND instance_id IS NOT NULL AND wapi_token IS NOT NULL)
        OR
        (provider = 'evolution' AND api_url IS NOT NULL AND api_key IS NOT NULL AND instance_name IS NOT NULL)
        OR
        (provider = 'meta' AND meta_token IS NOT NULL AND meta_phone_number_id IS NOT NULL AND meta_waba_id IS NOT NULL)
        OR
        (provider = 'uazapi' AND uazapi_url IS NOT NULL AND uazapi_token IS NOT NULL)
    );
END $$;


-- Connection Members
CREATE TABLE IF NOT EXISTS connection_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    can_view BOOLEAN DEFAULT true,
    can_send BOOLEAN DEFAULT true,
    can_manage BOOLEAN DEFAULT false,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (connection_id, user_id)
);
ALTER TABLE connection_members ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_members_user_default
  ON connection_members(user_id) WHERE is_default = true;

-- Access Groups
CREATE TABLE IF NOT EXISTS access_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Access Group Members
CREATE TABLE IF NOT EXISTS access_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    access_group_id UUID REFERENCES access_groups(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (access_group_id, user_id)
);

-- Access Group Connections (Which connections this group can see)
CREATE TABLE IF NOT EXISTS access_group_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    access_group_id UUID REFERENCES access_groups(id) ON DELETE CASCADE NOT NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (access_group_id, connection_id)
);

-- Supervisor IA Settings
CREATE TABLE IF NOT EXISTS supervisor_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    new_lead_sla_minutes INTEGER DEFAULT 30,
    no_followup_sla_hours INTEGER DEFAULT 24,
    no_response_sla_days INTEGER DEFAULT 2,
    reactivation_days INTEGER DEFAULT 30,
    proposal_sla_hours INTEGER DEFAULT 4,
    payment_sla_days INTEGER DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id)
);

-- Supervisor IA Audits
CREATE TABLE IF NOT EXISTS supervisor_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    analysis_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status_found VARCHAR(50),
    reason TEXT,
    suggested_action TEXT,
    urgency VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Supervisor IA Charges
CREATE TABLE IF NOT EXISTS supervisor_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    target_team_id UUID REFERENCES crm_user_groups(id) ON DELETE CASCADE,
    charged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL, -- 'individual' or 'team'
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Supervisor IA Monitored Sellers (who the supervisor watches + which connections/funnels to scope)
CREATE TABLE IF NOT EXISTS supervisor_monitored_sellers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    connection_ids UUID[] DEFAULT '{}',
    funnel_ids UUID[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- Add monitoring columns to crm_deals
DO $$ BEGIN
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS last_seller_message_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS first_seller_message_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS proposal_sent_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS payment_pending_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS next_followup_at TIMESTAMP WITH TIME ZONE;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Add monitored_funnels column to supervisor_settings ( legacy fix)
DO $$ BEGIN
    ALTER TABLE supervisor_settings ADD COLUMN IF NOT EXISTS monitored_funnels UUID[] DEFAULT '{}';
    ALTER TABLE supervisor_settings ADD COLUMN IF NOT EXISTS monitored_tags TEXT[] DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN null; END $$;

`;

// ============================================
const step6ContactsMessages = `
/* -- Contact Lists */
CREATE TABLE IF NOT EXISTS contact_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add connection_id column if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES connections(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add organization_id column to contact_lists for sharing
DO $$ BEGIN
    ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID REFERENCES contact_lists(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    jid VARCHAR(100),
    profile_picture_url TEXT,
    push_name VARCHAR(255),
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add missing columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_whatsapp BOOLEAN;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS jid VARCHAR(100);
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS push_name VARCHAR(255);
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source VARCHAR(255);
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Message Templates
CREATE TABLE IF NOT EXISTS message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    items JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;

// ============================================
// STEP 7: CAMPAIGNS (depends on contacts, messages, connections)
// ============================================
const step7Campaigns = `
-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    list_id UUID REFERENCES contact_lists(id) ON DELETE SET NULL,
    message_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'pending',
    scheduled_at TIMESTAMP WITH TIME ZONE,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    start_time VARCHAR(10),
    end_time VARCHAR(10),
    min_delay INTEGER DEFAULT 120,
    max_delay INTEGER DEFAULT 300,
    pause_after_messages INTEGER DEFAULT 20,
    pause_duration INTEGER DEFAULT 10,
    random_order BOOLEAN DEFAULT false,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add new campaign columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_date TIMESTAMP WITH TIME ZONE;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS end_date TIMESTAMP WITH TIME ZONE;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_time VARCHAR(10);
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS end_time VARCHAR(10);
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS pause_after_messages INTEGER DEFAULT 20;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS pause_duration INTEGER DEFAULT 10;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS random_order BOOLEAN DEFAULT false;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS flow_id UUID;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_template_id UUID;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_template_name TEXT;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_template_language VARCHAR(20);
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_template_components JSONB;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS meta_template_params JSONB DEFAULT '{}'::jsonb;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add foreign key for flow_id if flows table exists
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'flows') THEN
        BEGIN
            ALTER TABLE campaigns 
            ADD CONSTRAINT campaigns_flow_id_fkey 
            FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE SET NULL;
        EXCEPTION 
            WHEN duplicate_object THEN null;
        END;
    END IF;
END $$;

-- Create index for flow-based campaigns
CREATE INDEX IF NOT EXISTS idx_campaigns_flow_id ON campaigns(flow_id);

-- Campaign Messages Log
CREATE TABLE IF NOT EXISTS campaign_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    message_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
    phone VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    scheduled_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add new campaign_messages columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE campaign_messages ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;
    ALTER TABLE campaign_messages ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;
`;

// ============================================
// STEP 8: ASAAS INTEGRATION (depends on organizations, connections)
// ============================================
const step8Asaas = `
-- Asaas Integrations
CREATE TABLE IF NOT EXISTS asaas_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL UNIQUE,
    api_key VARCHAR(500) NOT NULL,
    environment VARCHAR(20) DEFAULT 'sandbox',
    webhook_token VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Billing Notification Rules
CREATE TABLE IF NOT EXISTS billing_notification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    days_offset INTEGER NOT NULL DEFAULT 0,
    max_days_overdue INTEGER,
    message_template TEXT NOT NULL,
    send_time TIME DEFAULT '09:00',
    min_delay INTEGER DEFAULT 120,
    max_delay INTEGER DEFAULT 300,
    pause_after_messages INTEGER DEFAULT 20,
    pause_duration INTEGER DEFAULT 600,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add delay columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE billing_notification_rules ADD COLUMN IF NOT EXISTS min_delay INTEGER DEFAULT 120;
    ALTER TABLE billing_notification_rules ADD COLUMN IF NOT EXISTS max_delay INTEGER DEFAULT 300;
    ALTER TABLE billing_notification_rules ADD COLUMN IF NOT EXISTS pause_after_messages INTEGER DEFAULT 20;
    ALTER TABLE billing_notification_rules ADD COLUMN IF NOT EXISTS pause_duration INTEGER DEFAULT 600;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Asaas Customers (cached)
CREATE TABLE IF NOT EXISTS asaas_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asaas_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    cpf_cnpj VARCHAR(20),
    external_reference VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, asaas_id)
);

-- Asaas Payments (cached)
CREATE TABLE IF NOT EXISTS asaas_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asaas_id VARCHAR(100) NOT NULL,
    customer_id UUID REFERENCES asaas_customers(id) ON DELETE CASCADE,
    asaas_customer_id VARCHAR(100) NOT NULL,
    value DECIMAL(10, 2) NOT NULL,
    net_value DECIMAL(10, 2),
    due_date DATE NOT NULL,
    billing_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    payment_link TEXT,
    invoice_url TEXT,
    bank_slip_url TEXT,
    pix_qr_code TEXT,
    pix_copy_paste TEXT,
    description TEXT,
    external_reference VARCHAR(255),
    confirmed_date DATE,
    payment_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, asaas_id)
);

-- Billing Notifications Log
CREATE TABLE IF NOT EXISTS billing_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    payment_id UUID REFERENCES asaas_payments(id) ON DELETE CASCADE NOT NULL,
    rule_id UUID REFERENCES billing_notification_rules(id) ON DELETE SET NULL,
    phone VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Asaas Webhook Events Log
CREATE TABLE IF NOT EXISTS asaas_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    payment_id VARCHAR(100),
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- ASAAS v3 (advanced billing controls)
-- These columns/tables are required by backend/src/routes/asaas.js
-- ============================================

-- Customer blacklist + pause controls
DO $$ BEGIN
    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS is_blacklisted BOOLEAN DEFAULT false;
    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS blacklist_reason TEXT;
    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS blacklisted_at TIMESTAMP WITH TIME ZONE;

    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS billing_paused BOOLEAN DEFAULT false;
    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS billing_paused_until TIMESTAMP WITH TIME ZONE;
    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS billing_paused_reason TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
    WHEN others THEN null;
END $$;

-- Integration settings (limits/alerts/global pause)
DO $$ BEGIN
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS daily_message_limit_per_customer INTEGER;

    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS billing_paused BOOLEAN DEFAULT false;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS billing_paused_until TIMESTAMP WITH TIME ZONE;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS billing_paused_reason TEXT;

    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS critical_alert_threshold DECIMAL(10, 2);
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS critical_alert_days INTEGER;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS alert_email TEXT;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS alert_whatsapp BOOLEAN DEFAULT false;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS alert_connection_id UUID REFERENCES connections(id) ON DELETE SET NULL;

    -- Auto-sync settings (for 2AM/8AM CRON jobs)
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS auto_sync_enabled BOOLEAN DEFAULT true;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS sync_time_morning VARCHAR(5) DEFAULT '02:00';
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS check_time_morning VARCHAR(5) DEFAULT '08:00';
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS last_check_at TIMESTAMP WITH TIME ZONE;
    
    -- Webhook configuration
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS webhook_url TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
    WHEN others THEN null;
END $$;

-- Daily message count per customer (anti-spam)
CREATE TABLE IF NOT EXISTS billing_daily_message_count (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    customer_id UUID REFERENCES asaas_customers(id) ON DELETE CASCADE NOT NULL,
    day DATE NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (customer_id, day)
);

-- Critical delinquency alerts
CREATE TABLE IF NOT EXISTS billing_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    customer_id UUID REFERENCES asaas_customers(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    total_overdue DECIMAL(12, 2),
    days_overdue INTEGER,
    is_read BOOLEAN DEFAULT false,
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;

// ============================================
// STEP 9: CHAT SYSTEM (depends on connections, users, organizations)
// ============================================
const step9Chat = `
-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    remote_jid VARCHAR(100) NOT NULL,
    contact_name VARCHAR(255),
    contact_phone VARCHAR(50),
    last_message_at TIMESTAMP WITH TIME ZONE,
    unread_count INTEGER DEFAULT 0,
    is_archived BOOLEAN DEFAULT false,
    is_pinned BOOLEAN DEFAULT false,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (connection_id, remote_jid)
);

-- Add is_pinned column if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_name VARCHAR(255);
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT false;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Allow NULL connection_id on conversations (preserve conversations when connection is deleted)
DO $$ BEGIN
    -- Drop old CASCADE constraint and re-add as SET NULL
    ALTER TABLE conversations ALTER COLUMN connection_id DROP NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
    -- Drop the old unique constraint and create a partial one that allows nulls
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_connection_id_remote_jid_key;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS conversations_connection_id_remote_jid_key 
    ON conversations (connection_id, remote_jid) WHERE connection_id IS NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;

-- Change FK from CASCADE to SET NULL for conversations.connection_id
DO $$ BEGIN
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_connection_id_fkey;
    ALTER TABLE conversations ADD CONSTRAINT conversations_connection_id_fkey 
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN null;
END $$;

-- Allow NULL connection_id on chat_contacts
DO $$ BEGIN
    ALTER TABLE chat_contacts ALTER COLUMN connection_id DROP NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE chat_contacts DROP CONSTRAINT IF EXISTS chat_contacts_connection_id_fkey;
    ALTER TABLE chat_contacts ADD CONSTRAINT chat_contacts_connection_id_fkey 
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN null;
END $$;

-- Change contact_lists FK from CASCADE to SET NULL
DO $$ BEGIN
    ALTER TABLE contact_lists DROP CONSTRAINT IF EXISTS contact_lists_connection_id_fkey;
    ALTER TABLE contact_lists ADD CONSTRAINT contact_lists_connection_id_fkey 
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN null;
END $$;

-- Conversation Tags
CREATE TABLE IF NOT EXISTS conversation_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#6366f1',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, name)
);

-- Conversation Tag Links
CREATE TABLE IF NOT EXISTS conversation_tag_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
    tag_id UUID REFERENCES conversation_tags(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (conversation_id, tag_id)
);

-- Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
    message_id VARCHAR(100),
    from_me BOOLEAN DEFAULT false,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT,
    message_type VARCHAR(50) DEFAULT 'text',
    media_url TEXT,
    media_mimetype VARCHAR(100),
    wa_media_key TEXT,
    quoted_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'sent',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure W-API media key column exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS wa_media_key TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add sender_name column for group messages (WhatsApp pushName)
DO $$ BEGIN
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255);
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender_phone VARCHAR(50);
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS error_message TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS transcript TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS link_preview JSONB;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add unique index on message_id to prevent duplicates (excludes temp_ messages)
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_message_id 
  ON chat_messages (message_id) 
  WHERE message_id IS NOT NULL AND message_id NOT LIKE 'temp_%';

-- Backward compatibility: if older DB has quoted_message_id as VARCHAR, convert to UUID
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'quoted_message_id'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE chat_messages
      ALTER COLUMN quoted_message_id TYPE UUID
      USING NULLIF(quoted_message_id, '')::uuid;
  END IF;
EXCEPTION WHEN others THEN
  -- Ignore conversion errors to avoid blocking startup
  NULL;
END $$;

-- Internal Notes (Chat)
CREATE TABLE IF NOT EXISTS conversation_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Scheduled Messages (Chat)
CREATE TABLE IF NOT EXISTS scheduled_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT,
    message_type VARCHAR(20) DEFAULT 'text',
    media_url TEXT,
    media_mimetype VARCHAR(100),
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    timezone VARCHAR(50) DEFAULT 'America/Sao_Paulo',
    status VARCHAR(20) DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS send_text_separate BOOLEAN DEFAULT false;

-- Quick Replies (Chat productivity)
CREATE TABLE IF NOT EXISTS quick_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    shortcut VARCHAR(50),
    category VARCHAR(100),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Backward-compatible column adds (older databases may miss columns)
DO $$ BEGIN
    ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS shortcut VARCHAR(50);
    ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS category VARCHAR(100);
    ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS created_by UUID;
    ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
EXCEPTION
    WHEN duplicate_column THEN null;
    WHEN others THEN null;
END $$;

-- Alerts (for scheduled message sent notifications)
CREATE TABLE IF NOT EXISTS user_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'scheduled_message_sent',
    title VARCHAR(255) NOT NULL,
    message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat Contacts (agenda de contatos para chat - não campanhas)
CREATE TABLE IF NOT EXISTS chat_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    jid VARCHAR(100),
    profile_picture_url TEXT,
    push_name VARCHAR(255),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (connection_id, phone)
);

-- Backward-compatible column adds for chat_contacts
DO $$ BEGIN
    ALTER TABLE chat_contacts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
    ALTER TABLE chat_contacts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
EXCEPTION
    WHEN duplicate_column THEN null;
    WHEN others THEN null;
END $$;
`;

// ============================================
// STEP 10: SYSTEM SETTINGS
// ============================================
const step10Settings = `
-- System Settings (for branding, logos, etc)
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default settings if not exists
INSERT INTO system_settings (key, value, description) VALUES
    ('logo_login', NULL, 'Logo da tela de login'),
    ('logo_sidebar', NULL, 'Logo/ícone da sidebar'),
    ('favicon', NULL, 'Favicon do sistema')
ON CONFLICT (key) DO NOTHING;
`;

// ============================================
// STEP 11: INDEXES (last step, non-critical)
// ============================================
const step11Indexes = `
CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_org ON connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_lists_user_id ON contact_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_lists_conn ON contact_lists(connection_id);
CREATE INDEX IF NOT EXISTS idx_contacts_list_id ON contacts(list_id);
CREATE INDEX IF NOT EXISTS idx_contacts_jid ON contacts(jid);
CREATE INDEX IF NOT EXISTS idx_message_templates_user_id ON message_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign_id ON campaign_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_status ON campaign_messages(status);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_connection_members_conn ON connection_members(connection_id);
CREATE INDEX IF NOT EXISTS idx_connection_members_user ON connection_members(user_id);
CREATE INDEX IF NOT EXISTS idx_asaas_integrations_org ON asaas_integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_asaas_customers_org ON asaas_customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_asaas_payments_org ON asaas_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_asaas_payments_status ON asaas_payments(status);
CREATE INDEX IF NOT EXISTS idx_asaas_payments_due_date ON asaas_payments(due_date);
CREATE INDEX IF NOT EXISTS idx_billing_notifications_payment ON billing_notifications(payment_id);

CREATE INDEX IF NOT EXISTS idx_billing_alerts_org ON billing_alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_billing_alerts_unresolved ON billing_alerts(organization_id, is_resolved) WHERE is_resolved = false;
CREATE INDEX IF NOT EXISTS idx_billing_daily_msg_customer_day ON billing_daily_message_count(customer_id, day);

CREATE INDEX IF NOT EXISTS idx_conversations_conn ON conversations(connection_id);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(assigned_to);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);

CREATE INDEX IF NOT EXISTS idx_conversation_notes_conv ON conversation_notes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_status_time ON scheduled_messages(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_quick_replies_org ON quick_replies(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quick_replies_shortcut_org ON quick_replies(organization_id, shortcut) WHERE shortcut IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_alerts_user_unread ON user_alerts(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_chat_contacts_conn ON chat_contacts(connection_id);
CREATE INDEX IF NOT EXISTS idx_chat_contacts_phone ON chat_contacts(phone);

-- Chat list performance (group/chat tab switching)
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_ts ON chat_messages(conversation_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_org_last ON conversations(organization_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_tag_links_conv ON conversation_tag_links(conversation_id);
`;

// Step 12: Attendance Status
const step12Attendance = `
-- Attendance status columns for conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(20) DEFAULT 'waiting';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_attendance_status ON conversations(attendance_status);
CREATE INDEX IF NOT EXISTS idx_conversations_accepted_by ON conversations(accepted_by);

-- Fix existing conversations with NULL attendance_status
UPDATE conversations SET attendance_status = 'waiting' WHERE attendance_status IS NULL;
`;

// Step 13: Chatbots System
const step13Chatbots = `
-- Enum para provedor de IA
DO $$ BEGIN
  CREATE TYPE ai_provider AS ENUM ('gemini', 'openai', 'none');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Enum para modo de operação do chatbot
DO $$ BEGIN
  CREATE TYPE chatbot_mode AS ENUM ('always', 'business_hours', 'outside_hours', 'pre_service');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Enum para tipo de nó do fluxo
DO $$ BEGIN
  CREATE TYPE flow_node_type AS ENUM ('start', 'message', 'menu', 'input', 'condition', 'action', 'transfer', 'ai_response', 'end');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tabela principal de chatbots
CREATE TABLE IF NOT EXISTS chatbots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT false,
  
  mode chatbot_mode DEFAULT 'always',
  business_hours_start TIME DEFAULT '08:00',
  business_hours_end TIME DEFAULT '18:00',
  business_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],
  timezone VARCHAR(50) DEFAULT 'America/Sao_Paulo',
  
  ai_provider ai_provider DEFAULT 'none',
  ai_model VARCHAR(100),
  ai_api_key TEXT,
  ai_system_prompt TEXT,
  ai_temperature DECIMAL(2,1) DEFAULT 0.7,
  ai_max_tokens INTEGER DEFAULT 500,
  
  welcome_message TEXT,
  fallback_message TEXT DEFAULT 'Desculpe, não entendi. Vou transferir você para um atendente.',
  transfer_after_failures INTEGER DEFAULT 3,
  typing_delay_ms INTEGER DEFAULT 1500,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbots_organization ON chatbots(organization_id);
CREATE INDEX IF NOT EXISTS idx_chatbots_connection ON chatbots(connection_id);
CREATE INDEX IF NOT EXISTS idx_chatbots_active ON chatbots(is_active);

-- Tabela de fluxos do chatbot
CREATE TABLE IF NOT EXISTS chatbot_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  
  node_id VARCHAR(50) NOT NULL,
  node_type flow_node_type NOT NULL,
  name VARCHAR(255),
  
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  
  content JSONB DEFAULT '{}',
  next_node_id VARCHAR(50),
  order_index INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_flows_chatbot ON chatbot_flows(chatbot_id);

-- Tabela de sessões do chatbot
CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_phone VARCHAR(50) NOT NULL,
  
  current_node_id VARCHAR(50),
  variables JSONB DEFAULT '{}',
  
  is_active BOOLEAN DEFAULT true,
  failure_count INTEGER DEFAULT 0,
  transferred_at TIMESTAMP WITH TIME ZONE,
  transferred_to UUID REFERENCES users(id),
  
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_chatbot ON chatbot_sessions(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_conversation ON chatbot_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_active ON chatbot_sessions(is_active);

-- Tabela de mensagens do chatbot
CREATE TABLE IF NOT EXISTS chatbot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chatbot_sessions(id) ON DELETE CASCADE,
  
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  content TEXT,
  message_type VARCHAR(20) DEFAULT 'text',
  media_url TEXT,
  
  node_id VARCHAR(50),
  ai_generated BOOLEAN DEFAULT false,
  ai_tokens_used INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_session ON chatbot_messages(session_id);

-- Tabela de estatísticas
CREATE TABLE IF NOT EXISTS chatbot_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  total_sessions INTEGER DEFAULT 0,
  completed_sessions INTEGER DEFAULT 0,
  transferred_sessions INTEGER DEFAULT 0,
  
  total_messages_in INTEGER DEFAULT 0,
  total_messages_out INTEGER DEFAULT 0,
  
  ai_requests INTEGER DEFAULT 0,
  ai_tokens_used INTEGER DEFAULT 0,
  
  avg_session_duration_seconds INTEGER,
  avg_messages_per_session DECIMAL(5,2),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id, date)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_stats_chatbot_date ON chatbot_stats(chatbot_id, date);
`;

// Step 14: Chatbot Permissions
const step14ChatbotPermissions = `
-- Enum para nível de permissão de chatbot
DO $$ BEGIN
  CREATE TYPE chatbot_permission_level AS ENUM ('view', 'edit', 'manage', 'owner');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tabela de múltiplas conexões por chatbot
CREATE TABLE IF NOT EXISTS chatbot_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_connections_chatbot ON chatbot_connections(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_connections_connection ON chatbot_connections(connection_id);

-- Tabela de permissões de usuário para chatbots
CREATE TABLE IF NOT EXISTS chatbot_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_level chatbot_permission_level NOT NULL DEFAULT 'view',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_permissions_chatbot ON chatbot_permissions(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_permissions_user ON chatbot_permissions(user_id);

-- Configuração de permissões por papel (role-based)
CREATE TABLE IF NOT EXISTS chatbot_role_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  
  -- Quais papéis podem fazer o quê
  owner_can_manage BOOLEAN DEFAULT true,
  admin_can_manage BOOLEAN DEFAULT true,
  admin_can_edit BOOLEAN DEFAULT true,
  manager_can_view BOOLEAN DEFAULT true,
  manager_can_edit BOOLEAN DEFAULT false,
  agent_can_view BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_role_settings_chatbot ON chatbot_role_settings(chatbot_id);

-- Migrar connection_id existente para chatbot_connections
INSERT INTO chatbot_connections (chatbot_id, connection_id)
SELECT id, connection_id FROM chatbots WHERE connection_id IS NOT NULL
ON CONFLICT DO NOTHING;
`;

// Step 15: Chatbot Team Assignment & Keywords
const step15ChatbotTeamKeywords = `
-- Atendente padrão do chatbot (recebe transferências)
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS default_agent_id UUID REFERENCES users(id);

-- Palavras-chave para ativação automática do fluxo
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS trigger_keywords TEXT[] DEFAULT '{}';
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS trigger_enabled BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_chatbots_trigger_keywords ON chatbots USING GIN(trigger_keywords);
CREATE INDEX IF NOT EXISTS idx_chatbots_default_agent ON chatbots(default_agent_id);

-- Tabela de equipe de atendentes do chatbot
CREATE TABLE IF NOT EXISTS chatbot_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_agents_chatbot ON chatbot_agents(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_agents_user ON chatbot_agents(user_id);

-- Sessões de fluxo ativas em conversas (para encaminhamento manual)
CREATE TABLE IF NOT EXISTS conversation_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  current_node_id TEXT,
  variables JSONB DEFAULT '{}',
  started_by UUID REFERENCES users(id),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'transferred')),
  
  UNIQUE(conversation_id) -- apenas um fluxo ativo por conversa
);

CREATE INDEX IF NOT EXISTS idx_conversation_flows_conversation ON conversation_flows(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_flows_chatbot ON conversation_flows(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_conversation_flows_status ON conversation_flows(status);
`;

// Step 16: Independent Flows System
const step16IndependentFlows = `
-- Fluxos independentes (separados dos chatbots)
CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Ativação por palavra-chave
  trigger_enabled BOOLEAN DEFAULT false,
  trigger_keywords TEXT[] DEFAULT '{}',
  trigger_match_mode VARCHAR(20) DEFAULT 'exact' CHECK (trigger_match_mode IN ('exact', 'contains', 'starts_with')),
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_draft BOOLEAN DEFAULT true,
  
  -- Conexões vinculadas
  connection_ids UUID[] DEFAULT '{}',
  
  -- Metadata
  version INTEGER DEFAULT 1,
  last_edited_by UUID REFERENCES users(id),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flows_organization ON flows(organization_id);
CREATE INDEX IF NOT EXISTS idx_flows_active ON flows(is_active);
CREATE INDEX IF NOT EXISTS idx_flows_trigger_keywords ON flows USING GIN(trigger_keywords);

-- Nós do fluxo
CREATE TABLE IF NOT EXISTS flow_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  
  node_id VARCHAR(100) NOT NULL,
  node_type VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  
  content JSONB DEFAULT '{}',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(flow_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_flow_nodes_flow ON flow_nodes(flow_id);

-- Arestas do fluxo (conexões entre nós)
CREATE TABLE IF NOT EXISTS flow_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  
  edge_id VARCHAR(100) NOT NULL,
  source_node_id VARCHAR(100) NOT NULL,
  target_node_id VARCHAR(100) NOT NULL,
  source_handle VARCHAR(50),
  target_handle VARCHAR(50),
  
  label VARCHAR(255),
  edge_type VARCHAR(50) DEFAULT 'default',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(flow_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_flow_edges_flow ON flow_edges(flow_id);

-- Sessões de execução do fluxo (necessário para continuar após Input/Menu via webhooks)
CREATE TABLE IF NOT EXISTS flow_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_phone VARCHAR(50) NOT NULL,

  -- Estado atual
  current_node_id VARCHAR(100) NOT NULL DEFAULT 'start',
  variables JSONB DEFAULT '{}'::jsonb,

  -- Controle
  is_active BOOLEAN DEFAULT true,
  started_by UUID REFERENCES users(id),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE
);

-- Backward/forward compatibility (for existing DBs)
DO $$ BEGIN
  ALTER TABLE flow_sessions ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  ALTER TABLE flow_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Apenas uma sessão ativa por conversa (permite ON CONFLICT (conversation_id) WHERE is_active = true)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_flow_sessions_active_conversation
  ON flow_sessions(conversation_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_flow_sessions_flow ON flow_sessions(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_sessions_conversation ON flow_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_flow_sessions_active ON flow_sessions(is_active);

-- Histórico de versões do fluxo
CREATE TABLE IF NOT EXISTS flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  
  nodes_data JSONB NOT NULL,
  edges_data JSONB NOT NULL,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(flow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_flow_versions_flow ON flow_versions(flow_id);

-- Vincular chatbot a um fluxo
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS linked_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_chatbots_linked_flow ON chatbots(linked_flow_id);

-- Categorias de fluxos
CREATE TABLE IF NOT EXISTS flow_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(20) DEFAULT '#6366f1',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flow_categories_org ON flow_categories(organization_id);

-- Categoria no fluxo
ALTER TABLE flows ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES flow_categories(id) ON DELETE SET NULL;

-- Membros com acesso ao fluxo
CREATE TABLE IF NOT EXISTS flow_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(flow_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_flow_members_flow ON flow_members(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_members_user ON flow_members(user_id);
`;

// Step 18: CRM System
const step18CRM = `
-- CRM User Groups
CREATE TABLE IF NOT EXISTS crm_user_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

CREATE TABLE IF NOT EXISTS crm_user_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES crm_user_groups(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    is_supervisor BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

-- CRM Funnels
CREATE TABLE IF NOT EXISTS crm_funnels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT '#6366f1',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

CREATE TABLE IF NOT EXISTS crm_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funnel_id UUID REFERENCES crm_funnels(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#6366f1',
    position INTEGER NOT NULL DEFAULT 0,
    inactivity_hours INTEGER DEFAULT 24,
    inactivity_color VARCHAR(20) DEFAULT '#ef4444',
    is_final BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Companies
CREATE TABLE IF NOT EXISTS crm_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    cnpj VARCHAR(20),
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(500),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Deals
CREATE TABLE IF NOT EXISTS crm_deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    funnel_id UUID REFERENCES crm_funnels(id) ON DELETE CASCADE NOT NULL,
    stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    -- Ordering within a stage (Kanban drag & drop)
    position INTEGER NOT NULL DEFAULT 0,
    company_id UUID REFERENCES crm_companies(id) ON DELETE CASCADE NOT NULL,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    group_id UUID REFERENCES crm_user_groups(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    value DECIMAL(15, 2) DEFAULT 0,
    probability INTEGER DEFAULT 50,
    expected_close_date DATE,
    status VARCHAR(20) DEFAULT 'open',
    won_at TIMESTAMP WITH TIME ZONE,
    lost_at TIMESTAMP WITH TIME ZONE,
    lost_reason TEXT,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    description TEXT,
    tags TEXT[],
    custom_fields JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure position exists for older databases (and backfill a stable order)
DO $$ BEGIN
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$
DECLARE
  total_count BIGINT;
  zero_count BIGINT;
BEGIN
  -- If the column is newly added, all rows will be 0. Backfill a deterministic order.
  SELECT COUNT(*) INTO total_count FROM crm_deals;
  SELECT COUNT(*) INTO zero_count FROM crm_deals WHERE position = 0;

  IF total_count > 0 AND zero_count = total_count THEN
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY organization_id, stage_id
               ORDER BY created_at ASC, id ASC
             ) - 1 AS new_pos
      FROM crm_deals
      WHERE stage_id IS NOT NULL
    )
    UPDATE crm_deals d
    SET position = r.new_pos
    FROM ranked r
    WHERE d.id = r.id;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm_deal_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    role VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(deal_id, contact_id)
);

CREATE TABLE IF NOT EXISTS crm_deal_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    from_value TEXT,
    to_value TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Tasks
CREATE TABLE IF NOT EXISTS crm_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE,
    company_id UUID REFERENCES crm_companies(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) DEFAULT 'task',
    priority VARCHAR(20) DEFAULT 'medium',
    due_date TIMESTAMP WITH TIME ZONE,
    reminder_at TIMESTAMP WITH TIME ZONE,
    reminder_minutes INTEGER DEFAULT NULL,
    reminder_whatsapp BOOLEAN DEFAULT false,
    reminder_popup BOOLEAN DEFAULT true,
    reminder_sent BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'pending',
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Indexes
CREATE INDEX IF NOT EXISTS idx_crm_user_groups_org ON crm_user_groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_user_group_members_group ON crm_user_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_crm_user_group_members_user ON crm_user_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_funnels_org ON crm_funnels(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_stages_funnel ON crm_stages(funnel_id);
CREATE INDEX IF NOT EXISTS idx_crm_companies_org ON crm_companies(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_org ON crm_deals(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_funnel ON crm_deals(funnel_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_company ON crm_deals(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_owner ON crm_deals(owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_status ON crm_deals(status);
CREATE INDEX IF NOT EXISTS idx_crm_deals_activity ON crm_deals(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage_position ON crm_deals(organization_id, stage_id, position);
CREATE INDEX IF NOT EXISTS idx_crm_deal_contacts_deal ON crm_deal_contacts(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_history_deal ON crm_deal_history(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_org ON crm_tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_deal ON crm_tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assigned ON crm_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_due ON crm_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_status ON crm_tasks(status);
`;

// Step 19: CRM Configuration (Task Types, Segments, Custom Fields)
const step19CRMConfig = `
-- Task Types (Global + Organization-specific)
CREATE TABLE IF NOT EXISTS crm_task_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(50) DEFAULT 'check-square',
    color VARCHAR(20) DEFAULT '#6366f1',
    is_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add unique constraint for global task types (only one per name when is_global=true)
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_task_types_global_name 
  ON crm_task_types (name) WHERE is_global = true;

-- Add unique constraint for organization task types
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_task_types_org_name 
  ON crm_task_types (organization_id, name) WHERE organization_id IS NOT NULL;

-- Segments/Tags for Deals
CREATE TABLE IF NOT EXISTS crm_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#6366f1',
    description TEXT,
    is_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Deal Segments (Many-to-Many)
CREATE TABLE IF NOT EXISTS crm_deal_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    segment_id UUID REFERENCES crm_segments(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(deal_id, segment_id)
);

-- Custom Fields Definition
CREATE TABLE IF NOT EXISTS crm_custom_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL, -- 'deal', 'company', 'task'
    field_name VARCHAR(100) NOT NULL,
    field_label VARCHAR(200) NOT NULL,
    field_type VARCHAR(50) DEFAULT 'text', -- text, number, date, select, multiselect, boolean
    options JSONB, -- for select/multiselect
    is_required BOOLEAN DEFAULT false,
    is_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_task_types_org ON crm_task_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_segments_org ON crm_segments(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_segments_deal ON crm_deal_segments(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_segments_segment ON crm_deal_segments(segment_id);
CREATE INDEX IF NOT EXISTS idx_crm_custom_fields_org ON crm_custom_fields(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_custom_fields_entity ON crm_custom_fields(entity_type);

-- Insert default global task types (with conflict handling)
INSERT INTO crm_task_types (name, icon, color, is_global, position) VALUES
    ('Tarefa', 'check-square', '#6366f1', true, 0),
    ('Ligação', 'phone', '#22c55e', true, 1),
    ('E-mail', 'mail', '#f59e0b', true, 2),
    ('Reunião', 'calendar', '#8b5cf6', true, 3),
    ('WhatsApp', 'message-circle', '#25d366', true, 4),
    ('Follow-up', 'repeat', '#ec4899', true, 5)
ON CONFLICT (name) WHERE is_global = true DO NOTHING;

-- Loss Reasons (motivos de perda)
CREATE TABLE IF NOT EXISTS crm_loss_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    position INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_loss_reasons_org ON crm_loss_reasons(organization_id);

-- Cleanup duplicate global loss reasons (in case init ran multiple times)
DELETE FROM crm_loss_reasons
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn
    FROM crm_loss_reasons
    WHERE organization_id IS NULL
  ) t
  WHERE rn > 1
);

-- Unique constraints to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_loss_reasons_global_name
  ON crm_loss_reasons (name) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_loss_reasons_org_name
  ON crm_loss_reasons (organization_id, name) WHERE organization_id IS NOT NULL;

-- Add loss_reason_id to crm_deals if not exists
DO $$ BEGIN
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS loss_reason_id UUID REFERENCES crm_loss_reasons(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Insert default loss reasons
INSERT INTO crm_loss_reasons (name, description, is_active, position) VALUES
    ('Preço muito alto', 'Cliente achou o valor elevado para o orçamento disponível', true, 0),
    ('Optou pela concorrência', 'Cliente escolheu um concorrente', true, 1),
    ('Sem orçamento', 'Cliente não possui verba disponível no momento', true, 2),
    ('Timing inadequado', 'O momento não é propício para a compra', true, 3),
    ('Não respondeu', 'Cliente parou de responder às tentativas de contato', true, 4),
    ('Mudança de prioridades', 'O projeto/necessidade deixou de ser prioridade', true, 5),
    ('Proposta não atende', 'Produto/serviço não atende às necessidades do cliente', true, 6)
ON CONFLICT (name) WHERE organization_id IS NULL DO NOTHING;
`;

// Step 17: Departments / Queues System (depends on organizations, users, conversations)
// NOTE: This was previously defined only in a standalone SQL file, but not executed
// during initDatabase(). If the tables don't exist, /api/departments will 500.
const step17Departments = `
-- Schema para sistema de Filas/Departamentos de Atendimento
-- Cada organização pode ter múltiplos departamentos
-- Cada usuário pode pertencer a múltiplos departamentos

-- Tabela de departamentos/filas
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(7) DEFAULT '#6366f1',
  icon VARCHAR(50) DEFAULT 'users',

  is_active BOOLEAN DEFAULT true,

  max_concurrent_chats INTEGER DEFAULT 5,
  auto_assign BOOLEAN DEFAULT false,

  business_hours_enabled BOOLEAN DEFAULT false,
  business_hours_start TIME DEFAULT '08:00',
  business_hours_end TIME DEFAULT '18:00',
  business_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],

  welcome_message TEXT,
  offline_message TEXT,
  queue_message TEXT DEFAULT 'Você está na fila de espera. Em breve um atendente irá te atender.',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(organization_id, name)
);

-- Índices para departments
CREATE INDEX IF NOT EXISTS idx_departments_organization ON departments(organization_id);
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active);

-- Tabela de membros do departamento (relação N:N entre users e departments)
CREATE TABLE IF NOT EXISTS department_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  role VARCHAR(20) DEFAULT 'agent' CHECK (role IN ('supervisor', 'agent')),

  is_available BOOLEAN DEFAULT true,
  current_chats INTEGER DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(department_id, user_id)
);

-- Índices para department_members
CREATE INDEX IF NOT EXISTS idx_department_members_department ON department_members(department_id);
CREATE INDEX IF NOT EXISTS idx_department_members_user ON department_members(user_id);
CREATE INDEX IF NOT EXISTS idx_department_members_available ON department_members(is_available);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_department_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_departments_updated_at ON departments;
CREATE TRIGGER trigger_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW
  EXECUTE FUNCTION update_department_updated_at();
`;

// Step 17b: Add department_id to conversations (separate step to avoid dependency issues)
const step17bDepartmentConversations = `
-- Adicionar coluna de departamento na tabela de conversas (se não existir)
DO $$ BEGIN
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
EXCEPTION
  WHEN undefined_table THEN null;
  WHEN undefined_column THEN null;
END $$;

-- Índice para buscar conversas por departamento
CREATE INDEX IF NOT EXISTS idx_conversations_department ON conversations(department_id);
`;

// Step 20: CRM Migrations (additional columns)
const step20CRMMigrations = `
-- Add has_crm to plans table
DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_crm BOOLEAN DEFAULT true;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Add segment_id to crm_companies (linking company to a segment)
DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES crm_segments(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN null;
  WHEN undefined_table THEN null;
END $$;

-- Index for segment lookup on companies
CREATE INDEX IF NOT EXISTS idx_crm_companies_segment ON crm_companies(segment_id);

-- Add owner_id and group_id to crm_companies
DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN null;
  WHEN undefined_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES crm_user_groups(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN null;
  WHEN undefined_table THEN null;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_companies_owner ON crm_companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_companies_group ON crm_companies(group_id);

-- Add extended company fields
DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS razao_social VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS nome_fantasia VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS inscricao_estadual VARCHAR(30);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS inscricao_municipal VARCHAR(30);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS porte VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS cnae VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS more_info TEXT;
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;
`;

// Step 21: CRM Prospects
const step21Prospects = `
-- Prospects table for simple lead management before conversion to deals
CREATE TABLE IF NOT EXISTS crm_prospects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    source VARCHAR(100),
    city VARCHAR(100),
    state VARCHAR(50),
    address TEXT,
    zip_code VARCHAR(20),
    is_company BOOLEAN DEFAULT false,
    custom_fields JSONB DEFAULT '{}',
    converted_at TIMESTAMP WITH TIME ZONE,
    converted_deal_id UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, phone)
);

-- Add new columns if not exists
DO $$ BEGIN
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS city VARCHAR(100);
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS state VARCHAR(50);
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS zip_code VARCHAR(20);
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS is_company BOOLEAN DEFAULT false;
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Indexes for prospects
CREATE INDEX IF NOT EXISTS idx_crm_prospects_org ON crm_prospects(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_prospects_phone ON crm_prospects(phone);
CREATE INDEX IF NOT EXISTS idx_crm_prospects_converted ON crm_prospects(converted_at);

-- Prospect custom field definitions per organization
CREATE TABLE IF NOT EXISTS crm_prospect_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    field_key VARCHAR(100) NOT NULL,
    field_label VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) DEFAULT 'text',
    is_required BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_prospect_fields_org ON crm_prospect_fields(organization_id);
`;

// ============================================
// STEP 22: CRM AUTOMATION
// ============================================
const step22CRMAutomation = `
-- CRM Stage Automations (one per stage)
CREATE TABLE IF NOT EXISTS crm_stage_automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_id UUID REFERENCES crm_stages(id) ON DELETE CASCADE NOT NULL UNIQUE,
    flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
    wait_hours NUMERIC(10,4) NOT NULL DEFAULT 24,
    next_stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    fallback_funnel_id UUID REFERENCES crm_funnels(id) ON DELETE SET NULL,
    fallback_stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    execute_immediately BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Deal Automations (active automation per deal)
CREATE TABLE IF NOT EXISTS crm_deal_automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    stage_id UUID REFERENCES crm_stages(id) ON DELETE CASCADE NOT NULL,
    automation_id UUID REFERENCES crm_stage_automations(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'pending',
    flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
    flow_session_id UUID,
    flow_sent_at TIMESTAMP WITH TIME ZONE,
    wait_until TIMESTAMP WITH TIME ZONE,
    responded_at TIMESTAMP WITH TIME ZONE,
    moved_at TIMESTAMP WITH TIME ZONE,
    next_stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    contact_phone VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Automation Logs
CREATE TABLE IF NOT EXISTS crm_automation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_automation_id UUID REFERENCES crm_deal_automations(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    action VARCHAR(50) NOT NULL,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for CRM Automation
CREATE INDEX IF NOT EXISTS idx_crm_stage_automations_stage ON crm_stage_automations(stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_stage_automations_flow ON crm_stage_automations(flow_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_automations_deal ON crm_deal_automations(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_automations_status ON crm_deal_automations(status);
CREATE INDEX IF NOT EXISTS idx_crm_deal_automations_wait ON crm_deal_automations(wait_until);
CREATE INDEX IF NOT EXISTS idx_crm_deal_automations_phone ON crm_deal_automations(contact_phone);
CREATE INDEX IF NOT EXISTS idx_crm_automation_logs_deal ON crm_automation_logs(deal_id);
`;

// ============================================
// STEP 23: EMAIL SYSTEM
// ============================================
const step23Email = `
-- Email SMTP configs (organization level)
CREATE TABLE IF NOT EXISTS email_smtp_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL UNIQUE,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 587,
    secure BOOLEAN DEFAULT true,
    username VARCHAR(255) NOT NULL,
    password_encrypted TEXT NOT NULL,
    from_name VARCHAR(255) NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    reply_to VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    last_verified_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email SMTP configs (user level - overrides org)
CREATE TABLE IF NOT EXISTS email_user_smtp_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 587,
    secure BOOLEAN DEFAULT true,
    username VARCHAR(255) NOT NULL,
    password_encrypted TEXT NOT NULL,
    from_name VARCHAR(255) NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    reply_to VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    last_verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, organization_id)
);

-- Email templates
CREATE TABLE IF NOT EXISTS email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) DEFAULT 'general',
    subject VARCHAR(500) NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    available_variables TEXT[] DEFAULT ARRAY['nome', 'email', 'telefone', 'empresa'],
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email queue
CREATE TABLE IF NOT EXISTS email_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
    to_email VARCHAR(255) NOT NULL,
    to_name VARCHAR(255),
    cc TEXT[],
    bcc TEXT[],
    subject VARCHAR(500) NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    context_type VARCHAR(50),
    context_id UUID,
    variables JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email history
CREATE TABLE IF NOT EXISTS email_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    queue_id UUID REFERENCES email_queue(id) ON DELETE SET NULL,
    sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    context_type VARCHAR(50),
    context_id UUID,
    status VARCHAR(20) NOT NULL,
    error_message TEXT,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for email system
CREATE INDEX IF NOT EXISTS idx_email_smtp_configs_org ON email_smtp_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_user_smtp_configs_user ON email_user_smtp_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_org ON email_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON email_queue(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_email_history_org ON email_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_history_context ON email_history(context_type, context_id);
`;

// ============================================
// STEP 24: GOOGLE CALENDAR INTEGRATION
// ============================================
const step24GoogleCalendar = `
-- Google OAuth tokens
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_type VARCHAR(50) DEFAULT 'Bearer',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    scope TEXT,
    google_email VARCHAR(255),
    google_name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Google Calendar events mapping
CREATE TABLE IF NOT EXISTS google_calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    crm_task_id UUID REFERENCES crm_tasks(id) ON DELETE CASCADE,
    crm_deal_id UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
    google_event_id VARCHAR(255) NOT NULL,
    google_calendar_id VARCHAR(255) DEFAULT 'primary',
    event_summary VARCHAR(500),
    event_start TIMESTAMP WITH TIME ZONE,
    event_end TIMESTAMP WITH TIME ZONE,
    meet_link VARCHAR(500),
    sync_status VARCHAR(20) DEFAULT 'synced',
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, crm_task_id)
);

-- Add new columns if not exists (migration for existing databases)
DO $$ BEGIN
    ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS event_summary VARCHAR(500);
    ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS event_start TIMESTAMP WITH TIME ZONE;
    ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS event_end TIMESTAMP WITH TIME ZONE;
    ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS meet_link VARCHAR(500);
    
    -- Drop old unique constraint if it was crm_task_id only
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_calendar_events_user_id_crm_task_id_key') THEN
        ALTER TABLE google_calendar_events DROP CONSTRAINT google_calendar_events_user_id_crm_task_id_key;
    END IF;

    -- Add composite unique constraint to allow multiple events per user/task if needed (or just ensure mapping)
    -- Actually keep user_id + crm_task_id unique for standard tasks
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_calendar_events_user_id_crm_task_id_key') THEN
        ALTER TABLE google_calendar_events ADD CONSTRAINT google_calendar_events_user_id_crm_task_id_key UNIQUE (user_id, crm_task_id);
    END IF;
    
    -- Add unique constraint for google_event_id per user
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'google_calendar_events_user_id_google_event_id_key') THEN
        ALTER TABLE google_calendar_events ADD CONSTRAINT google_calendar_events_user_id_google_event_id_key UNIQUE (user_id, google_event_id);
    END IF;
EXCEPTION
    WHEN duplicate_column THEN null;
    WHEN duplicate_object THEN null;
END $$;

-- Calendar selection / enabled calendars per user
DO $$ BEGIN
    ALTER TABLE google_oauth_tokens ADD COLUMN IF NOT EXISTS selected_calendar_id VARCHAR(255);
    ALTER TABLE google_oauth_tokens ADD COLUMN IF NOT EXISTS enabled_calendars JSONB DEFAULT '[]'::jsonb;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add unique constraint on google_event_id if not exists
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'google_calendar_events_user_id_google_event_id_key'
    ) THEN
        ALTER TABLE google_calendar_events ADD CONSTRAINT google_calendar_events_user_id_google_event_id_key UNIQUE (user_id, google_event_id);
    END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_google_oauth_user ON google_oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_user ON google_calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_task ON google_calendar_events(crm_task_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_deal ON google_calendar_events(crm_deal_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_start ON google_calendar_events(event_start);
`;

// ============================================
// STEP 25: AI AGENTS MODULE
// ============================================
const step25AIAgents = `
-- Enum for AI provider
DO $$ BEGIN
  CREATE TYPE agent_ai_provider AS ENUM ('openai', 'gemini');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Enum for knowledge source type
DO $$ BEGIN
  CREATE TYPE knowledge_source_type AS ENUM ('file', 'url', 'text');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Enum for processing status
DO $$ BEGIN
  CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Enum for agent capabilities
DO $$ BEGIN
  CREATE TYPE agent_capability AS ENUM (
    'respond_messages',
    'read_files',
    'schedule_meetings',
    'create_deals',
    'suggest_actions',
    'generate_content',
    'summarize_history',
    'qualify_leads',
    'manage_tasks',
    'google_calendar'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Add new enum values if they don't exist (self-healing for older DBs)
DO $$ BEGIN ALTER TYPE agent_capability ADD VALUE IF NOT EXISTS 'manage_tasks'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE agent_capability ADD VALUE IF NOT EXISTS 'google_calendar'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE agent_capability ADD VALUE IF NOT EXISTS 'call_agent'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE agent_capability ADD VALUE IF NOT EXISTS 'transcribe_audio'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE agent_capability ADD VALUE IF NOT EXISTS 'analyze_images'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE agent_capability ADD VALUE IF NOT EXISTS 'appbarber'; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AI Agents main table
CREATE TABLE IF NOT EXISTS ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  ai_provider agent_ai_provider NOT NULL DEFAULT 'openai',
  ai_model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
  ai_api_key TEXT,
  system_prompt TEXT NOT NULL DEFAULT 'Você é um assistente virtual prestativo e profissional.',
  personality_traits JSONB DEFAULT '[]',
  language VARCHAR(10) DEFAULT 'pt-BR',
  temperature DECIMAL(2,1) DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 1000,
  context_window INTEGER DEFAULT 10,
  capabilities agent_capability[] DEFAULT ARRAY['respond_messages']::agent_capability[],
  greeting_message TEXT,
  fallback_message TEXT DEFAULT 'Desculpe, não consegui entender. Pode reformular sua pergunta?',
  handoff_message TEXT DEFAULT 'Vou transferir você para um atendente humano.',
  handoff_keywords TEXT[] DEFAULT ARRAY['humano', 'atendente', 'pessoa'],
  auto_handoff_after_failures INTEGER DEFAULT 3,
  default_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  default_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  lead_scoring_criteria JSONB DEFAULT '{}',
  auto_create_deal_funnel_id UUID,
  auto_create_deal_stage_id UUID,
  total_conversations INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  satisfaction_score DECIMAL(3,2),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Google Calendar connection for agents (which user's calendar to use)
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS google_calendar_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS call_agent_config JSONB DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Knowledge sources
CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  source_type knowledge_source_type NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  source_content TEXT NOT NULL,
  file_type VARCHAR(50),
  file_size INTEGER,
  original_filename VARCHAR(255),
  status processing_status DEFAULT 'pending',
  error_message TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  chunk_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Knowledge chunks for RAG
CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}',
  token_count INTEGER,
  char_count INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent sessions
CREATE TABLE IF NOT EXISTS ai_agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_phone VARCHAR(50),
  contact_name VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  context_variables JSONB DEFAULT '{}',
  lead_score INTEGER,
  qualification_data JSONB DEFAULT '{}',
  handoff_requested BOOLEAN DEFAULT false,
  handoff_at TIMESTAMP WITH TIME ZONE,
  handoff_to_user_id UUID REFERENCES users(id),
  handoff_reason TEXT,
  message_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  paused_until TIMESTAMP WITH TIME ZONE,
  human_takeover BOOLEAN DEFAULT false,
  human_takeover_by UUID REFERENCES users(id),
  human_takeover_at TIMESTAMP WITH TIME ZONE
);

-- Agent messages
CREATE TABLE IF NOT EXISTS ai_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  media_type VARCHAR(50),
  media_url TEXT,
  knowledge_sources_used UUID[],
  context_chunks JSONB,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  tool_calls JSONB,
  tool_results JSONB,
  feedback_rating INTEGER CHECK (feedback_rating >= 1 AND feedback_rating <= 5),
  feedback_comment TEXT,
  processing_time_ms INTEGER,
  model_used VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Prompt templates
CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  template TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  is_system BOOLEAN DEFAULT false,
  usage_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent connections (WhatsApp)
CREATE TABLE IF NOT EXISTS ai_agent_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  mode VARCHAR(50) DEFAULT 'always',
  trigger_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  business_hours_start TIME DEFAULT '08:00',
  business_hours_end TIME DEFAULT '18:00',
  business_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, connection_id)
);

-- Agent statistics
CREATE TABLE IF NOT EXISTS ai_agent_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_sessions INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  total_tokens_used INTEGER DEFAULT 0,
  handoff_count INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  positive_feedback_count INTEGER DEFAULT 0,
  negative_feedback_count INTEGER DEFAULT 0,
  deals_created INTEGER DEFAULT 0,
  meetings_scheduled INTEGER DEFAULT 0,
  leads_qualified INTEGER DEFAULT 0,
  tasks_created INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, date)
);

-- Add tasks_created column if not exists
DO $$ BEGIN
  ALTER TABLE ai_agent_stats ADD COLUMN IF NOT EXISTS tasks_created INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Indexes for AI Agents
CREATE INDEX IF NOT EXISTS idx_ai_agents_organization ON ai_agents(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_agents_active ON ai_agents(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sources_agent ON ai_knowledge_sources(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sources_status ON ai_knowledge_sources(status);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_source ON ai_knowledge_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_agent ON ai_agent_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_conversation ON ai_agent_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_active ON ai_agent_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_agent_messages_session ON ai_agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_templates_organization ON ai_prompt_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_connections_agent ON ai_agent_connections(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_connections_connection ON ai_agent_connections(connection_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_stats_agent_date ON ai_agent_stats(agent_id, date);

-- Add has_ai_agents to plans if not exists
DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_ai_agents BOOLEAN DEFAULT true;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Add ai_agents to organizations modules_enabled
UPDATE organizations 
SET modules_enabled = modules_enabled || '{"ai_agents": true}'::jsonb
WHERE modules_enabled IS NOT NULL 
  AND NOT (modules_enabled ? 'ai_agents');

-- Add notify_external columns to ai_agents
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS notify_external_enabled BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS notify_external_phone VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS notify_external_summary BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Takeover timeout, required variables, inactivity timeout for AI agents
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS takeover_timeout_seconds INTEGER DEFAULT 300;
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS required_variables JSONB DEFAULT '[]';
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS inactivity_timeout_minutes INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS inactivity_message TEXT DEFAULT 'Como não recebi sua resposta, vou encerrar nosso atendimento por aqui. Se precisar, é só me chamar novamente! 😊';
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- AppBarber integration columns
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS appbarber_api_key TEXT;
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS appbarber_establishment_code VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE global_ai_agents ADD COLUMN IF NOT EXISTS appbarber_api_key TEXT;
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE global_ai_agents ADD COLUMN IF NOT EXISTS appbarber_establishment_code VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN null; END $$;


-- Add appbarber capability to enum
DO $$ BEGIN
  ALTER TYPE agent_capability ADD VALUE IF NOT EXISTS 'appbarber';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AppBarber cached services table
CREATE TABLE IF NOT EXISTS appbarber_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    service_code INTEGER NOT NULL,
    service_description VARCHAR(255) NOT NULL,
    service_value DECIMAL(10,2) DEFAULT 0,
    service_interval INTEGER DEFAULT 30,
    is_active BOOLEAN DEFAULT true,
    synced_from_api BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(agent_id, service_code)
);
CREATE INDEX IF NOT EXISTS idx_appbarber_services_agent ON appbarber_services(agent_id);
CREATE INDEX IF NOT EXISTS idx_appbarber_services_org ON appbarber_services(organization_id);

-- AppBarber cached professionals table
CREATE TABLE IF NOT EXISTS appbarber_professionals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    employee_code INTEGER NOT NULL,
    employee_name VARCHAR(255) NOT NULL,
    employee_nickname VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    synced_from_api BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(agent_id, employee_code)
);
CREATE INDEX IF NOT EXISTS idx_appbarber_professionals_agent ON appbarber_professionals(agent_id);
CREATE INDEX IF NOT EXISTS idx_appbarber_professionals_org ON appbarber_professionals(organization_id);

-- AppBarber cached payment types table
CREATE TABLE IF NOT EXISTS appbarber_payment_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    payment_code INTEGER NOT NULL,
    payment_description VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    synced_from_api BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(agent_id, payment_code)
);
CREATE INDEX IF NOT EXISTS idx_appbarber_payment_types_agent ON appbarber_payment_types(agent_id);

--- AppBarber for Global Agents
CREATE TABLE IF NOT EXISTS global_agent_appbarber_payment_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    global_agent_id UUID REFERENCES global_ai_agents(id) ON DELETE CASCADE NOT NULL,
    payment_code INTEGER NOT NULL,
    payment_description VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    synced_from_api BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(global_agent_id, payment_code)
);

CREATE TABLE IF NOT EXISTS global_agent_appbarber_services (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    global_agent_id UUID REFERENCES global_ai_agents(id) ON DELETE CASCADE NOT NULL,
    service_code INTEGER NOT NULL,
    service_description VARCHAR(255) NOT NULL,
    service_value DECIMAL(10,2) DEFAULT 0,
    service_interval INTEGER DEFAULT 30,
    is_active BOOLEAN DEFAULT true,
    synced_from_api BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(global_agent_id, service_code)
);

CREATE TABLE IF NOT EXISTS global_agent_appbarber_professionals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    global_agent_id UUID REFERENCES global_ai_agents(id) ON DELETE CASCADE NOT NULL,
    employee_code INTEGER NOT NULL,
    employee_name VARCHAR(255) NOT NULL,
    employee_nickname VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    synced_from_api BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(global_agent_id, employee_code)
);

CREATE INDEX IF NOT EXISTS idx_appbarber_payment_types_org ON appbarber_payment_types(organization_id);

ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding JSONB;
ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- RAG columns for ai_knowledge_sources
ALTER TABLE ai_knowledge_sources ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE ai_knowledge_sources ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100);
ALTER TABLE ai_knowledge_sources ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER;

-- RAG indexes
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_hash ON ai_knowledge_chunks(content_hash);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_source_active ON ai_knowledge_chunks(source_id);

-- Cosine similarity function for JSONB embeddings
CREATE OR REPLACE FUNCTION cosine_similarity(a JSONB, b JSONB)
RETURNS FLOAT AS $$
DECLARE
  dot_product FLOAT := 0;
  norm_a FLOAT := 0;
  norm_b FLOAT := 0;
  len INTEGER;
  i INTEGER;
  va FLOAT;
  vb FLOAT;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN 0; END IF;
  len := LEAST(jsonb_array_length(a), jsonb_array_length(b));
  IF len = 0 THEN RETURN 0; END IF;
  FOR i IN 0..len-1 LOOP
    va := (a->i)::FLOAT;
    vb := (b->i)::FLOAT;
    dot_product := dot_product + (va * vb);
    norm_a := norm_a + (va * va);
    norm_b := norm_b + (vb * vb);
  END LOOP;
  IF norm_a = 0 OR norm_b = 0 THEN RETURN 0; END IF;
  RETURN dot_product / (sqrt(norm_a) * sqrt(norm_b));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Search knowledge chunks by semantic similarity
CREATE OR REPLACE FUNCTION search_knowledge_chunks(
  p_agent_id UUID,
  p_query_embedding JSONB,
  p_limit INTEGER DEFAULT 5,
  p_min_similarity FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  chunk_id UUID,
  source_id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as chunk_id,
    c.source_id,
    c.content,
    c.metadata,
    cosine_similarity(c.embedding, p_query_embedding) as similarity
  FROM ai_knowledge_chunks c
  JOIN ai_knowledge_sources s ON s.id = c.source_id
  WHERE s.agent_id = p_agent_id 
    AND s.is_active = true 
    AND s.status = 'completed'
    AND c.embedding IS NOT NULL
    AND cosine_similarity(c.embedding, p_query_embedding) >= p_min_similarity
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
`;

// ============================================
// STEP 26: EXTERNAL FORMS
// ============================================
const step26ExternalForms = `
-- Form definitions table
CREATE TABLE IF NOT EXISTS external_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Basic info
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  
  -- Branding
   logo_url TEXT,
   logo_size INTEGER DEFAULT 48,
  primary_color VARCHAR(20) DEFAULT '#6366f1',
  background_color VARCHAR(20) DEFAULT '#ffffff',
  text_color VARCHAR(20) DEFAULT '#1f2937',
  button_text VARCHAR(100) DEFAULT 'Enviar',
  welcome_message TEXT DEFAULT 'Olá! Vamos começar?',
  
  -- Post-submission config
  thank_you_message TEXT DEFAULT 'Obrigado pelo contato! Em breve entraremos em contato.',
  redirect_url TEXT,
  trigger_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
  
  -- Stats
  views_count INTEGER DEFAULT 0,
  submissions_count INTEGER DEFAULT 0,
  
  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, slug)
);

-- Form fields (customizable per form)
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

-- Form submissions (leads captured)
CREATE TABLE IF NOT EXISTS external_form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES external_forms(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Core captured data
  data JSONB NOT NULL DEFAULT '{}',
  
  -- Extracted standard fields for easy querying
  name VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(50),
  
  -- Tracking
  ip_address INET,
  user_agent TEXT,
  referrer TEXT,
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  
  -- Integration status
  prospect_id UUID REFERENCES crm_prospects(id),
  contact_id UUID REFERENCES chat_contacts(id),
  flow_session_id UUID,
  processed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_external_forms_org ON external_forms(organization_id);
CREATE INDEX IF NOT EXISTS idx_external_forms_slug ON external_forms(slug);
CREATE INDEX IF NOT EXISTS idx_external_forms_active ON external_forms(is_active) WHERE is_active = true;

-- Update display_mode default to typeform
DO $$ BEGIN
    ALTER TABLE external_forms ALTER COLUMN display_mode SET DEFAULT 'typeform';
EXCEPTION WHEN others THEN null; END $$;
CREATE INDEX IF NOT EXISTS idx_external_form_fields_form ON external_form_fields(form_id);
CREATE INDEX IF NOT EXISTS idx_external_form_submissions_form ON external_form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_external_form_submissions_org ON external_form_submissions(organization_id);

-- Display mode: chat | typeform | standard
DO $$ BEGIN
    ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS display_mode VARCHAR(20) DEFAULT 'chat';
    ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS logo_size INTEGER DEFAULT 48;
    ALTER TABLE external_forms ADD COLUMN IF NOT EXISTS transition_type VARCHAR(20) DEFAULT 'slide-right';
EXCEPTION WHEN duplicate_column THEN null; END $$;
CREATE INDEX IF NOT EXISTS idx_external_form_submissions_phone ON external_form_submissions(phone);
CREATE INDEX IF NOT EXISTS idx_external_form_submissions_created ON external_form_submissions(created_at DESC);
`;

// ============================================
// STEP 27: LEAD DISTRIBUTION
// ============================================
const step27LeadDistribution = `
-- Adicionar colunas na tabela connections para controlar distribuição
DO $$ BEGIN
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS lead_distribution_enabled BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS lead_distribution_last_user_index INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Tabela de usuários elegíveis para distribuição de leads em cada conexão
CREATE TABLE IF NOT EXISTS connection_lead_distribution (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    max_leads_per_day INTEGER,
    leads_today INTEGER DEFAULT 0,
    last_lead_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (connection_id, user_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_connection_lead_dist_conn ON connection_lead_distribution(connection_id);
CREATE INDEX IF NOT EXISTS idx_connection_lead_dist_user ON connection_lead_distribution(user_id);
CREATE INDEX IF NOT EXISTS idx_connection_lead_dist_active ON connection_lead_distribution(is_active);

-- Tabela de log de distribuição
CREATE TABLE IF NOT EXISTS lead_distribution_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    conversation_id UUID,
    contact_phone VARCHAR(50),
    contact_name VARCHAR(255),
    assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    distribution_method VARCHAR(20) DEFAULT 'round_robin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_dist_log_conn ON lead_distribution_log(connection_id);
CREATE INDEX IF NOT EXISTS idx_lead_dist_log_user ON lead_distribution_log(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_dist_log_date ON lead_distribution_log(created_at);
`;

// Step 28: Lead Scoring
const step28LeadScoring = `
-- Lead scoring configuration per organization
CREATE TABLE IF NOT EXISTS lead_scoring_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    weight_response_time INTEGER DEFAULT 20,
    weight_engagement INTEGER DEFAULT 25,
    weight_profile_completeness INTEGER DEFAULT 15,
    weight_deal_value INTEGER DEFAULT 20,
    weight_funnel_progress INTEGER DEFAULT 10,
    weight_recency INTEGER DEFAULT 10,
    hot_threshold INTEGER DEFAULT 70,
    warm_threshold INTEGER DEFAULT 40,
    auto_update_on_message BOOLEAN DEFAULT true,
    auto_update_on_stage_change BOOLEAN DEFAULT true,
    recalculate_interval_hours INTEGER DEFAULT 24,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id)
);

-- Lead scores per deal
CREATE TABLE IF NOT EXISTS lead_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
    score INTEGER DEFAULT 0,
    score_label VARCHAR(10) DEFAULT 'cold',
    score_response_time INTEGER DEFAULT 0,
    score_engagement INTEGER DEFAULT 0,
    score_profile INTEGER DEFAULT 0,
    score_value INTEGER DEFAULT 0,
    score_funnel INTEGER DEFAULT 0,
    score_recency INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    avg_response_time_minutes INTEGER,
    last_contact_response_at TIMESTAMP WITH TIME ZONE,
    profile_fields_filled INTEGER DEFAULT 0,
    profile_fields_total INTEGER DEFAULT 10,
    funnel_stages_completed INTEGER DEFAULT 0,
    funnel_stages_total INTEGER DEFAULT 1,
    ai_summary TEXT,
    ai_recommended_action TEXT,
    ai_analyzed_at TIMESTAMP WITH TIME ZONE,
    previous_score INTEGER,
    score_trend VARCHAR(10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(deal_id)
);

-- Lead score history
CREATE TABLE IF NOT EXISTS lead_score_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    score_label VARCHAR(10),
    trigger_event VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lead_scores_org ON lead_scores(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_deal ON lead_scores(deal_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_score ON lead_scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_lead_scores_label ON lead_scores(score_label);
CREATE INDEX IF NOT EXISTS idx_lead_score_history_deal ON lead_score_history(deal_id);

-- Add columns to crm_deals
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_deals' AND column_name = 'lead_score') THEN
        ALTER TABLE crm_deals ADD COLUMN lead_score INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_deals' AND column_name = 'lead_score_label') THEN
        ALTER TABLE crm_deals ADD COLUMN lead_score_label VARCHAR(10) DEFAULT 'cold';
    END IF;
END $$;
`;

// Step 29: Conversation Summaries
const step29ConversationSummaries = `
-- Conversation summaries (AI-generated)
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    key_points JSONB DEFAULT '[]',
    customer_sentiment VARCHAR(20),
    topics JSONB DEFAULT '[]',
    action_items JSONB DEFAULT '[]',
    resolution_status VARCHAR(20),
    messages_analyzed INTEGER DEFAULT 0,
    generated_by VARCHAR(50),
    ai_provider VARCHAR(20),
    ai_model VARCHAR(50),
    processing_time_ms INTEGER,
    triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(conversation_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conv_summaries_org ON conversation_summaries(organization_id);
CREATE INDEX IF NOT EXISTS idx_conv_summaries_conv ON conversation_summaries(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_summaries_sentiment ON conversation_summaries(customer_sentiment);

-- Add columns to conversations
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'ai_summary') THEN
        ALTER TABLE conversations ADD COLUMN ai_summary TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'ai_sentiment') THEN
        ALTER TABLE conversations ADD COLUMN ai_sentiment VARCHAR(20);
    END IF;
END $$;
`;

// Step 30: Nurturing Sequences
const step30NurturingSequences = `
-- Nurturing sequences
CREATE TABLE IF NOT EXISTS nurturing_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    trigger_type VARCHAR(50) NOT NULL DEFAULT 'manual',
    trigger_config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    pause_on_reply BOOLEAN DEFAULT true,
    pause_on_deal_won BOOLEAN DEFAULT true,
    exit_on_reply BOOLEAN DEFAULT false,
    contacts_enrolled INTEGER DEFAULT 0,
    contacts_completed INTEGER DEFAULT 0,
    contacts_converted INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sequence steps
CREATE TABLE IF NOT EXISTS nurturing_sequence_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID NOT NULL REFERENCES nurturing_sequences(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL DEFAULT 1,
    delay_value INTEGER NOT NULL DEFAULT 1,
    delay_unit VARCHAR(20) NOT NULL DEFAULT 'days',
    channel VARCHAR(20) NOT NULL,
    whatsapp_content TEXT,
    whatsapp_media_url TEXT,
    whatsapp_media_type VARCHAR(50),
    email_subject VARCHAR(500),
    email_body TEXT,
    email_template_id UUID,
    conditions JSONB DEFAULT '{}',
    skip_if_replied BOOLEAN DEFAULT true,
    sent_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0,
    replied_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(sequence_id, step_order)
);

-- Enrollments
CREATE TABLE IF NOT EXISTS nurturing_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID NOT NULL REFERENCES nurturing_sequences(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    contact_name VARCHAR(255),
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    deal_id UUID,
    current_step INTEGER DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    pause_reason VARCHAR(100),
    next_step_at TIMESTAMP WITH TIME ZONE,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    paused_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    variables JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step logs
CREATE TABLE IF NOT EXISTS nurturing_step_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID NOT NULL REFERENCES nurturing_enrollments(id) ON DELETE CASCADE,
    step_id UUID NOT NULL REFERENCES nurturing_sequence_steps(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL,
    status VARCHAR(30) NOT NULL,
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    replied_at TIMESTAMP WITH TIME ZONE,
    message_id VARCHAR(255),
    email_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sequences_org ON nurturing_sequences(organization_id);
CREATE INDEX IF NOT EXISTS idx_steps_sequence ON nurturing_sequence_steps(sequence_id, step_order);
CREATE INDEX IF NOT EXISTS idx_enrollments_sequence ON nurturing_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON nurturing_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_enrollments_next ON nurturing_enrollments(next_step_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_enrollments_phone ON nurturing_enrollments(contact_phone);
CREATE INDEX IF NOT EXISTS idx_step_logs_enrollment ON nurturing_step_logs(enrollment_id);

-- Add has_nurturing to plans
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'has_nurturing') THEN
        ALTER TABLE plans ADD COLUMN has_nurturing BOOLEAN DEFAULT false;
    END IF;
END $$;
`;

// Step 31: CTWA Analytics
const step31CTWAAnalytics = `
-- CTWA Campaigns
CREATE TABLE IF NOT EXISTS ctwa_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL DEFAULT 'meta',
    campaign_id VARCHAR(255),
    ad_set_id VARCHAR(255),
    ad_id VARCHAR(255),
    utm_source VARCHAR(255),
    utm_medium VARCHAR(255),
    utm_campaign VARCHAR(255),
    utm_content VARCHAR(255),
    utm_term VARCHAR(255),
    tracking_code VARCHAR(50),
    total_spend DECIMAL(12,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'BRL',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CTWA Leads
CREATE TABLE IF NOT EXISTS ctwa_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES ctwa_campaigns(id) ON DELETE SET NULL,
    phone VARCHAR(50) NOT NULL,
    contact_name VARCHAR(255),
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    deal_id UUID,
    source_platform VARCHAR(50),
    referrer_url TEXT,
    landing_page TEXT,
    utm_source VARCHAR(255),
    utm_medium VARCHAR(255),
    utm_campaign VARCHAR(255),
    utm_content VARCHAR(255),
    utm_term VARCHAR(255),
    tracking_code VARCHAR(50),
    entry_message TEXT,
    status VARCHAR(30) DEFAULT 'new',
    converted_at TIMESTAMP WITH TIME ZONE,
    conversion_value DECIMAL(12,2),
    first_response_at TIMESTAMP WITH TIME ZONE,
    response_time_seconds INTEGER,
    assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CTWA Events
CREATE TABLE IF NOT EXISTS ctwa_lead_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES ctwa_leads(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ctwa_campaigns_org ON ctwa_campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_ctwa_campaigns_tracking ON ctwa_campaigns(tracking_code);
CREATE INDEX IF NOT EXISTS idx_ctwa_leads_org ON ctwa_leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_ctwa_leads_campaign ON ctwa_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ctwa_leads_phone ON ctwa_leads(phone);
CREATE INDEX IF NOT EXISTS idx_ctwa_leads_status ON ctwa_leads(status);
CREATE INDEX IF NOT EXISTS idx_ctwa_leads_created ON ctwa_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_ctwa_events_lead ON ctwa_lead_events(lead_id);
`;

// ============================================
// STEP 32: GROUP SECRETARY (AI Secretary for Groups)
// ============================================
const step32GroupSecretary = `
-- Group Secretary Configuration
CREATE TABLE IF NOT EXISTS group_secretary_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    connection_ids UUID[] DEFAULT NULL,
    group_jids TEXT[] DEFAULT NULL,
    ai_provider VARCHAR(20),
    ai_model VARCHAR(100),
    ai_api_key TEXT,
    create_crm_task BOOLEAN DEFAULT true,
    show_popup_alert BOOLEAN DEFAULT true,
    min_confidence DECIMAL(3,2) DEFAULT 0.6,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id)
);

-- Group Secretary Member Aliases
CREATE TABLE IF NOT EXISTS group_secretary_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    role_description TEXT,
    departments TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- Group Secretary Detection Logs
CREATE TABLE IF NOT EXISTS group_secretary_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    message_content TEXT,
    sender_name TEXT,
    detected_request TEXT,
    matched_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    matched_user_name TEXT,
    confidence DECIMAL(3,2),
    crm_task_id UUID REFERENCES crm_tasks(id) ON DELETE SET NULL,
    alert_id UUID REFERENCES user_alerts(id) ON DELETE SET NULL,
    ai_provider VARCHAR(20),
    ai_model VARCHAR(50),
    processing_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_secretary_config_org ON group_secretary_config(organization_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_members_org ON group_secretary_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_members_user ON group_secretary_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_logs_org ON group_secretary_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_logs_conv ON group_secretary_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_logs_matched ON group_secretary_logs(matched_user_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_logs_created ON group_secretary_logs(created_at);

-- Add new columns for member/external notifications and advanced features
DO $$ BEGIN
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS notify_external_enabled BOOLEAN DEFAULT false;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS notify_external_phone VARCHAR(50);
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS notify_members_whatsapp BOOLEAN DEFAULT false;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS default_connection_id UUID;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS followup_enabled BOOLEAN DEFAULT false;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS followup_hours INTEGER DEFAULT 4;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS daily_digest_enabled BOOLEAN DEFAULT false;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS daily_digest_hour INTEGER DEFAULT 8;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS daily_digest_minute INTEGER DEFAULT 0;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS individual_notifications_enabled BOOLEAN DEFAULT true;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN DEFAULT false;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS auto_reply_message TEXT;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS excluded_senders TEXT[] DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Add new columns to logs for priority, sentiment, deadline
DO $$ BEGIN
    ALTER TABLE group_secretary_logs ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
    ALTER TABLE group_secretary_logs ADD COLUMN IF NOT EXISTS deadline TIMESTAMP WITH TIME ZONE;
    ALTER TABLE group_secretary_logs ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20) DEFAULT 'neutral';
    ALTER TABLE group_secretary_logs ADD COLUMN IF NOT EXISTS matched_users_count INTEGER DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Add source and followup columns to crm_tasks
DO $$ BEGIN
    ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS source VARCHAR(50);
    ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS followup_sent_at TIMESTAMP WITH TIME ZONE;
EXCEPTION WHEN duplicate_column THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_source ON crm_tasks(source);

-- Meeting Minutes (Atas de Reunião)
CREATE TABLE IF NOT EXISTS group_secretary_meeting_minutes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    group_name TEXT,
    title TEXT NOT NULL,
    summary TEXT,
    decisions JSONB DEFAULT '[]',
    action_items JSONB DEFAULT '[]',
    participants TEXT[] DEFAULT '{}',
    message_count INTEGER DEFAULT 0,
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    ai_provider VARCHAR(20),
    ai_model VARCHAR(100),
    generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_minutes_org ON group_secretary_meeting_minutes(organization_id);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_conv ON group_secretary_meeting_minutes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_created ON group_secretary_meeting_minutes(created_at);
`;

// Step 33: Ghost Audit Logs
const step33GhostAudit = `
CREATE TABLE IF NOT EXISTS ghost_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    days_analyzed INTEGER NOT NULL,
    conversations_analyzed INTEGER DEFAULT 0,
    insights_count INTEGER DEFAULT 0,
    categories_summary JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghost_audit_org ON ghost_audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_ghost_audit_created ON ghost_audit_logs(created_at);
`;

// Step 34: Ghost Saved Analyses
const step34GhostSavedAnalyses = `
CREATE TABLE IF NOT EXISTS ghost_saved_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    label VARCHAR(500) NOT NULL,
    data JSONB NOT NULL,
    days INTEGER NOT NULL DEFAULT 7,
    connection_id UUID,
    connection_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghost_saved_org ON ghost_saved_analyses(organization_id);
CREATE INDEX IF NOT EXISTS idx_ghost_saved_created ON ghost_saved_analyses(created_at);
`;

// Step 35: Group Funnels (link groups to specific funnels)
const step35GroupFunnels = `
CREATE TABLE IF NOT EXISTS crm_group_funnels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES crm_user_groups(id) ON DELETE CASCADE NOT NULL,
    funnel_id UUID REFERENCES crm_funnels(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(group_id, funnel_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_group_funnels_group ON crm_group_funnels(group_id);
CREATE INDEX IF NOT EXISTS idx_crm_group_funnels_funnel ON crm_group_funnels(funnel_id);
`;

// Step 36: Projects Module
const step36Projects = `
CREATE TABLE IF NOT EXISTS project_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    position INTEGER DEFAULT 0,
    color VARCHAR(50) DEFAULT '#6366f1',
    is_final BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_stages_org ON project_stages(organization_id);

CREATE TABLE IF NOT EXISTS project_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_templates_org ON project_templates(organization_id);

CREATE TABLE IF NOT EXISTS project_template_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES project_templates(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    position INTEGER DEFAULT 0,
    duration_days INTEGER DEFAULT 1,
    depends_on_position INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_template_tasks_tpl ON project_template_tasks(template_id);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    deal_id UUID,
    stage_id UUID REFERENCES project_stages(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    priority VARCHAR(20) DEFAULT 'medium',
    due_date TIMESTAMP WITH TIME ZONE,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_deal ON projects(deal_id);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage_id);

CREATE TABLE IF NOT EXISTS project_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255),
    url TEXT NOT NULL,
    mimetype VARCHAR(100),
    size INTEGER,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_attachments_proj ON project_attachments(project_id);

CREATE TABLE IF NOT EXISTS project_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    parent_id UUID REFERENCES project_notes(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_notes_proj ON project_notes(project_id);

CREATE TABLE IF NOT EXISTS project_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    position INTEGER DEFAULT 0,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    duration_days INTEGER DEFAULT 1,
    depends_on UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_proj ON project_tasks(project_id);

CREATE TABLE IF NOT EXISTS project_note_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    project_id UUID NOT NULL,
    note_id UUID NOT NULL,
    project_title TEXT,
    sender_name TEXT,
    content_preview TEXT,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_note_notifs_user ON project_note_notifications(user_id, read);
`;

// Step 37: Permission Templates
const step37PermissionTemplates = `
CREATE TABLE IF NOT EXISTS permission_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(20) DEFAULT '#6366f1',
  permissions JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_permission_templates_org ON permission_templates(organization_id);
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS permission_template_id UUID REFERENCES permission_templates(id) ON DELETE SET NULL;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
`;

// Step 38: Push Notifications
const step38PushNotifications = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_org ON push_subscriptions(organization_id);

CREATE TABLE IF NOT EXISTS push_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB,
  status TEXT DEFAULT 'sent',
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_log_user ON push_notification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_push_log_created ON push_notification_log(created_at DESC);
`;


// ============================================
// STEP 39: GLOBAL AI AGENTS
// ============================================
const step39GlobalAgents = `
CREATE TABLE IF NOT EXISTS global_ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  avatar_url TEXT,
  ai_provider VARCHAR(20) NOT NULL DEFAULT 'openai',
  ai_model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
  ai_api_key TEXT,
  system_prompt TEXT NOT NULL DEFAULT 'Você é um assistente virtual profissional.',
  temperature NUMERIC(3,2) DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 1000,
  context_window INTEGER DEFAULT 20,
  custom_fields JSONB DEFAULT '[]'::jsonb,
  capabilities TEXT[] DEFAULT ARRAY['respond_messages']::TEXT[],
  handoff_message TEXT DEFAULT 'Vou transferir você para um atendente humano. Aguarde um momento.',
  handoff_keywords TEXT[] DEFAULT ARRAY['humano', 'atendente', 'pessoa']::TEXT[],
  fallback_message TEXT DEFAULT 'Desculpe, não consegui entender. Pode reformular sua pergunta?',
  greeting_message TEXT,
  has_knowledge_base BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_agent_org_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_agent_id UUID NOT NULL REFERENCES global_ai_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(global_agent_id, organization_id)
);

CREATE TABLE IF NOT EXISTS global_agent_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_agent_id UUID NOT NULL REFERENCES global_ai_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  custom_field_values JSONB DEFAULT '{}'::jsonb,
  prompt_additions TEXT,
  client_ai_api_key TEXT,
  schedule_windows JSONB DEFAULT '[]'::jsonb,
  schedule_mode VARCHAR(20) DEFAULT 'manual',
  activated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(global_agent_id, connection_id)
);

CREATE TABLE IF NOT EXISTS global_agent_knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_agent_id UUID NOT NULL REFERENCES global_ai_agents(id) ON DELETE CASCADE,
  source_type VARCHAR(20) NOT NULL DEFAULT 'text',
  name VARCHAR(255) NOT NULL,
  description TEXT,
  source_content TEXT NOT NULL,
  file_type VARCHAR(50),
  file_size INTEGER,
  original_filename VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  chunk_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_agent_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES global_agent_knowledge_sources(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}',
  embedding JSONB,
  token_count INTEGER,
  char_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_agent_org_assignments_org ON global_agent_org_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_global_agent_org_assignments_agent ON global_agent_org_assignments(global_agent_id);
CREATE INDEX IF NOT EXISTS idx_global_agent_activations_org ON global_agent_activations(organization_id);
CREATE INDEX IF NOT EXISTS idx_global_agent_activations_conn ON global_agent_activations(connection_id);
CREATE INDEX IF NOT EXISTS idx_global_agent_activations_active ON global_agent_activations(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_global_agent_knowledge_sources_agent ON global_agent_knowledge_sources(global_agent_id);
CREATE INDEX IF NOT EXISTS idx_global_agent_knowledge_chunks_source ON global_agent_knowledge_chunks(source_id);

DO $$ BEGIN ALTER TABLE global_ai_agents ADD COLUMN IF NOT EXISTS fallback_message TEXT DEFAULT 'Desculpe, não consegui entender.'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE global_ai_agents ADD COLUMN IF NOT EXISTS has_knowledge_base BOOLEAN DEFAULT false; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE global_agent_activations ADD COLUMN IF NOT EXISTS client_ai_api_key TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE global_ai_agents ADD COLUMN IF NOT EXISTS appbarber_api_key TEXT; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE global_ai_agents ADD COLUMN IF NOT EXISTS appbarber_establishment_code VARCHAR(50); EXCEPTION WHEN others THEN NULL; END $$;
`;

// ============================================
// STEP 40: LEAD WEBHOOKS
// ============================================
const step40LeadWebhooks = `
CREATE TABLE IF NOT EXISTS lead_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    webhook_token VARCHAR(64) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,
    funnel_id UUID REFERENCES crm_funnels(id) ON DELETE SET NULL,
    stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    distribution_enabled BOOLEAN DEFAULT false,
    distribution_last_index INTEGER DEFAULT 0,
    field_mapping JSONB DEFAULT '{}',
    default_value DECIMAL(15,2) DEFAULT 0,
    default_probability INTEGER DEFAULT 10,
    total_leads INTEGER DEFAULT 0,
    last_lead_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_webhook_distribution (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES lead_webhooks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    max_leads_per_day INTEGER DEFAULT NULL,
    leads_today INTEGER DEFAULT 0,
    last_lead_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(webhook_id, user_id)
);

CREATE TABLE IF NOT EXISTS lead_webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES lead_webhooks(id) ON DELETE CASCADE,
    request_body JSONB,
    response_status INTEGER,
    response_message TEXT,
    deal_id UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
    prospect_id UUID REFERENCES crm_prospects(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    source_ip VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_webhooks_org ON lead_webhooks(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_webhooks_token ON lead_webhooks(webhook_token);
CREATE INDEX IF NOT EXISTS idx_lead_webhook_distribution_webhook ON lead_webhook_distribution(webhook_id);
CREATE INDEX IF NOT EXISTS idx_lead_webhook_logs_webhook ON lead_webhook_logs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_lead_webhook_logs_created ON lead_webhook_logs(created_at DESC);
`;

const step41MetaTemplates = `
CREATE TABLE IF NOT EXISTS meta_message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    meta_template_id VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    language VARCHAR(20) DEFAULT 'pt_BR',
    category VARCHAR(50) DEFAULT 'UTILITY',
    status VARCHAR(50) DEFAULT 'PENDING',
    components JSONB DEFAULT '[]'::jsonb,
    synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_templates_conn_tid 
  ON meta_message_templates(connection_id, meta_template_id);
CREATE INDEX IF NOT EXISTS idx_meta_templates_connection 
  ON meta_message_templates(connection_id);
CREATE INDEX IF NOT EXISTS idx_meta_templates_org 
  ON meta_message_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_meta_templates_status 
  ON meta_message_templates(status);
`;

const step42SalesSEO = `
CREATE TABLE IF NOT EXISTS sales_seo_trackers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phrase TEXT NOT NULL,
    connection_ids UUID[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_seo_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    tracker_id UUID REFERENCES sales_seo_trackers(id) ON DELETE SET NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    entry_message TEXT,
    evolution_status INTEGER DEFAULT 1, -- 1: just_arrived, 2: engaged, 3: converted, 4: lost
    ia_analysis JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_seo_trackers_org ON sales_seo_trackers(organization_id);
CREATE INDEX IF NOT EXISTS idx_sales_seo_leads_org ON sales_seo_leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_sales_seo_leads_tracker ON sales_seo_leads(tracker_id);
CREATE INDEX IF NOT EXISTS idx_sales_seo_leads_created ON sales_seo_leads(created_at DESC);
`;

const migrationSteps = [
  { name: 'Enums', sql: step1Enums, critical: true },
  { name: 'Core Tables (users, plans)', sql: step2CoreTables, critical: true },
  { name: 'Organizations', sql: step3Organizations, critical: true },
  { name: 'User Relations', sql: step4UserRelations, critical: true },
  { name: 'Connections', sql: step5Connections, critical: true },
  { name: 'Contacts & Messages', sql: step6ContactsMessages, critical: false },
  { name: 'Campaigns', sql: step7Campaigns, critical: false },
  { name: 'Asaas Integration', sql: step8Asaas, critical: false },
  { name: 'Chat System', sql: step9Chat, critical: false },
  { name: 'System Settings', sql: step10Settings, critical: false },
  { name: 'Indexes', sql: step11Indexes, critical: false },
  { name: 'Attendance Status', sql: step12Attendance, critical: false },
  { name: 'Departments / Queues', sql: step17Departments, critical: false },
  { name: 'Departments Conversations Link', sql: step17bDepartmentConversations, critical: false },
  { name: 'Chatbots System', sql: step13Chatbots, critical: false },
  { name: 'Chatbot Permissions', sql: step14ChatbotPermissions, critical: false },
  { name: 'Chatbot Team & Keywords', sql: step15ChatbotTeamKeywords, critical: false },
  { name: 'Independent Flows', sql: step16IndependentFlows, critical: false },
  { name: 'CRM System', sql: step18CRM, critical: false },
  { name: 'CRM Config', sql: step19CRMConfig, critical: false },
  { name: 'CRM Migrations', sql: step20CRMMigrations, critical: false },
  { name: 'CRM Prospects', sql: step21Prospects, critical: false },
  { name: 'CRM Automation', sql: step22CRMAutomation, critical: false },
  { name: 'Email System', sql: step23Email, critical: false },
  { name: 'Google Calendar', sql: step24GoogleCalendar, critical: false },
  { name: 'AI Agents', sql: step25AIAgents, critical: false },
  { name: 'External Forms', sql: step26ExternalForms, critical: false },
  { name: 'Lead Distribution', sql: step27LeadDistribution, critical: false },
  { name: 'Lead Scoring', sql: step28LeadScoring, critical: false },
  { name: 'Conversation Summaries', sql: step29ConversationSummaries, critical: false },
  { name: 'Nurturing Sequences', sql: step30NurturingSequences, critical: false },
  { name: 'CTWA Analytics', sql: step31CTWAAnalytics, critical: false },
  { name: 'Group Secretary', sql: step32GroupSecretary, critical: false },
  { name: 'Ghost Audit Logs', sql: step33GhostAudit, critical: false },
  { name: 'Ghost Saved Analyses', sql: step34GhostSavedAnalyses, critical: false },
  { name: 'Group Funnels', sql: step35GroupFunnels, critical: false },
  { name: 'Projects Module', sql: step36Projects, critical: false },
  { name: 'Permission Templates', sql: step37PermissionTemplates, critical: false },
  { name: 'Push Notifications', sql: step38PushNotifications, critical: false },
  { name: 'Global AI Agents', sql: step39GlobalAgents, critical: false },
  { name: 'Lead Webhooks', sql: step40LeadWebhooks, critical: false },
  { name: 'Meta Message Templates', sql: step41MetaTemplates, critical: false },
  { name: 'Sales & SEO Module', sql: step42SalesSEO, critical: false },
  { name: 'Meta SaaS + Lead Ads', sql: `
    CREATE TABLE IF NOT EXISTS meta_oauth_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('facebook','instagram','whatsapp')),
      fb_user_id TEXT,
      access_token TEXT NOT NULL,
      token_expires_at TIMESTAMPTZ,
      scopes TEXT[] DEFAULT '{}',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS meta_pages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      oauth_connection_id UUID REFERENCES meta_oauth_connections(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('facebook_page','instagram_account','whatsapp_number')),
      external_id TEXT NOT NULL,
      external_name TEXT,
      page_access_token TEXT,
      waba_id TEXT,
      phone_number TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, kind, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_meta_pages_external ON meta_pages (kind, external_id);

    CREATE TABLE IF NOT EXISTS meta_lead_forms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      meta_page_id UUID NOT NULL REFERENCES meta_pages(id) ON DELETE CASCADE,
      form_id TEXT NOT NULL,
      form_name TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      funnel_id UUID,
      stage_id UUID,
      assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      distribution_rule_id UUID,
      trigger_flow_id UUID,
      connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
      open_chat BOOLEAN NOT NULL DEFAULT false,
      field_mapping JSONB NOT NULL DEFAULT '{}',
      default_tags TEXT[] NOT NULL DEFAULT '{}',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (meta_page_id, form_id)
    );

    CREATE TABLE IF NOT EXISTS meta_lead_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      meta_lead_form_id UUID REFERENCES meta_lead_forms(id) ON DELETE SET NULL,
      leadgen_id TEXT NOT NULL UNIQUE,
      ad_id TEXT, adset_id TEXT, campaign_id TEXT,
      raw_payload JSONB NOT NULL DEFAULT '{}',
      prospect_id UUID REFERENCES crm_prospects(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'received',
      error TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_meta_lead_events_org_received ON meta_lead_events (organization_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_meta_lead_events_status ON meta_lead_events (status);
  `, critical: false },
  { name: 'Wait Reply Flow Sessions', sql: `
    ALTER TABLE flow_sessions ADD COLUMN IF NOT EXISTS wait_reply_expires_at TIMESTAMPTZ DEFAULT NULL;
    ALTER TABLE flow_sessions ADD COLUMN IF NOT EXISTS wait_reply_variable TEXT DEFAULT NULL;
    CREATE INDEX IF NOT EXISTS idx_flow_sessions_wait_reply ON flow_sessions (wait_reply_expires_at) WHERE is_active = true AND wait_reply_expires_at IS NOT NULL;
  `, critical: false },
  { name: 'Access Groups', sql: `
    CREATE TABLE IF NOT EXISTS access_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS access_group_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        access_group_id UUID REFERENCES access_groups(id) ON DELETE CASCADE NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (access_group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS access_group_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        access_group_id UUID REFERENCES access_groups(id) ON DELETE CASCADE NOT NULL,
        connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE (access_group_id, connection_id)
    );
  `, critical: false },
];


export async function initDatabase() {
  console.log('🔄 Initializing database in steps...');
  
  let successCount = 0;
  let failedSteps = [];
  let criticalFailure = false;

  for (const step of migrationSteps) {
    try {
      console.log(`  → Step: ${step.name}...`);
      await pool.query(step.sql);
      console.log(`  ✅ ${step.name} - OK`);
      successCount++;
    } catch (error) {
      console.error(`  ❌ ${step.name} - FAILED: ${error.message}`);
      failedSteps.push({ name: step.name, error: error.message });
      
      if (step.critical) {
        criticalFailure = true;
        console.error(`  🛑 Critical step failed, stopping initialization`);
        break;
      }
      // Non-critical steps: continue to next step
    }
  }

  console.log('');
  console.log('📊 Database initialization summary:');
  console.log(`   - Steps completed: ${successCount}/${migrationSteps.length}`);
  
  if (failedSteps.length > 0) {
    console.log(`   - Failed steps: ${failedSteps.map(s => s.name).join(', ')}`);
  }
  
  if (criticalFailure) {
    console.error('❌ Database initialization failed (critical step error)');
    return false;
  }
  
  if (failedSteps.length === 0) {
    console.log('✅ Database initialized successfully!');
  } else {
    console.log('⚠️ Database initialized with warnings (some non-critical steps failed)');
  }

  // Ensure all users have an organization (fix orphaned users)
  try {
    const orphans = await pool.query(
      `SELECT u.id, u.name, u.email FROM users u
       WHERE NOT EXISTS (
         SELECT 1 FROM organization_members om WHERE om.user_id = u.id
       )`
    );
    for (const user of orphans.rows) {
      const slug = (user.name || 'org').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        + '-' + Date.now().toString(36);
      const orgRes = await pool.query(
        `INSERT INTO organizations (name, slug, modules_enabled)
         VALUES ($1, $2, '{"campaigns":true,"billing":true,"groups":true,"scheduled_messages":true,"chatbots":true,"chat":true,"crm":true}'::jsonb)
         RETURNING id`,
        [user.name || 'Organização', slug]
      );
      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [orgRes.rows[0].id, user.id]
      );
      console.log(`  🏢 Created organization for orphaned user: ${user.email}`);
    }
  } catch (e) {
    console.error('  ⚠️ Failed to fix orphaned users:', e.message);
  }

  // ============================================================
  // AGENT MODES (Copilot + AutoReply) — self-healing
  // ============================================================
  try {
    await pool.query(`
      ALTER TABLE ai_agents
        ADD COLUMN IF NOT EXISTS agent_mode VARCHAR(20) DEFAULT 'standard'
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_agent_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
        name VARCHAR(80) NOT NULL,
        icon VARCHAR(40) DEFAULT 'Sparkles',
        prompt TEXT NOT NULL,
        order_index INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_agent ON ai_agent_actions(agent_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_agent_autoreply_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL UNIQUE REFERENCES ai_agents(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT false,
        paused_until TIMESTAMPTZ,
        filter_mode VARCHAR(20) DEFAULT 'all',
        included_tags TEXT[] DEFAULT '{}',
        excluded_tags TEXT[] DEFAULT '{}',
        included_contact_ids UUID[] DEFAULT '{}',
        excluded_contact_ids UUID[] DEFAULT '{}',
        included_groups TEXT[] DEFAULT '{}',
        excluded_groups TEXT[] DEFAULT '{}',
        schedule_enabled BOOLEAN DEFAULT false,
        schedule_windows JSONB DEFAULT '[]'::jsonb,
        response_template TEXT,
        max_responses_per_contact INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_agent_autoreply_org ON ai_agent_autoreply_config(organization_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_agent_autoreply_active ON ai_agent_autoreply_config(is_active) WHERE is_active = true`);

    // Self-healing: connection scoping for auto-reply (multi-instance support)
    await pool.query(`ALTER TABLE ai_agent_autoreply_config ADD COLUMN IF NOT EXISTS connection_ids UUID[] DEFAULT '{}'`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_agent_autoreply_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
        conversation_id UUID,
        contact_id UUID,
        message_sent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_autoreply_log_contact ON ai_agent_autoreply_log(contact_id, agent_id)`);

    // Self-healing seed: para cada ai_agent com agent_mode='autoreply' que NÃO tem
    // linha em ai_agent_autoreply_config, cria uma linha padrão ativa (filter_mode='all',
    // connection_ids vazio = todas as conexões da org). Isso evita o cenário em que o
    // usuário ativa o modo no agente mas o webhook não encontra config e ignora.
    try {
      const seed = await pool.query(`
        INSERT INTO ai_agent_autoreply_config (agent_id, organization_id, is_active, filter_mode, connection_ids)
        SELECT a.id, a.organization_id, COALESCE(a.is_active, true), 'all', '{}'::uuid[]
          FROM ai_agents a
          LEFT JOIN ai_agent_autoreply_config c ON c.agent_id = a.id
         WHERE a.agent_mode = 'autoreply'
           AND a.organization_id IS NOT NULL
           AND c.id IS NULL
        ON CONFLICT (agent_id) DO NOTHING
        RETURNING agent_id
      `);
      if (seed.rowCount > 0) {
        console.log(`  🌱 Seeded ${seed.rowCount} default autoreply config row(s) for existing agents`);
      }
    } catch (seedErr) {
      console.error('  ⚠️ Failed autoreply seed:', seedErr.message);
    }

    console.log('  ✅ Agent Modes (Copilot/AutoReply) schema ready');
  } catch (e) {
    console.error('  ⚠️ Failed agent-modes schema:', e.message);
  }

  // ============================================================
  // CRM Lead Sources (origens de negociação) — self-healing
  // ============================================================
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS crm_lead_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(120) NOT NULL,
        color VARCHAR(20) DEFAULT '#6366f1',
        is_active BOOLEAN DEFAULT true,
        position INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(organization_id, name)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_crm_lead_sources_org ON crm_lead_sources(organization_id)`);
    await pool.query(`ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS lead_source_id UUID REFERENCES crm_lead_sources(id) ON DELETE SET NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_crm_deals_lead_source ON crm_deals(lead_source_id)`);
    console.log('  ✅ CRM Lead Sources schema ready');
  } catch (e) {
    console.error('  ⚠️ Failed crm_lead_sources schema:', e.message);
  }

  // ============================================================
  // Meta SaaS — OAuth centralizado (App único Gleego) — self-healing
  // Roda em todo boot. Nunca derruba nada do fluxo Meta API antigo.
  // ============================================================
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meta_oauth_connections (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id   uuid NOT NULL,
        user_id           uuid NOT NULL,
        provider          text NOT NULL CHECK (provider IN ('facebook','instagram','whatsapp')),
        fb_user_id        text,
        access_token      text NOT NULL,
        token_expires_at  timestamptz,
        scopes            text[] DEFAULT '{}'::text[],
        metadata          jsonb  DEFAULT '{}'::jsonb,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meta_oauth_org      ON meta_oauth_connections(organization_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meta_oauth_user     ON meta_oauth_connections(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meta_oauth_provider ON meta_oauth_connections(provider)`);

    // Self-healing colunas (instalações antigas)
    await pool.query(`ALTER TABLE meta_oauth_connections ADD COLUMN IF NOT EXISTS scopes           text[] DEFAULT '{}'::text[]`);
    await pool.query(`ALTER TABLE meta_oauth_connections ADD COLUMN IF NOT EXISTS metadata         jsonb  DEFAULT '{}'::jsonb`);
    await pool.query(`ALTER TABLE meta_oauth_connections ADD COLUMN IF NOT EXISTS token_expires_at timestamptz`);
    await pool.query(`ALTER TABLE meta_oauth_connections ADD COLUMN IF NOT EXISTS fb_user_id       text`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meta_pages (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id     uuid NOT NULL,
        oauth_connection_id uuid REFERENCES meta_oauth_connections(id) ON DELETE CASCADE,
        kind                text NOT NULL CHECK (kind IN ('facebook_page','instagram_account','whatsapp_number')),
        external_id         text NOT NULL,
        external_name       text,
        page_access_token   text,
        waba_id             text,
        phone_number        text,
        status              text NOT NULL DEFAULT 'active',
        metadata            jsonb DEFAULT '{}'::jsonb,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Constraint única (idempotente)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_pages_org_kind_ext_uniq') THEN
          ALTER TABLE meta_pages
            ADD CONSTRAINT meta_pages_org_kind_ext_uniq UNIQUE (organization_id, kind, external_id);
        END IF;
      END $$;
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meta_pages_org    ON meta_pages(organization_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meta_pages_conn   ON meta_pages(oauth_connection_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meta_pages_kind   ON meta_pages(kind)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meta_pages_extid  ON meta_pages(external_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meta_pages_status ON meta_pages(status)`);

    await pool.query(`ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS page_access_token text`);
    await pool.query(`ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS waba_id           text`);
    await pool.query(`ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS phone_number      text`);
    await pool.query(`ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS metadata          jsonb DEFAULT '{}'::jsonb`);
    await pool.query(`ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS status            text  DEFAULT 'active'`);

    // Trigger updated_at
    await pool.query(`
      CREATE OR REPLACE FUNCTION meta_set_updated_at() RETURNS trigger AS $func$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql;
    `);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_meta_oauth_updated_at') THEN
          CREATE TRIGGER trg_meta_oauth_updated_at
            BEFORE UPDATE ON meta_oauth_connections
            FOR EACH ROW EXECUTE FUNCTION meta_set_updated_at();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_meta_pages_updated_at') THEN
          CREATE TRIGGER trg_meta_pages_updated_at
            BEFORE UPDATE ON meta_pages
            FOR EACH ROW EXECUTE FUNCTION meta_set_updated_at();
        END IF;
      END $$;
    `);

    console.log('  ✅ Meta SaaS (OAuth centralizado) schema ready');
  } catch (e) {
    console.error('  ⚠️ Failed meta-saas schema:', e.message);
  }

  return true;
}
