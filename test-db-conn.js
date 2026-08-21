
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;
const dbUrl = process.env.DATABASE_URL;

console.log('Testing connection to DATABASE_URL...');

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

async function test() {
  try {
    await client.connect();
    console.log('Connected successfully!');
    const res = await client.query('SELECT NOW()');
    console.log('Current time from DB:', res.rows[0].now);
    await client.end();
  } catch (err) {
    console.error('Connection failed:', err.message);
    process.exit(1);
  }
}

test();
