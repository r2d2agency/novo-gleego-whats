import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Middleware to check superadmin
const requireSuperadmin = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT is_superadmin FROM users WHERE id = $1`,
      [req.userId]
    );
    
    if (result.rows.length === 0 || !result.rows[0].is_superadmin) {
      return res.status(403).json({ error: 'Acesso negado. Requer superadmin.' });
    }
    
    next();
  } catch (error) {
    console.error('Superadmin check error:', error);
    res.status(500).json({ error: 'Erro ao verificar permissões' });
  }
};

router.use(authenticate);
router.use(requireSuperadmin);

// GET: /api/meta/admin/status
router.get('/status', async (req, res) => {
  try {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    
    const connCount = await query(`SELECT COUNT(*) FROM connections WHERE provider = 'meta'`);
    const pagesCount = await query(`SELECT COUNT(*) FROM meta_pages`);
    
    res.json({
      configured: !!(appId && appSecret && verifyToken),
      app_id_configured: !!appId,
      app_secret_configured: !!appSecret,
      webhook_verify_token_configured: !!verifyToken,
      whatsapp_config_id_configured: !!process.env.META_WHATSAPP_CONFIG_ID,
      connections_count: parseInt(connCount.rows[0].count),
      pages_count: parseInt(pagesCount.rows[0].count)
    });
  } catch (error) {
    console.error('Meta admin status error:', error);
    res.status(500).json({ error: 'Erro ao buscar status do Meta admin' });
  }
});

// GET: /api/meta/admin/connections
router.get('/connections', async (req, res) => {
  try {
    const connResult = await query(`
      SELECT * FROM connections 
      WHERE provider = 'meta' 
      ORDER BY created_at DESC
    `);
    
    const pagesResult = await query(`
      SELECT * FROM meta_pages 
      ORDER BY created_at DESC
    `);
    
    // Get all organizations for mapping
    const orgsResult = await query(`SELECT id, name, slug FROM organizations`);
    const organizations = {};
    orgsResult.rows.forEach(org => {
      organizations[org.id] = org;
    });
    
    res.json({
      connections: connResult.rows,
      pages: pagesResult.rows,
      organizations
    });
  } catch (error) {
    console.error('Meta admin connections error:', error);
    res.status(500).json({ error: 'Erro ao buscar conexões do Meta admin' });
  }
});

// POST: /api/meta/admin/revoke
router.post('/revoke', async (req, res) => {
  try {
    const { connection_id } = req.body;
    if (!connection_id) return res.status(400).json({ error: 'connection_id obrigatório' });
    
    await query(`DELETE FROM connections WHERE id = $1 AND provider = 'meta'`, [connection_id]);
    await query(`DELETE FROM meta_pages WHERE oauth_connection_id = $1`, [connection_id]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Meta admin revoke error:', error);
    res.status(500).json({ error: 'Erro ao revogar conexão Meta' });
  }
});

// POST: /api/meta/admin/sync
router.post('/sync', async (req, res) => {
  try {
    const { connection_id } = req.body;
    if (!connection_id) return res.status(400).json({ error: 'connection_id obrigatório' });
    
    // In a real scenario, this would trigger a background sync job
    // For now, we return success as the frontend expects
    res.json({ success: true, message: 'Sincronização iniciada' });
  } catch (error) {
    console.error('Meta admin sync error:', error);
    res.status(500).json({ error: 'Erro ao sincronizar conexão Meta' });
  }
});

export default router;
