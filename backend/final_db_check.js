import pg from 'pg';
const { Client } = pg;

async function check() {
  const dbUrl = process.env.DATABASE_URL;
  console.log("Checking DB connectivity to environment DATABASE_URL...");
  
  if (!dbUrl) {
    console.error("❌ DATABASE_URL is not defined in process.env");
    process.exit(1);
  }

  const client = new Client({ 
    connectionString: dbUrl,
    connectionTimeoutMillis: 5000,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log("✅ Connection SUCCESS!");
    const res = await client.query('SELECT NOW() as now');
    console.log("Database time:", res.rows[0].now);
    
    // Check campaign table counts
    const campaigns = await client.query("SELECT status, count(*) FROM campaigns GROUP BY status");
    console.log("Campaign status counts:", campaigns.rows);

    const pendingMsgs = await client.query("SELECT count(*) FROM campaign_messages WHERE status = 'pending'");
    console.log("Pending messages total:", pendingMsgs.rows[0].count);

    await client.end();
  } catch (err) {
    console.error(`❌ Connection FAILED: ${err.message}`);
    console.error(`Host attempted: ${dbUrl.split('@')[1]?.split('/')[0]}`);
  }
}

check();
