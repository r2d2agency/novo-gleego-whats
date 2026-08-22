import express from 'express';
import { pool } from '../db.js';
import { logInfo, logError } from '../logger.js';

const router = express.Router();

router.get('/db', async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await pool.query('SELECT NOW() as now, version() as version');
    res.json({
      status: 'ok',
      timestamp: result.rows[0].now,
      version: result.rows[0].version,
      duration_ms: Date.now() - startedAt,
      database_url_present: Boolean(process.env.DATABASE_URL)
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
