import { query } from './backend/src/db.js';

async function runFix() {
  console.log('--- DB SCHEMA REPAIR ---');
  const queries = [
    "ALTER TABLE connections ADD COLUMN IF NOT EXISTS organization_id UUID",
    "ALTER TABLE campaign_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
    "CREATE INDEX IF NOT EXISTS idx_connections_org ON connections(organization_id)",
    "CREATE INDEX IF NOT EXISTS idx_campaign_messages_status ON campaign_messages(status)"
  ];

  for (const q of queries) {
    try {
      console.log(`Executing: ${q}`);
      await query(q);
      console.log('Success.');
    } catch (e) {
      console.log(`Failed: ${e.message}`);
    }
  }
  console.log('--- REPAIR FINISHED ---');
  process.exit(0);
}

runFix();
