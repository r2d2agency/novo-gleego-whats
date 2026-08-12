import { query } from './db.js';

async function fixSchema() {
  console.log("Checking and fixing database schema for Supervisor IA...");
  try {
    // 1. Ensure crm_deals has monitoring columns
    console.log("Ensuring crm_deals has monitoring columns...");
    await query(`
      DO $$ BEGIN
          ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS last_seller_message_at TIMESTAMP WITH TIME ZONE;
          ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMP WITH TIME ZONE;
          ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS first_seller_message_at TIMESTAMP WITH TIME ZONE;
          ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS proposal_sent_at TIMESTAMP WITH TIME ZONE;
          ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS payment_pending_at TIMESTAMP WITH TIME ZONE;
          ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS next_followup_at TIMESTAMP WITH TIME ZONE;
      EXCEPTION WHEN others THEN RAISE NOTICE 'Error updating crm_deals: %', SQLERRM; END $$;
    `);

    // 2. Ensure conversations has monitoring columns and tags
    console.log("Ensuring conversations has monitoring columns and tags...");
    await query(`
      DO $$ BEGIN
          ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_seller_message_at TIMESTAMP WITH TIME ZONE;
          ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMP WITH TIME ZONE;
          ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
      EXCEPTION WHEN others THEN RAISE NOTICE 'Error updating conversations: %', SQLERRM; END $$;
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_conversations_tags ON conversations USING GIN(tags);`);

    // 3. Ensure users table has phone/whatsapp_phone
    console.log("Ensuring users table has phone columns...");
    await query(`
      DO $$ BEGIN
          ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(50);
          ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
      EXCEPTION WHEN others THEN RAISE NOTICE 'Error updating users: %', SQLERRM; END $$;
    `);

    // 4. Ensure supervisor tables exist
    console.log("Checking supervisor tables...");
    
    // supervisor_settings
    await query(`
      CREATE TABLE IF NOT EXISTS supervisor_settings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
          new_lead_sla_minutes INTEGER DEFAULT 30,
          no_followup_sla_hours INTEGER DEFAULT 24,
          no_response_sla_days INTEGER DEFAULT 2,
          reactivation_days INTEGER DEFAULT 30,
          proposal_sla_hours INTEGER DEFAULT 4,
          payment_sla_days INTEGER DEFAULT 3,
          monitored_funnels UUID[] DEFAULT '{}',
          monitored_tags TEXT[] DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(organization_id)
      );
    `);

    // supervisor_audits
    await query(`
      CREATE TABLE IF NOT EXISTS supervisor_audits (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
          deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE,
          conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
          owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
          analysis_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          status_found VARCHAR(50),
          reason TEXT,
          suggested_action TEXT,
          urgency VARCHAR(20),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // supervisor_charges
    await query(`
      CREATE TABLE IF NOT EXISTS supervisor_charges (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
          target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          target_team_id UUID REFERENCES crm_user_groups(id) ON DELETE CASCADE,
          charged_by UUID REFERENCES users(id) ON DELETE SET NULL,
          type VARCHAR(20) NOT NULL,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    console.log("✅ Schema migration complete.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

fixSchema();

