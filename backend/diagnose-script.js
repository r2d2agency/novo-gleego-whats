import 'dotenv/config';
import { query } from './src/db.js';

async function checkCampaigns() {
  console.log('--- Database Diagnostics ---');
  try {
    const serverTime = await query('SELECT NOW(), CURRENT_TIMESTAMP');
    console.log('Server Time (DB):', serverTime.rows[0]);

    const campaigns = await query(\`
      SELECT id, name, status, connection_id, scheduled_at, updated_at 
      FROM campaigns 
      WHERE status IN ('pending', 'running')
      ORDER BY updated_at DESC LIMIT 5
    \`);
    console.log('Campaigns:', JSON.stringify(campaigns.rows, null, 2));

    for (const c of campaigns.rows) {
      const msgStats = await query(\`
        SELECT status, count(*), min(scheduled_at) as first_sched, max(scheduled_at) as last_sched
        FROM campaign_messages 
        WHERE campaign_id = \$1
        GROUP BY status
      \`, [c.id]);
      console.log(\`Msg Stats for \${c.name}:\`, JSON.stringify(msgStats.rows, null, 2));

      const conn = await query(\`
        SELECT id, name, provider, status, meta_token IS NOT NULL as has_token, meta_phone_number_id 
        FROM connections WHERE id = \$1
      \`, [c.connection_id]);
      console.log(\`Connection for \${c.name}:\`, JSON.stringify(conn.rows, null, 2));
    }

    const nextMessages = await query(\`
      SELECT cm.id, cm.campaign_id, cm.phone, cm.scheduled_at, c.status as c_status, conn.status as conn_status
      FROM campaign_messages cm
      JOIN campaigns c ON c.id = cm.campaign_id
      JOIN connections conn ON conn.id = c.connection_id
      WHERE cm.status = 'pending'
      ORDER BY cm.scheduled_at ASC
      LIMIT 10
    \`);
    console.log('Pending Messages (Global Next 10):', JSON.stringify(nextMessages.rows, null, 2));

  } catch (err) {
    console.error('Diagnostic error:', err);
  } finally {
    process.exit(0);
  }
}

checkCampaigns();
