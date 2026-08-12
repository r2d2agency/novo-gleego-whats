import { query } from './db.js';

async function fixSchema() {
  console.log("Checking and fixing database schema for Supervisor IA...");
  try {
    // 1. Ensure supervisor_audits has conversation_id and nullable deal_id
    const checkAuditsTable = await query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supervisor_audits');
    `);
    
    if (checkAuditsTable.rows[0].exists) {
      console.log("Checking supervisor_audits columns...");
      const checkAuditCols = await query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'supervisor_audits' AND column_name IN ('conversation_id', 'organization_id');
      `);
      
      const cols = checkAuditCols.rows.map(r => r.column_name);
      
      if (!cols.includes('conversation_id')) {
        console.log("Adding conversation_id to supervisor_audits...");
        await query(`ALTER TABLE supervisor_audits ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;`);
        await query(`ALTER TABLE supervisor_audits ALTER COLUMN deal_id DROP NOT NULL;`);
      }
    }

    // 2. Ensure conversations table has tags
    console.log("Checking conversations columns...");
    const checkConvTags = await query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'conversations' AND column_name = 'tags';
    `);
    
    if (checkConvTags.rows.length === 0) {
      console.log("Adding tags to conversations...");
      await query(`ALTER TABLE conversations ADD COLUMN tags TEXT[] DEFAULT '{}';`);
      await query(`CREATE INDEX IF NOT EXISTS idx_conversations_tags ON conversations USING GIN(tags);`);
    }

    // 3. Ensure supervisor_charges has organization_id
    console.log("Checking supervisor_charges columns...");
    const checkChargeTable = await query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supervisor_charges');
    `);

    if (checkChargeTable.rows[0].exists) {
      console.log("Checking supervisor_charges columns...");
      const checkChargeCols = await query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'supervisor_charges' AND column_name = 'organization_id';
      `);
      
      if (checkChargeCols.rows.length === 0) {
        console.log("Adding organization_id to supervisor_charges...");
        // First add it as nullable to avoid errors with existing data
        await query(`ALTER TABLE supervisor_charges ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;`);
        
        // Try to backfill if possible from target_user_id
        await query(`
          UPDATE supervisor_charges c
          SET organization_id = u.organization_id
          FROM (SELECT user_id, organization_id FROM organization_members) u
          WHERE c.target_user_id = u.user_id AND c.organization_id IS NULL;
        `);
        
        console.log("Column organization_id added and backfilled.");
      } else {
        console.log("Column organization_id already exists in supervisor_charges.");
      }
    }

    console.log("✅ Schema migration complete.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

fixSchema();

