import { query } from './backend/src/db.js';

async function fix() {
  console.log('Fixing schema...');
  try {
    await query(`
      DO $$ BEGIN
        ALTER TABLE connections ADD COLUMN IF NOT EXISTS organization_id UUID;
        ALTER TABLE campaign_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
      EXCEPTION WHEN OTHERS THEN NULL; END $$;
    `);
    console.log('Schema fixed successfully.');
  } catch (e) {
    console.error('Error:', e);
  }
  process.exit();
}
fix();
