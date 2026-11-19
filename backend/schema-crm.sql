-- CRM Database Schema
-- Sistema de CRM com Kanban, Empresas, Contatos e Negociações

-- ============================================
-- GRUPOS DE USUÁRIOS (para permissões CRM)
-- ============================================

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

-- ============================================
-- FUNIS E ETAPAS
-- ============================================

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
    -- Regra de inatividade por etapa
    inactivity_hours INTEGER DEFAULT 24,
    inactivity_color VARCHAR(20) DEFAULT '#ef4444',
    is_final BOOLEAN DEFAULT false, -- Etapa final (ganhou/perdeu)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- EMPRESAS
-- ============================================

CREATE TABLE IF NOT EXISTS crm_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    razao_social VARCHAR(255),
    nome_fantasia VARCHAR(255),
    cnpj VARCHAR(20),
    inscricao_estadual VARCHAR(30),
    inscricao_municipal VARCHAR(30),
    porte VARCHAR(50),
    cnae VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(500),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    group_id UUID REFERENCES crm_user_groups(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- NEGOCIAÇÕES (DEALS)
-- ============================================

CREATE TABLE IF NOT EXISTS crm_deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    funnel_id UUID REFERENCES crm_funnels(id) ON DELETE CASCADE NOT NULL,
    stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    -- Ordering within a stage (Kanban drag & drop)
    position INTEGER NOT NULL DEFAULT 0,
    company_id UUID REFERENCES crm_companies(id) ON DELETE CASCADE NOT NULL,
    
    -- Responsável
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    group_id UUID REFERENCES crm_user_groups(id) ON DELETE SET NULL,
    
    -- Dados da negociação
    title VARCHAR(255) NOT NULL,
    value DECIMAL(15, 2) DEFAULT 0,
    probability INTEGER DEFAULT 50, -- % de fechamento
    expected_close_date DATE,
    
    -- Status
    status VARCHAR(20) DEFAULT 'open', -- open, won, lost
    won_at TIMESTAMP WITH TIME ZONE,
    lost_at TIMESTAMP WITH TIME ZONE,
    lost_reason TEXT,
    
    -- Tracking de atividade
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Dados extras
    description TEXT,
    tags TEXT[],
    custom_fields JSONB DEFAULT '{}',
    
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contatos vinculados à negociação
CREATE TABLE IF NOT EXISTS crm_deal_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    role VARCHAR(100), -- Ex: "Decisor", "Influenciador"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(deal_id, contact_id)
);

-- Histórico de movimentação da negociação
CREATE TABLE IF NOT EXISTS crm_deal_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- created, stage_changed, value_changed, etc
    from_value TEXT,
    to_value TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TAREFAS
-- ============================================

CREATE TABLE IF NOT EXISTS crm_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    
    -- Vínculo opcional com negociação
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE,
    company_id UUID REFERENCES crm_companies(id) ON DELETE CASCADE,
    
    -- Responsável
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Dados da tarefa
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) DEFAULT 'task', -- task, call, email, meeting, follow_up
    priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high, urgent
    
    -- Agendamento
    due_date TIMESTAMP WITH TIME ZONE,
    reminder_at TIMESTAMP WITH TIME ZONE,
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, cancelled
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- CATÁLOGO (PRODUTOS E SERVIÇOS)
-- ============================================

CREATE TABLE IF NOT EXISTS crm_catalog_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

CREATE TABLE IF NOT EXISTS crm_catalog_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES crm_catalog_categories(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'product',
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100),
    description TEXT,
    unit VARCHAR(50) DEFAULT 'un',
    recurrence VARCHAR(20) DEFAULT 'one_time',
    unit_price DECIMAL(15, 2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    external_id VARCHAR(255),
    external_source VARCHAR(100),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- ITENS DA NEGOCIAÇÃO
-- ============================================

CREATE TABLE IF NOT EXISTS crm_deal_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    catalog_item_id UUID REFERENCES crm_catalog_items(id) ON DELETE SET NULL,
    category_name VARCHAR(100),
    item_type VARCHAR(20) NOT NULL DEFAULT 'product',
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100),
    description TEXT,
    unit VARCHAR(50) DEFAULT 'un',
    recurrence VARCHAR(20) DEFAULT 'one_time',
    quantity DECIMAL(12, 2) DEFAULT 1,
    unit_price DECIMAL(15, 2) DEFAULT 0,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    external_id VARCHAR(255),
    external_source VARCHAR(100),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- PROPOSTAS
-- ============================================

