import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Force load backend/.env
dotenv.config({ path: path.join(process.cwd(), '.env') });

console.log('ENV DATABASE_URL:', process.env.DATABASE_URL);

const { Pool } = pg;

const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
};

async function test() {
  const pool = new Pool(dbConfig);
  try {
    const res = await pool.query('SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = \'public\'');
    console.log('TABLES:', res.rows.map(r => r.tablename));
  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await pool.end();
  }
}

test();
