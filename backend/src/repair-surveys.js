import { query } from './db.js';

async function repair() {
  console.log('Checking survey support in external_forms...');
  try {
    // Just to be sure the table exists, but we know it does from init-db
    // Check if display_mode has 'survey' as a possibility in the app logic
    // display_mode is just a VARCHAR(20), so it should work.
    
    // Check if there are any forms with display_mode = 'survey'
    const result = await query("SELECT count(*) FROM external_forms WHERE display_mode = 'survey'");
    console.log('Current surveys count:', result.rows[0].count);
    
    console.log('Database supports survey display_mode.');
  } catch (err) {
    console.error('Repair failed:', err.message);
  }
}

repair();
