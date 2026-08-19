const pg = require('pg');
const { Client } = pg;
const connectionString = process.env.DATABASE_URL || "postgres://postgres:bc3hptmj5wgnowz62nf0@gleego_whats-bd:5432/whats-bd?sslmode=disable";
const client = new Client({ 
  connectionString: connectionString.replace('gleego_whats-bd', 'localhost'),
  ssl: { rejectUnauthorized: false } 
});
async function run() {
  try {
    await client.connect();
    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log("Tables:", tables.rows.map(r => r.table_name).join(", "));
    
    if (tables.rows.some(r => r.table_name === 'campaigns')) {
      const campaigns = await client.query("SELECT id, name, status, created_at FROM campaigns ORDER BY created_at DESC LIMIT 3");
      console.log("Recent Campaigns:", JSON.stringify(campaigns.rows, null, 2));
    }
    if (tables.rows.some(r => r.table_name === 'contacts')) {
      const contacts = await client.query("SELECT COUNT(*) FROM contacts");
      console.log("Total Contacts:", contacts.rows[0].count);
    }
  } catch (err) {
    console.error("DB Error:", err.message);
  } finally {
    await client.end();
  }
}
run();
