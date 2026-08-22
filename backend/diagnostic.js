import { query } from './src/db.js';
import dotenv from 'dotenv';
dotenv.config();

async function runDiagnostic() {
  console.log('--- Database Connection Diagnostic ---');
  console.log('DATABASE_URL:', process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':****@'));
  
  try {
    const time = await query('SELECT NOW()');
    console.log('Connection: SUCCESS');
    console.log('Database Time:', time.rows[0].now);

    const campaigns = await query(`
      SELECT status, count(*) 
      FROM campaigns 
      GROUP BY status
    `);
    console.log('\nCampaign Statuses:', campaigns.rows);

    const pendingMessages = await query(`
      SELECT count(*) 
      FROM campaign_messages 
      WHERE status = 'pending' 
      AND scheduled_at <= (NOW() + INTERVAL '10 minutes')
    `);
    console.log('Pending messages (next 10m):', pendingMessages.rows[0].count);

    const activeConns = await query(`
      SELECT provider, status, count(*) 
      FROM connections 
      GROUP BY provider, status
    `);
    console.log('\nConnection Statuses:', activeConns.rows);

  } catch (err) {
    console.error('Connection: FAILED');
    console.error('Error Code:', err.code);
    console.error('Error Message:', err.message);
  }
  process.exit(0);
}

runDiagnostic();
