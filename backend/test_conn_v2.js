import pg from 'pg';
import fs from 'fs';
import path from 'path';

// Manual env loading to bypass any cache
const envContent = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
const dbUrlMatch = envContent.match(/DATABASE_URL=["']?([^"'\n]+)["']?/);
const dbUrl = dbUrlMatch ? dbUrlMatch[1] : null;

console.log('MANUAL DB_URL:', dbUrl);

if (!dbUrl) {
  console.error('DATABASE_URL not found in .env');
  process.exit(1);
}

const { Pool } = pg;
const dbConfig = {
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
};

async function test() {
  console.log('Attempting connection to:', dbUrl.replace(/:[^:@]+@/, ':****@'));
  const pool = new Pool(dbConfig);
  try {
    const res = await pool.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
    console.log('SUCCESS! TABLES:', res.rows.map(r => r.tablename).join(', '));
    
    // Check pending campaigns
    const campaigns = await pool.query("SELECT id, name, status FROM campaigns WHERE status IN ('pending', 'running')");
    console.log('Active Campaigns:', JSON.stringify(campaigns.rows));
    
  } catch (e) {
    console.error('ERROR:', e.message);
    if (e.code === 'ENOTFOUND') {
      console.error('DNS Lookup failed for:', e.hostname);
    }
  } finally {
    await pool.end();
  }
}

test();