CREATE TABLE IF NOT EXISTS crm_proposal_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    logo_url TEXT,
    header_text TEXT,
    description TEXT,
    footer_text TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id)
);

CREATE TABLE IF NOT EXISTS crm_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    number VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    template_logo_url TEXT,
    template_header_text TEXT,
    template_description TEXT,
    template_footer_text TEXT,
    customer_name VARCHAR(255),
    customer_document VARCHAR(50),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    notes TEXT,
    payment_terms TEXT,
    validity_days INTEGER DEFAULT 15,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    subtotal DECIMAL(15, 2) DEFAULT 0,
    discount_amount DECIMAL(15, 2) DEFAULT 0,
    total DECIMAL(15, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft',
    public_token VARCHAR(255) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    decided_at TIMESTAMP WITH TIME ZONE,
    decision_notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, number),
    UNIQUE(public_token)
);

CREATE TABLE IF NOT EXISTS crm_proposal_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID REFERENCES crm_proposals(id) ON DELETE CASCADE NOT NULL,
    deal_item_id UUID REFERENCES crm_deal_items(id) ON DELETE SET NULL,
    category_name VARCHAR(100),
    item_type VARCHAR(20) NOT NULL DEFAULT 'product',
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100),
    description TEXT,
    unit VARCHAR(50) DEFAULT 'un',
    recurrence VARCHAR(20) DEFAULT 'one_time',
    quantity DECIMAL(12, 2) DEFAULT 1,
    unit_price DECIMAL(15, 2) DEFAULT 0,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    total DECIMAL(15, 2) DEFAULT 0,
    position INTEGER DEFAULT 0
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_crm_catalog_categories_org ON crm_catalog_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_catalog_items_org ON crm_catalog_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_catalog_items_category ON crm_catalog_items(category_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_items_deal ON crm_deal_items(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_items_org ON crm_deal_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_proposals_deal ON crm_proposals(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_proposals_org ON crm_proposals(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_proposals_token ON crm_proposals(public_token);
CREATE INDEX IF NOT EXISTS idx_crm_proposal_items_proposal ON crm_proposal_items(proposal_id);

ALTER TABLE crm_proposals ADD COLUMN IF NOT EXISTS template_logo_url TEXT;
ALTER TABLE crm_proposals ADD COLUMN IF NOT EXISTS template_header_text TEXT;
ALTER TABLE crm_proposals ADD COLUMN IF NOT EXISTS template_description TEXT;
ALTER TABLE crm_proposals ADD COLUMN IF NOT EXISTS template_footer_text TEXT;
ALTER TABLE crm_proposals ADD COLUMN IF NOT EXISTS requires_signature BOOLEAN DEFAULT false;
ALTER TABLE crm_proposals ADD COLUMN IF NOT EXISTS signature_image TEXT;
ALTER TABLE crm_proposals ADD COLUMN IF NOT EXISTS signed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_crm_user_groups_org ON crm_user_groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_user_group_members_group ON crm_user_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_crm_user_group_members_user ON crm_user_group_members(user_id);

CREATE INDEX IF NOT EXISTS idx_crm_funnels_org ON crm_funnels(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_stages_funnel ON crm_stages(funnel_id);
CREATE INDEX IF NOT EXISTS idx_crm_stages_position ON crm_stages(funnel_id, position);

CREATE INDEX IF NOT EXISTS idx_crm_companies_org ON crm_companies(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_companies_name ON crm_companies(organization_id, name);
CREATE INDEX IF NOT EXISTS idx_crm_companies_owner ON crm_companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_companies_group ON crm_companies(group_id);

CREATE INDEX IF NOT EXISTS idx_crm_deals_org ON crm_deals(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_funnel ON crm_deals(funnel_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage_position ON crm_deals(organization_id, stage_id, position);
CREATE INDEX IF NOT EXISTS idx_crm_deals_company ON crm_deals(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_owner ON crm_deals(owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_group ON crm_deals(group_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_status ON crm_deals(status);
CREATE INDEX IF NOT EXISTS idx_crm_deals_activity ON crm_deals(last_activity_at);

CREATE INDEX IF NOT EXISTS idx_crm_deal_contacts_deal ON crm_deal_contacts(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_contacts_contact ON crm_deal_contacts(contact_id);

CREATE INDEX IF NOT EXISTS idx_crm_deal_history_deal ON crm_deal_history(deal_id);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_org ON crm_tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_deal ON crm_tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assigned ON crm_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_due ON crm_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_status ON crm_tasks(status);
