import { query } from './db.js';

async function fixCampaignMessages() {
  console.log('--- Database Fix: campaign_messages Resiliency ---');
  try {
    // 1. Check if the table exists (should exist)
    await query("SELECT 'campaign_messages'::regclass");
    
    // 2. Add 'processing' and 'cancelled' to the status column if it's text,
    // or if it's an enum, we'll have to handle it differently.
    // In this project, status columns are typically TEXT for flexibility.
    
    // Check if column status exists and its type
    const colInfo = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'campaign_messages' 
        AND column_name = 'status'
    `);
    
    if (colInfo.rows.length === 0) {
      console.error('Column "status" not found in campaign_messages');
    } else {
      console.log(`Column "status" found with type ${colInfo.rows[0].data_type}`);
    }

    // 3. Add updated_at column for the locking mechanism
    console.log('Adding updated_at column if missing...');
    await query(`
      ALTER TABLE campaign_messages 
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);

    // 4. Create index on status + scheduled_at to speed up scheduler
    console.log('Creating indexes for performance...');
    await query(`
      CREATE INDEX IF NOT EXISTS idx_campaign_messages_status_scheduled 
      ON campaign_messages (status, scheduled_at)
    `);
    
    await query(`
      CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign_contact_sent 
      ON campaign_messages (campaign_id, contact_id, status) WHERE (status = 'sent')
    `);

    console.log('Fix applied successfully!');
  } catch (err) {
    console.error('Error applying fix:', err);
  } finally {
    process.exit(0);
  }
}

fixCampaignMessages();
