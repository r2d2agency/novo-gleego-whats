import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Validate WhatsApp numbers via Evolution API
async function validateWhatsAppNumbers(connectionId, phones) {
  try {
    // Get connection details
    const connResult = await query(
      'SELECT api_url, api_key, instance_name FROM connections WHERE id = $1',
      [connectionId]
    );

    if (connResult.rows.length === 0) {
      return null; // No connection, skip validation
    }

    const { api_url, api_key, instance_name } = connResult.rows[0];

    if (!api_url || !api_key || !instance_name) {
      return null; // Connection not properly configured
    }

    // Call Evolution API to validate numbers
    const response = await fetch(`${api_url}/chat/whatsappNumbers/${instance_name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': api_key,
      },
      body: JSON.stringify({ numbers: phones }),
    });

    if (!response.ok) {
      console.error('WhatsApp validation failed:', response.status);
      return null;
    }

    const data = await response.json();
    
    // Create a map of phone -> exists
    const validMap = {};
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.jid) {
          // Extract phone from jid (e.g., "5511999999999@s.whatsapp.net")
          const phone = item.jid.split('@')[0];
          validMap[phone] = item.exists === true;
        }
      }
    }

    return validMap;
  } catch (error) {
    console.error('Error validating WhatsApp numbers:', error);
    return null;
  }
}

// Helper to get user's organization
async function getUserOrganization(userId) {
  const result = await query(
    `SELECT om.organization_id, om.role 
     FROM organization_members om 
     WHERE om.user_id = $1 
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

// List user contact lists (includes organization's lists via connections)
router.get('/lists', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    const filterConnectionId = typeof req.query.connection_id === 'string' ? req.query.connection_id : null;

    const isOwnerOrAdmin = org && ['owner', 'admin'].includes(org.role);
    
    let whereClause = 'cl.user_id = $1';
    let params = [req.userId];

    if (org) {
      // All members of the organization see all lists from the organization
      whereClause = `(
        cl.user_id = $1
        OR cl.organization_id = $2
        OR cl.user_id IN (SELECT user_id FROM organization_members WHERE organization_id = $2)
        OR cl.connection_id IN (SELECT id FROM connections WHERE organization_id = $2)
      )`;
      params = [req.userId, org.organization_id];
    }

    // Apply connection filter if provided
    if (filterConnectionId) {
      whereClause += ` AND cl.connection_id = $${params.length + 1}`;
      params.push(filterConnectionId);
    }

    const result = await query(
      `SELECT cl.*, 
              COUNT(c.id) as contact_count,
              conn.name as connection_name,
              u.name as created_by_name
       FROM contact_lists cl
       LEFT JOIN contacts c ON c.list_id = cl.id
       LEFT JOIN connections conn ON cl.connection_id = conn.id
       LEFT JOIN users u ON cl.user_id = u.id
       WHERE ${whereClause}
       GROUP BY cl.id, conn.name, u.name
       ORDER BY cl.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List contact lists error:', error);
    res.status(500).json({ error: 'Erro ao listar listas de contatos' });
  }
});

// Create contact list
router.post('/lists', async (req, res) => {
  try {
    const { name, connection_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    // If connection_id provided, verify access
    if (connection_id) {
      const org = await getUserOrganization(req.userId);
      
      let connCheck;
      if (org) {
        connCheck = await query(
          'SELECT id FROM connections WHERE id = $1 AND (user_id = $2 OR organization_id = $3)',
          [connection_id, req.userId, org.organization_id]
        );
      } else {
        connCheck = await query(
          'SELECT id FROM connections WHERE id = $1 AND user_id = $2',
          [connection_id, req.userId]
        );
      }

      if (connCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Conexão não encontrada ou sem permissão' });
      }
    }

    const org = await getUserOrganization(req.userId);
    const { is_public } = req.body;

    const result = await query(
      'INSERT INTO contact_lists (user_id, name, connection_id, organization_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.userId, name, connection_id || null, (is_public && org) ? org.organization_id : null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create contact list error:', error);
    res.status(500).json({ error: 'Erro ao criar lista de contatos' });
  }
});

// Helper to check list access
async function checkListAccess(listId, userId) {
  const org = await getUserOrganization(userId);
  const isOwnerOrAdmin = org && ['owner', 'admin'].includes(org.role);

  let whereClause = 'id = $1 AND user_id = $2';
  let params = [listId, userId];

  if (org) {
    whereClause = `id = $1 AND (user_id = $2 OR organization_id = $3 OR user_id IN (SELECT user_id FROM organization_members WHERE organization_id = $3) OR connection_id IN (SELECT id FROM connections WHERE organization_id = $3))`;
    params = [listId, userId, org.organization_id];
  }

  const result = await query(
    `SELECT id FROM contact_lists WHERE ${whereClause}`,
    params
  );

  return result.rows.length > 0 ? org : null;
}

// Delete contact list
router.delete('/lists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const org = await getUserOrganization(req.userId);

    let whereClause = 'id = $1 AND user_id = $2';
    let params = [id, req.userId];

    if (org && ['owner', 'admin', 'manager'].includes(org.role)) {
      whereClause = `id = $1 AND (user_id = $2 OR connection_id IN (
        SELECT id FROM connections WHERE organization_id = $3
      ))`;
      params = [id, req.userId, org.organization_id];
    }

    const result = await query(
      `DELETE FROM contact_lists WHERE ${whereClause} RETURNING id`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete contact list error:', error);
    res.status(500).json({ error: 'Erro ao deletar lista' });
  }
});

router.patch('/lists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_public } = req.body;
    const org = await getUserOrganization(req.userId);
    const list = await query('SELECT * FROM contact_lists WHERE id = $1', [id]);
    if (list.rows.length === 0) return res.status(404).json({ error: 'Lista não encontrada' });
    const isOwner = list.rows[0].user_id === req.userId;
    const isOrgAdmin = org && ['owner', 'admin', 'manager'].includes(org.role);
    if (!isOwner && !isOrgAdmin) return res.status(403).json({ error: 'Sem permissão' });
    const sets = [];
    const params = [id];
    let idx = 2;
    if (name) { sets.push(`name = $${idx++}`); params.push(name); }
    if (typeof is_public === 'boolean') {
      sets.push(`organization_id = $${idx++}`);
      params.push(is_public && org ? org.organization_id : null);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    const result = await query(
      `UPDATE contact_lists SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update list error:', error);
    res.status(500).json({ error: 'Erro ao atualizar lista' });
  }
});

// List contacts from a list
router.get('/lists/:listId/contacts', async (req, res) => {
  try {
    const { listId } = req.params;
    const org = await getUserOrganization(req.userId);

    const isOwnerOrAdmin = org && ['owner', 'admin'].includes(org.role);

    // Verify list access
    let whereClause = 'id = $1 AND user_id = $2';
    let params = [listId, req.userId];

    if (org) {
      whereClause = `id = $1 AND (user_id = $2 OR organization_id = $3 OR user_id IN (SELECT user_id FROM organization_members WHERE organization_id = $3) OR connection_id IN (SELECT id FROM connections WHERE organization_id = $3))`;
      params = [listId, req.userId, org.organization_id];
    }

    const listCheck = await query(
      `SELECT id FROM contact_lists WHERE ${whereClause}`,
      params
    );

    if (listCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const result = await query(
      'SELECT * FROM contacts WHERE list_id = $1 ORDER BY name ASC',
      [listId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('List contacts error:', error);
    res.status(500).json({ error: 'Erro ao listar contatos' });
  }
});

// Add contact to list
router.post('/lists/:listId/contacts', async (req, res) => {
  try {
    const { listId } = req.params;
    const { name, phone, is_whatsapp } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
    }

    const org = await getUserOrganization(req.userId);

    const isOwnerOrAdmin = org && ['owner', 'admin'].includes(org.role);

    // Verify list access
    let whereClause = 'id = $1 AND user_id = $2';
    let params = [listId, req.userId];

    if (org) {
      whereClause = `id = $1 AND (user_id = $2 OR organization_id = $3 OR user_id IN (SELECT user_id FROM organization_members WHERE organization_id = $3) OR connection_id IN (SELECT id FROM connections WHERE organization_id = $3))`;
      params = [listId, req.userId, org.organization_id];
    }

    const listCheck = await query(
      `SELECT id FROM contact_lists WHERE ${whereClause}`,
      params
    );

    if (listCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const result = await query(
      'INSERT INTO contacts (list_id, name, phone, is_whatsapp) VALUES ($1, $2, $3, $4) RETURNING *',
      [listId, name, phone, typeof is_whatsapp === 'boolean' ? is_whatsapp : null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Add contact error:', error);
    res.status(500).json({ error: 'Erro ao adicionar contato' });
  }
});

// Bulk import contacts with optional WhatsApp validation
router.post('/lists/:listId/import', async (req, res) => {
  try {
    const { listId } = req.params;
    const { contacts, validate_whatsapp } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'Lista de contatos inválida' });
    }

    const org = await getUserOrganization(req.userId);

    const isOwnerOrAdmin = org && ['owner', 'admin'].includes(org.role);

    // Verify list access and get connection_id
    let whereClause = 'id = $1 AND user_id = $2';
    let params = [listId, req.userId];

    if (isOwnerOrAdmin) {
      whereClause = `id = $1 AND (user_id = $2 OR organization_id = $3 OR user_id IN (SELECT user_id FROM organization_members WHERE organization_id = $3) OR connection_id IN (SELECT id FROM connections WHERE organization_id = $3))`;
      params = [listId, req.userId, org.organization_id];
    } else if (org) {
      whereClause = `id = $1 AND (user_id = $2 OR organization_id = $3)`;
      params = [listId, req.userId, org.organization_id];
    }

    const listCheck = await query(
      `SELECT id, connection_id FROM contact_lists WHERE ${whereClause}`,
      params
    );

    if (listCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const connectionId = listCheck.rows[0].connection_id;

    // Normalize contacts
    let normalized = contacts.map((c) => {
      let phone = String(c?.phone || '').trim().replace(/\D/g, '');
      // Ensure country code
      if (phone && !phone.startsWith('55') && phone.length <= 11) {
        phone = '55' + phone;
      }
      return {
        name: String(c?.name || '').trim(),
        phone,
        is_whatsapp: typeof c?.is_whatsapp === 'boolean' ? c.is_whatsapp : null,
      };
    }).filter((c) => c.name && c.phone && c.phone.length >= 12);

    if (normalized.length === 0) {
      return res.status(400).json({ error: 'Lista de contatos inválida' });
    }

    // Validate WhatsApp numbers if requested and connection exists
    let invalidCount = 0;
    if (validate_whatsapp && connectionId) {
      const phones = normalized.map(c => c.phone);
      const validationResult = await validateWhatsAppNumbers(connectionId, phones);

      if (validationResult) {
        const validContacts = [];
        for (const contact of normalized) {
          const isValid = validationResult[contact.phone];
          if (isValid === true) {
            contact.is_whatsapp = true;
            validContacts.push(contact);
          } else if (isValid === false) {
            invalidCount++;
          } else {
            // Unknown status, include with null
            validContacts.push(contact);
          }
        }
        normalized = validContacts;
      }
    }

    // Get existing phones in this list to detect duplicates
    const existingResult = await query(
      'SELECT phone FROM contacts WHERE list_id = $1',
      [listId]
    );
    const existingPhones = new Set(existingResult.rows.map(r => r.phone));

    // Also check for duplicates within the import batch
    const seenPhones = new Set();
    const uniqueContacts = [];
    let duplicateCount = 0;

    for (const contact of normalized) {
      if (existingPhones.has(contact.phone) || seenPhones.has(contact.phone)) {
        duplicateCount++;
      } else {
        seenPhones.add(contact.phone);
        uniqueContacts.push(contact);
      }
    }

    // Insert only unique contacts
    if (uniqueContacts.length > 0) {
      const values = uniqueContacts.map((c, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`).join(', ');
      const insertParams = [listId, ...uniqueContacts.flatMap((c) => [c.name, c.phone, c.is_whatsapp])];

      await query(
        `INSERT INTO contacts (list_id, name, phone, is_whatsapp) VALUES ${values}`,
        insertParams
      );
    }

    res.json({ 
      success: true, 
      imported: uniqueContacts.length,
      duplicates: duplicateCount,
      invalid_whatsapp: invalidCount
    });
  } catch (error) {
    console.error('Import contacts error:', error);
    res.status(500).json({ error: 'Erro ao importar contatos' });
  }
});

// Validate WhatsApp numbers endpoint
router.post('/validate-whatsapp', async (req, res) => {
  try {
    const { connection_id, phones } = req.body;

    if (!connection_id || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: 'connection_id e phones são obrigatórios' });
    }

    // Verify connection access
    const org = await getUserOrganization(req.userId);
    
    let connCheck;
    if (org) {
      connCheck = await query(
        'SELECT id FROM connections WHERE id = $1 AND (user_id = $2 OR organization_id = $3)',
        [connection_id, req.userId, org.organization_id]
      );
    } else {
      connCheck = await query(
        'SELECT id FROM connections WHERE id = $1 AND user_id = $2',
        [connection_id, req.userId]
      );
    }

    if (connCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Conexão não encontrada ou sem permissão' });
    }

    // Normalize phones
    const normalizedPhones = phones.map(p => {
      let phone = String(p).replace(/\D/g, '');
      if (!phone.startsWith('55') && phone.length <= 11) {
        phone = '55' + phone;
      }
      return phone;
    }).filter(p => p.length >= 12);

    const result = await validateWhatsAppNumbers(connection_id, normalizedPhones);

    if (!result) {
      return res.status(500).json({ error: 'Erro ao validar números. Verifique se a conexão está ativa.' });
    }

    res.json({ results: result });
  } catch (error) {
    console.error('Validate WhatsApp error:', error);
    res.status(500).json({ error: 'Erro ao validar números' });
  }
});
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, is_whatsapp } = req.body;

    const sets = [];
    const params = [];
    let idx = 1;

    if (typeof name === 'string') {
      sets.push(`name = $${idx++}`);
      params.push(name);
    }

    if (typeof phone === 'string') {
      sets.push(`phone = $${idx++}`);
      params.push(phone);
    }

    if (typeof is_whatsapp === 'boolean') {
      sets.push(`is_whatsapp = $${idx++}`);
      params.push(is_whatsapp);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    const org = await getUserOrganization(req.userId);

    params.push(id);
    params.push(req.userId);

    let subquery = 'SELECT id FROM contact_lists WHERE user_id = $' + (idx + 1);
    
    if (org) {
      params.push(org.organization_id);
      subquery = `SELECT id FROM contact_lists WHERE user_id = $${idx + 1} OR connection_id IN (
        SELECT id FROM connections WHERE organization_id = $${idx + 2}
      )`;
    }

    const result = await query(
      `UPDATE contacts
       SET ${sets.join(', ')}
       WHERE id = $${idx} AND list_id IN (${subquery})
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({ error: 'Erro ao atualizar contato' });
  }
});

// Delete contact
// Validate list contacts via UAZAPI/Evolution
router.post('/lists/:listId/validate-all', async (req, res) => {
  try {
    const { listId } = req.params;
    const { connection_id } = req.body;

    if (!connection_id) {
      return res.status(400).json({ error: 'connection_id é obrigatório' });
    }

    const org = await getUserOrganization(req.userId);
    
    // Verify connection access
    let connCheck;
    if (org) {
      connCheck = await query(
        'SELECT id, uazapi_url, uazapi_token, api_url, api_key, instance_name FROM connections WHERE id = $1 AND (user_id = $2 OR organization_id = $3)',
        [connection_id, req.userId, org.organization_id]
      );
    } else {
      connCheck = await query(
        'SELECT id, uazapi_url, uazapi_token, api_url, api_key, instance_name FROM connections WHERE id = $1 AND user_id = $2',
        [connection_id, req.userId]
      );
    }

    if (!connCheck || connCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Conexão não encontrada ou sem permissão' });
    }

    const connection = connCheck.rows[0];

    // Get non-validated contacts
    const contactsResult = await query(
      'SELECT id, phone FROM contacts WHERE list_id = $1 AND (is_whatsapp IS NULL)',
      [listId]
    );

    const contacts = contactsResult?.rows || [];
    if (contacts.length === 0) {
      return res.json({ success: true, validated: 0, message: 'Nenhum contato pendente de validação' });
    }

    // Prepare phones (Evolution/UAZAPI usually want normalized phones)
    const phones = contacts.map(c => {
      let phone = String(c.phone).replace(/\D/g, '');
      if (!phone.startsWith('55') && phone.length <= 11) {
        phone = '55' + phone;
      }
      return phone;
    });

    let validMap = {};

    // Use UAZAPI if available
    if (connection.uazapi_url && connection.uazapi_token) {
      const { checkNumbers } = await import('../lib/uazapi-provider.js');
      try {
        const results = await checkNumbers(connection.uazapi_url, connection.uazapi_token, phones);
        if (Array.isArray(results)) {
          results.forEach(item => {
            validMap[item.phone] = item.exists;
          });
        }
      } catch (err) {
        console.error('UAZAPI checkNumbers error:', err);
        return res.status(500).json({ error: 'Erro ao validar na UAZAPI: ' + err.message });
      }
    } else if (connection.api_url && connection.api_key && connection.instance_name) {
      // Use Evolution API
      const result = await validateWhatsAppNumbers(connection_id, phones);
      if (result) validMap = result;
    } else {
      return res.status(400).json({ error: 'Conexão não configurada para validação' });
    }

    // Update contacts in database
    let validatedCount = 0;
    for (const contact of contacts) {
      const phone = String(contact.phone).replace(/\D/g, '');
      const normalizedPhone = (!phone.startsWith('55') && phone.length <= 11) ? '55' + phone : phone;
      
      if (validMap[normalizedPhone] !== undefined) {
        await query(
          'UPDATE contacts SET is_whatsapp = $1 WHERE id = $2',
          [validMap[normalizedPhone], contact.id]
        );
        validatedCount++;
      }
    }

    res.json({ success: true, validated: validatedCount });
  } catch (error) {
    console.error('Validate list contacts error:', error);
    res.status(500).json({ error: 'Erro ao validar contatos da lista: ' + error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const org = await getUserOrganization(req.userId);

    let subquery = 'SELECT id FROM contact_lists WHERE user_id = $2';
    let params = [id, req.userId];

    if (org) {
      params.push(org.organization_id);
      subquery = `SELECT id FROM contact_lists WHERE user_id = $2 OR organization_id = $3 OR connection_id IN (
        SELECT id FROM connections WHERE organization_id = $3
      )`;
    }

    const result = await query(
      `DELETE FROM contacts 
       WHERE id = $1 AND list_id IN (${subquery})
       RETURNING id`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({ error: 'Erro ao deletar contato' });
  }
});

// ==========================================
// CREATE LIST FROM CONVERSATION TAG
// ==========================================

// Create a contact list from conversations that have a specific tag
router.post('/lists/from-tag', async (req, res) => {
  try {
    const { tag_id, tag_ids, name, connection_id } = req.body;

    // Accept either tag_ids (array) or tag_id (single, legacy)
    const tagIds = Array.isArray(tag_ids) && tag_ids.length > 0
      ? tag_ids.filter(Boolean)
      : (tag_id ? [tag_id] : []);

    if (tagIds.length === 0) {
      return res.status(400).json({ error: 'Tag é obrigatória' });
    }

    const org = await getUserOrganization(req.userId);
    if (!org) {
      console.warn('[Contacts] User', req.userId, 'is not in an organization');
      return res.status(403).json({ error: 'Você não tem permissão para realizar esta ação (organização não encontrada).' });
    }


    // Verify tags belong to user's organization
    const tagCheck = await query(
      'SELECT id, name, organization_id FROM conversation_tags WHERE id = ANY($1::uuid[]) AND organization_id = $2',
      [tagIds, org.organization_id]
    );

    if (tagCheck.rows.length === 0) {
      console.warn('[Contacts] No tags found for IDs:', tagIds, 'in org:', org.organization_id);
      return res.status(404).json({ error: 'Nenhuma tag encontrada ou sem permissão na organização.' });
    }


    const tagNames = tagCheck.rows.map(r => r.name);
    const validTagIds = tagCheck.rows.map(r => r.id);
    const listName = name || `Tags: ${tagNames.join(', ')}`;

    // Get all conversations with this tag that have phone numbers
    // Only get active (non-archived) individual conversations with messages
    const conversationsResult = await query(
      `SELECT DISTINCT ON (conv.contact_phone)
        conv.contact_name,
        conv.contact_phone
       FROM conversations conv
       JOIN conversation_tag_links ctl ON ctl.conversation_id = conv.id
       JOIN connections conn ON conn.id = conv.connection_id
       WHERE ctl.tag_id = ANY($1::uuid[])
         AND conn.organization_id = $2
         AND conv.contact_phone IS NOT NULL
         AND conv.contact_phone != ''
         AND COALESCE(conv.is_group, false) = false
         AND conv.is_archived = false
         AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id)`,
      [validTagIds, org.organization_id]
    );

    if (conversationsResult.rows.length === 0) {
      console.warn('[Contacts] No conversations found for tags:', validTagIds);
      return res.status(400).json({ error: 'Nenhuma conversa com telefone e mensagens encontradas para as tags selecionadas.' });
    }

    // Create the list
    const listResult = await query(
      'INSERT INTO contact_lists (user_id, name, connection_id, organization_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.userId, listName, connection_id || null, org.organization_id]
    );

    const listId = listResult.rows[0].id;

    // Insert contacts into the list
    const contacts = conversationsResult.rows;
    let insertedCount = 0;

    for (const contact of contacts) {
      try {
        await query(
          'INSERT INTO contacts (list_id, name, phone) VALUES ($1, $2, $3)',
          [listId, contact.contact_name || contact.contact_phone, contact.contact_phone]
        );
        insertedCount++;
      } catch (insertErr) {
        // Skip duplicates or errors
        console.warn('Failed to insert contact:', insertErr.message);
      }
    }

    // Get the list with contact count
    const finalList = await query(
      `SELECT cl.*, COUNT(c.id)::int as contact_count
       FROM contact_lists cl
       LEFT JOIN contacts c ON c.list_id = cl.id
       WHERE cl.id = $1
       GROUP BY cl.id`,
      [listId]
    );

    res.status(201).json({
      ...finalList.rows[0],
      message: `Lista criada com ${insertedCount} contatos das tags: ${tagNames.join(', ')}`
    });
  } catch (error) {
    console.error('Create list from tag error:', error);
    res.status(500).json({ error: 'Erro ao criar lista a partir da tag' });
  }
});

// Preview count of unique contacts for one or more tags (no list created)
router.post('/lists/from-tag/preview', async (req, res) => {
  try {
    const { tag_ids, tag_id } = req.body || {};
    const tagIds = Array.isArray(tag_ids) && tag_ids.length > 0
      ? tag_ids.filter(Boolean)
      : (tag_id ? [tag_id] : []);

    if (tagIds.length === 0) {
      return res.json({ count: 0, tag_names: [] });
    }

    const org = await getUserOrganization(req.userId);
    if (!org) {
      return res.status(400).json({ error: 'Usuário não pertence a uma organização' });
    }

    const tagCheck = await query(
      'SELECT id, name FROM conversation_tags WHERE id = ANY($1::uuid[]) AND organization_id = $2',
      [tagIds, org.organization_id]
    );

    if (tagCheck.rows.length === 0) {
      return res.json({ count: 0, tag_names: [] });
    }

    const validTagIds = tagCheck.rows.map(r => r.id);
    const tagNames = tagCheck.rows.map(r => r.name);

    const result = await query(
      `SELECT COUNT(DISTINCT conv.contact_phone)::int AS count
         FROM conversations conv
         JOIN conversation_tag_links ctl ON ctl.conversation_id = conv.id
         JOIN connections conn ON conn.id = conv.connection_id
        WHERE ctl.tag_id = ANY($1::uuid[])
          AND conn.organization_id = $2
          AND conv.contact_phone IS NOT NULL
          AND conv.contact_phone != ''
          AND COALESCE(conv.is_group, false) = false
          AND conv.is_archived = false
          AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id)`,
      [validTagIds, org.organization_id]
    );

    res.json({ count: result.rows[0]?.count || 0, tag_names: tagNames });
  } catch (error) {
    console.error('Preview list from tag error:', error);
    res.status(500).json({ error: 'Erro ao prever contatos' });
  }
});

router.post('/lists/:listId/validate-bulk', async (req, res) => {
  const { listId } = req.params;
  const { results } = req.body; // Array de { phone, exists }

  if (!Array.isArray(results)) return res.status(400).json({ error: 'Resultados inválidos' });

  try {
    // Processar em lotes para atualizar o banco
    for (const item of results) {
      await query(
        'UPDATE contacts SET is_whatsapp = $1 WHERE list_id = $2 AND phone = $3',
        [item.exists, listId, item.phone]
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
