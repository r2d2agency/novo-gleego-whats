import { query } from './db.js';

async function check() {
  try {
    const res = await query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
    console.log("Tables in DB:", res.rows);
    const forms = await query("SELECT id, name, slug FROM external_forms WHERE slug = 'aabv'");
    console.log("Form 'aabv':", forms.rows);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    process.exit(0);
  }
}

check();
