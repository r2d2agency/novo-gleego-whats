import express from 'express';
import { pool } from '../db.js';
import { logInfo, logError } from '../logger.js';

const router = express.Router();

router.get('/db', async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await pool.query('SELECT NOW() as now, version() as version');
    
    // Diagnostic for external_forms
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'external_forms'
    `);

    res.json({
      status: 'ok',
      timestamp: result.rows[0].now,
      version: result.rows[0].version,
      duration_ms: Date.now() - startedAt,
      database_url_present: Boolean(process.env.DATABASE_URL),
      external_forms_exists: tableCheck.rows.length > 0
    });
  } catch (error) {
    logError('Health check DB failed', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      duration_ms: Date.now() - startedAt
    });
  }
});

export default router;
