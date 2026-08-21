
import pg from 'pg';
import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get('/api/external-forms/public/:slug', async (req, res) => {
  console.log('Public form request for slug:', req.params.slug);
  try {
    const result = await pool.query(
      'SELECT f.*, o.name as organization_name FROM external_forms f JOIN organizations o ON o.id = f.organization_id WHERE f.slug = $1',
      [req.params.slug]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    
    const fields = await pool.query(
      'SELECT * FROM external_form_fields WHERE form_id = $1 ORDER BY position',
      [result.rows[0].id]
    );
    
    res.json({ ...result.rows[0], fields: fields.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3002;
app.listen(PORT, () => console.log('Mock backend listening on port ' + PORT));
