import { query } from './db.js';

async function fixSchema() {
  console.log("Checking and fixing supervisor_audits schema...");
  try {
    // 1. Check if supervisor_audits exists
    const checkTable = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'supervisor_audits'
      );
    `);
    
    if (!checkTable.rows[0].exists) {
      console.log("supervisor_audits table not found. It seems the database is not initialized.");
      return;
    }

    // 2. Check if conversation_id column exists
    const checkCol = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'supervisor_audits' AND column_name = 'conversation_id';
    `);

    if (checkCol.rows.length === 0) {
      console.log("Adding conversation_id to supervisor_audits...");
      await query(`
        ALTER TABLE supervisor_audits ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;
      `);
      await query(`
        ALTER TABLE supervisor_audits ALTER COLUMN deal_id DROP NOT NULL;
      `);
      console.log("Migration successful.");
    } else {
      console.log("Column conversation_id already exists.");
    }

    // 3. Ensure conversations table has tags
    const checkTags = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'conversations' AND column_name = 'tags';
    `);
    
    if (checkTags.rows.length === 0) {
      console.log("Adding tags to conversations...");
      await query(`
        ALTER TABLE conversations ADD COLUMN tags TEXT[] DEFAULT '{}';
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_conversations_tags ON conversations USING GIN(tags);
      `);
    }

  } catch (error) {
    console.error("Migration failed:", error);
  }
}

fixSchema();
