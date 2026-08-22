import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

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

// List campaigns (user's own + organization's)
router.get('/', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);

    const isOwnerOrAdmin = org && ['owner', 'admin'].includes(org.role);
    
    let whereClause = 'c.user_id = $1';
    let params = [req.userId];

    if (isOwnerOrAdmin) {
      // Owner/Admin sees EVERYTHING in the organization
      whereClause = `(c.user_id = $1 OR c.connection_id IN (
        SELECT id FROM connections WHERE organization_id = $2
      ))`;
      params = [req.userId, org.organization_id];
    } else if (org) {
      // Others see their own OR shared (shared flag to be added if needed, 
      // for now keeping it to own campaigns since user said "unicas e exclusivas")
      whereClause = 'c.user_id = $1';
      params = [req.userId];
    }

    const result = await query(
      `SELECT c.*, 
              cl.name as list_name,
              mt.name as message_name,
              f.name as flow_name,
              conn.name as connection_name,
              u.name as created_by_name
       FROM campaigns c
       LEFT JOIN contact_lists cl ON c.list_id = cl.id
       LEFT JOIN message_templates mt ON c.message_id = mt.id
       LEFT JOIN flows f ON c.flow_id = f.id
       LEFT JOIN connections conn ON c.connection_id = conn.id
       LEFT JOIN users u ON c.user_id = u.id
       WHERE ${whereClause}
       ORDER BY c.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List campaigns error:', error);
    res.status(500).json({ error: 'Erro ao listar campanhas' });
  }
});

// Create campaign with pre-allocated messages for each contact
router.post('/', async (req, res) => {
  try {
    const { 
      name, 
      connection_id, 
      list_id, 
      message_id,
      message_ids, // Support array of messages
      flow_id, // Support flow-based campaigns
      meta_template_id, // Support Meta template-based campaigns
      meta_template_params,
      scheduled_at,
      start_date,
      end_date,
      start_time,
      end_time,
      min_delay,
      max_delay,
      pause_after_messages,
      pause_duration,
      random_order,
      random_messages
    } = req.body;

    // Accept message_id or message_ids (unless using flow)
    const allMessageIds = message_ids && Array.isArray(message_ids) && message_ids.length > 0 
      ? message_ids 
      : (message_id ? [message_id] : []);
    
    const finalMessageId = allMessageIds[0] || null;
    const isFlowCampaign = !!flow_id;
    const isTemplateCampaign = !!meta_template_id;

    // Either messages, flow OR meta template is required
    if (!name) {
      return res.status(400).json({ error: 'O nome da campanha é obrigatório.' });
    }
    if (!connection_id) {
      return res.status(400).json({ error: 'Selecione uma conexão.' });
    }
    if (!list_id) {
      return res.status(400).json({ error: 'Selecione uma lista de contatos.' });
    }
    if (!finalMessageId && !isFlowCampaign && !isTemplateCampaign) {
      return res.status(400).json({ error: 'Selecione o conteúdo (Mensagem, Fluxo ou Template) para envio.' });
    }


    const org = await getUserOrganization(req.userId);

    // Verify ownership of related resources (including org-level access)
    let connectionCheck, listCheck;

    if (org) {
      connectionCheck = await query(
        'SELECT id FROM connections WHERE id = $1 AND (user_id = $2 OR organization_id = $3)',
        [connection_id, req.userId, org.organization_id]
      );
      listCheck = await query(
        `SELECT id FROM contact_lists WHERE id = $1 AND (
          user_id = $2 OR 
          organization_id = $3 OR
          user_id IN (SELECT user_id FROM organization_members WHERE organization_id = $3) OR
          connection_id IN (SELECT id FROM connections WHERE organization_id = $3)
        )`,
        [list_id, req.userId, org.organization_id]
      );
    } else {
      connectionCheck = await query(
        'SELECT id FROM connections WHERE id = $1 AND user_id = $2',
        [connection_id, req.userId]
      );
      listCheck = await query(
        'SELECT id FROM contact_lists WHERE id = $1 AND user_id = $2',
        [list_id, req.userId]
      );
    }

    if (connectionCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Conexão não encontrada ou sem permissão' });
    }
    if (listCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Lista não encontrada ou sem permissão' });
    }

    // Verify all message IDs (only if not using flow)
    if (!isFlowCampaign && !isTemplateCampaign) {
      for (const msgId of allMessageIds) {
        let messageCheck;
        if (org) {
          messageCheck = await query(
            `SELECT id FROM message_templates WHERE id = $1 AND (
              user_id = $2 OR 
              user_id IN (SELECT user_id FROM organization_members WHERE organization_id = $3)
            )`,
            [msgId, req.userId, org.organization_id]
          );
        } else {
          messageCheck = await query(
            'SELECT id FROM message_templates WHERE id = $1 AND user_id = $2',
            [msgId, req.userId]
          );
        }
        if (messageCheck.rows.length === 0) {
          return res.status(400).json({ error: `Mensagem ${msgId} não encontrada ou sem permissão` });
        }
      }
    }

    // Verify Meta template
    let metaTemplate = null;
    if (isTemplateCampaign) {
      const connRow = await query(
        `SELECT id, provider, meta_token, meta_phone_number_id, meta_waba_id FROM connections WHERE id = $1`,
        [connection_id]
      );
      if (connRow.rows[0]?.provider !== 'meta') {
        return res.status(400).json({ error: 'Templates só podem ser usados em conexões Meta Cloud API' });
      }
      const tplRow = await query(
        `SELECT * FROM meta_message_templates WHERE id = $1 AND connection_id = $2`,
        [meta_template_id, connection_id]
      );
      if (tplRow.rows.length === 0) {
        return res.status(400).json({ error: 'Template não encontrado para essa conexão' });
      }
      metaTemplate = tplRow.rows[0];
      const status = String(metaTemplate.status || '').toUpperCase();
      if (status !== 'APPROVED') {
        return res.status(400).json({ error: `Template "${metaTemplate.name}" não está aprovado (status: ${metaTemplate.status})` });
      }
    }

    // Verify flow if using flow-based campaign
    if (isFlowCampaign) {
      let flowCheck;
      if (org) {
        flowCheck = await query(
          `SELECT id FROM flows WHERE id = $1 AND (organization_id = $2 OR user_id = $3) AND is_active = true`,
          [flow_id, org.organization_id, req.userId]
        );
      } else {
        // For users without org, check if they own the flow
        flowCheck = await query(
          `SELECT id FROM flows WHERE id = $1 AND user_id = $2 AND is_active = true`,
          [flow_id, req.userId]
        );
      }
      if (flowCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Fluxo não encontrado, inativo ou sem permissão' });
      }
    }

    // Get all contacts from the list
    const contactsResult = await query(
      'SELECT id, phone, name FROM contacts WHERE list_id = $1',
      [list_id]
    );

    if (contactsResult.rows.length === 0) {
      return res.status(400).json({ error: 'A lista de contatos está vazia' });
    }

    let contacts = contactsResult.rows;

    // Remove duplicates based on phone number
    const seenPhones = new Set();
    const seenContactIds = new Set();
    contacts = contacts.filter(contact => {
      const phone = String(contact.phone || '').trim();
      const contactId = contact.id;
      if (!phone || seenPhones.has(phone) || seenContactIds.has(contactId)) return false;
      seenPhones.add(phone);
      seenContactIds.add(contactId);
      return true;
    });

    // Shuffle contacts if random_order is enabled
    if (random_order) {
      contacts = contacts.sort(() => Math.random() - 0.5);
    }

    // Calculate schedule parameters
    const minDelayVal = min_delay || 120;
    const maxDelayVal = max_delay || 300;
    const pauseAfter = pause_after_messages || 20;
    const pauseDur = (pause_duration || 10) * 60; // Convert to seconds

    // =========================================================
    // Timezone handling
    // We always store scheduled_at as UTC (ISO) in DB.
    // Inputs (start_date/start_time) are treated as America/Sao_Paulo.
    // Server timezone might be UTC, so we must NEVER use getHours/setHours.
    // =========================================================
    const SP_OFFSET_MS = -3 * 60 * 60 * 1000; // São Paulo is UTC-3 (fixed)

    const toSaoPauloDate = (utcDate) => new Date(utcDate.getTime() + SP_OFFSET_MS);
    const fromSaoPauloDate = (spDate) => new Date(spDate.getTime() - SP_OFFSET_MS);

    const getTodayInSaoPaulo = () => {
      const spNow = toSaoPauloDate(new Date());
      return {
        year: spNow.getUTCFullYear(),
        month: spNow.getUTCMonth() + 1,
        day: spNow.getUTCDate(),
      };
    };

    const makeUtcFromSaoPauloLocal = (dateStr, timeStr) => {
      const [hours, minutes] = (timeStr || '00:00').split(':').map(Number);

      let year;
      let month;
      let day;

      if (dateStr) {
        [year, month, day] = dateStr.split('-').map(Number);
      } else {
        const today = getTodayInSaoPaulo();
        year = today.year;
        month = today.month;
        day = today.day;
      }

      // Create a date as if São Paulo local were UTC, then shift back to real UTC.
      const spAsUtcMs = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
      return new Date(spAsUtcMs - SP_OFFSET_MS);
    };

    // Determine start time (UTC Date)
    let currentScheduleTime;

    if (start_date && start_time) {
      currentScheduleTime = makeUtcFromSaoPauloLocal(start_date, start_time);
    } else if (start_date) {
      currentScheduleTime = makeUtcFromSaoPauloLocal(start_date, '00:00');
    } else if (start_time) {
      currentScheduleTime = makeUtcFromSaoPauloLocal(null, start_time);
    } else {
      // Use "NOW" from DB to ensure synchronicity with the scheduler
      const nowDb = await query('SELECT NOW()');
      currentScheduleTime = new Date(nowDb.rows[0].now);
    }

    // Parse time bounds (São Paulo clock)
    const startTimeHours = start_time ? parseInt(start_time.split(':')[0]) : 0;
    const startTimeMinutes = start_time ? parseInt(start_time.split(':')[1]) : 0;
    const endTimeHours = end_time ? parseInt(end_time.split(':')[0]) : 23;
    const endTimeMinutes = end_time ? parseInt(end_time.split(':')[1]) : 59;

    // Get current time from DB for comparison
    const nowDbResult = await query('SELECT NOW()');
    const now = new Date(nowDbResult.rows[0].now);

    // Only adjust if scheduled time is in the past
    if (currentScheduleTime < now) {
      if (start_time) {
        // Try today with the specified time (São Paulo)
        currentScheduleTime = makeUtcFromSaoPauloLocal(null, start_time);

        // If that time already passed today, use current time
        if (currentScheduleTime < now) {
          currentScheduleTime = now;
        }
      } else {
        currentScheduleTime = new Date(nowDb.rows[0].now);
      }
    }

    const scheduledStartSp = toSaoPauloDate(currentScheduleTime);

    // Determine initial campaign status
    // If no start_date is provided, start immediately as 'running'
    // If start_date is today and within time window, also start immediately
    // Otherwise, schedule for future as 'pending'
    let initialStatus = 'pending';
    
    const nowSp = toSaoPauloDate(now);
    const nowSpHour = nowSp.getUTCHours();
    const nowSpMinute = nowSp.getUTCMinutes();
    const nowSpTotalMinutes = nowSpHour * 60 + nowSpMinute;
    const startTotalMinutes = startTimeHours * 60 + startTimeMinutes;
    const endTotalMinutes = endTimeHours * 60 + endTimeMinutes;
    
    if (!start_date) {
      // No start date = start immediately
      initialStatus = 'running';
    } else {
      const today = getTodayInSaoPaulo();
      const [startYear, startMonth, startDay] = start_date.split('-').map(Number);
      const isToday = startYear === today.year && startMonth === today.month && startDay === today.day;
      
      if (isToday && nowSpTotalMinutes >= startTotalMinutes && nowSpTotalMinutes <= endTotalMinutes) {
        // Start date is today and we're within the time window
        initialStatus = 'running';
      }
    }

    console.log('Campaign scheduling:', {
      start_date,
      start_time,
      end_time,
      initialStatus,
      scheduledStartUtc: currentScheduleTime.toISOString(),
      scheduledStartSp: `${scheduledStartSp.getUTCFullYear()}-${String(scheduledStartSp.getUTCMonth() + 1).padStart(2, '0')}-${String(scheduledStartSp.getUTCDate()).padStart(2, '0')} ${String(scheduledStartSp.getUTCHours()).padStart(2, '0')}:${String(scheduledStartSp.getUTCMinutes()).padStart(2, '0')}`,
      nowUtc: now.toISOString(),
    });

    // Create campaign
    const campaignResult = await query(
      `INSERT INTO campaigns 
       (user_id, name, connection_id, list_id, message_id, flow_id, status, scheduled_at, 
        start_date, end_date, start_time, end_time,
        min_delay, max_delay, pause_after_messages, pause_duration, random_order,
        meta_template_id, meta_template_name, meta_template_language, meta_template_components, meta_template_params)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) 
       RETURNING *`,
      [
        req.userId, 
        name, 
        connection_id, 
        list_id, 
        (isFlowCampaign || isTemplateCampaign) ? null : finalMessageId,
        isFlowCampaign ? flow_id : null,
        initialStatus,
        scheduled_at || null,
        start_date || null,
        end_date || null,
        start_time || null,
        end_time || null,
        minDelayVal,
        maxDelayVal,
        pauseAfter,
        pause_duration || 10,
        random_order || false,
        isTemplateCampaign ? meta_template_id : null,
        isTemplateCampaign ? metaTemplate.name : null,
        isTemplateCampaign ? metaTemplate.language : null,
        isTemplateCampaign ? JSON.stringify(metaTemplate.components || []) : null,
        isTemplateCampaign ? JSON.stringify(meta_template_params || {}) : null,
      ]
    );

    const campaign = campaignResult.rows[0];

    // Pre-allocate messages for each contact with scheduled times
    const campaignMessages = [];
    let messagesSincePause = 0;

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      
      // Assign message (random if multiple messages selected) - null for flow campaigns
      let assignedMessageId = null;
      if (!isFlowCampaign) {
        assignedMessageId = finalMessageId;
        if (allMessageIds.length > 1 && random_messages) {
          assignedMessageId = allMessageIds[Math.floor(Math.random() * allMessageIds.length)];
        } else if (allMessageIds.length > 1) {
          // Round-robin distribution
          assignedMessageId = allMessageIds[i % allMessageIds.length];
        }
      }

      // Check if we need to respect time bounds (using São Paulo clock)
      let spTime = toSaoPauloDate(currentScheduleTime);
      let scheduleHour = spTime.getUTCHours();
      let scheduleMinute = spTime.getUTCMinutes();

      // If past end time, move to next day's start time
      if (scheduleHour > endTimeHours || (scheduleHour === endTimeHours && scheduleMinute > endTimeMinutes)) {
        spTime.setUTCDate(spTime.getUTCDate() + 1);
        spTime.setUTCHours(startTimeHours, startTimeMinutes, 0, 0);
        currentScheduleTime = fromSaoPauloDate(spTime);
      }

      // Recompute after potential day-shift
      spTime = toSaoPauloDate(currentScheduleTime);
      scheduleHour = spTime.getUTCHours();
      scheduleMinute = spTime.getUTCMinutes();

      // If before start time, move to start time
      if (scheduleHour < startTimeHours || (scheduleHour === startTimeHours && scheduleMinute < startTimeMinutes)) {
        spTime.setUTCHours(startTimeHours, startTimeMinutes, 0, 0);
        currentScheduleTime = fromSaoPauloDate(spTime);
      }

      campaignMessages.push({
        contact_id: contact.id,
        phone: contact.phone,
        message_id: assignedMessageId,
        scheduled_at: new Date(currentScheduleTime).toISOString()
      });

      // Calculate next message time
      const delay = Math.floor(Math.random() * (maxDelayVal - minDelayVal + 1)) + minDelayVal;
      currentScheduleTime = new Date(currentScheduleTime.getTime() + delay * 1000);
      messagesSincePause++;

      // Add pause if needed
      if (messagesSincePause >= pauseAfter && i < contacts.length - 1) {
        currentScheduleTime = new Date(currentScheduleTime.getTime() + pauseDur * 1000);
        messagesSincePause = 0;
      }
    }

    // Insert all campaign messages
    if (campaignMessages.length > 0) {
      const values = campaignMessages.map((_, i) => 
        `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`
      ).join(', ');
      
      const insertParams = [
        campaign.id,
        ...campaignMessages.flatMap(m => [m.contact_id, m.phone, m.message_id, m.scheduled_at])
      ];

      await query(
        `INSERT INTO campaign_messages (campaign_id, contact_id, phone, message_id, scheduled_at) 
         VALUES ${values}`,
        insertParams
      );
    }

    res.status(201).json({
      ...campaign,
      total_messages: campaignMessages.length,
      estimated_completion: campaignMessages.length > 0 
        ? campaignMessages[campaignMessages.length - 1].scheduled_at 
        : null
    });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ error: 'Erro ao criar campanha' });
  }
});

// Update campaign status
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'running', 'paused', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    const org = await getUserOrganization(req.userId);

    const isOwnerOrAdmin = org && ['owner', 'admin'].includes(org.role);
    
    let whereClause = 'id = $2 AND user_id = $3';
    let params = [status, id, req.userId];

    if (isOwnerOrAdmin) {
      whereClause = `id = $2 AND (user_id = $3 OR connection_id IN (
        SELECT id FROM connections WHERE organization_id = $4
      ))`;
      params = [status, id, req.userId, org.organization_id];
    } else if (org) {
      // Not admin, must be creator
      whereClause = 'id = $2 AND user_id = $3';
      params = [status, id, req.userId];
    }

    // If starting/resuming campaign, recalculate pending message times from now
    if (status === 'running') {
      // Get campaign details
      const campaignResult = await query(
        `SELECT * FROM campaigns WHERE id = $1`,
        [id]
      );
      
      if (campaignResult.rows.length > 0) {
        const campaign = campaignResult.rows[0];
        
        // Get pending messages ordered by their original schedule
        const pendingMessages = await query(
          `SELECT id FROM campaign_messages 
           WHERE campaign_id = $1 AND status = 'pending'
           ORDER BY scheduled_at ASC`,
          [id]
        );
        
        if (pendingMessages.rows.length > 0) {
          const minDelay = campaign.min_delay || 120;
          const maxDelay = campaign.max_delay || 300;
          const pauseAfter = campaign.pause_after_messages || 20;
          const pauseDuration = (campaign.pause_duration || 10) * 60; // seconds
          
          const SP_OFFSET_MS = -3 * 60 * 60 * 1000;
          const toSaoPauloDate = (utcDate) => new Date(utcDate.getTime() + SP_OFFSET_MS);
          const fromSaoPauloDate = (spDate) => new Date(spDate.getTime() - SP_OFFSET_MS);
          
          // Parse time bounds
          const startTimeHours = campaign.start_time ? parseInt(campaign.start_time.split(':')[0]) : 0;
          const startTimeMinutes = campaign.start_time ? parseInt(campaign.start_time.split(':')[1]) : 0;
          const endTimeHours = campaign.end_time ? parseInt(campaign.end_time.split(':')[0]) : 23;
          const endTimeMinutes = campaign.end_time ? parseInt(campaign.end_time.split(':')[1]) : 59;
          
          // Start from now
          let currentTime = new Date();
          let messagesSincePause = 0;
          
          // Update each pending message with new scheduled time
          for (let i = 0; i < pendingMessages.rows.length; i++) {
            const msgId = pendingMessages.rows[i].id;
            
            // Enforce time window
            let spTime = toSaoPauloDate(currentTime);
            let scheduleHour = spTime.getUTCHours();
            let scheduleMinute = spTime.getUTCMinutes();
            
            // Past end time → next day start
            if (scheduleHour > endTimeHours || (scheduleHour === endTimeHours && scheduleMinute > endTimeMinutes)) {
              spTime.setUTCDate(spTime.getUTCDate() + 1);
              spTime.setUTCHours(startTimeHours, startTimeMinutes, 0, 0);
              currentTime = fromSaoPauloDate(spTime);
            }
            
            // Before start time → move to start
            spTime = toSaoPauloDate(currentTime);
            scheduleHour = spTime.getUTCHours();
            scheduleMinute = spTime.getUTCMinutes();
            if (scheduleHour < startTimeHours || (scheduleHour === startTimeHours && scheduleMinute < startTimeMinutes)) {
              spTime.setUTCHours(startTimeHours, startTimeMinutes, 0, 0);
              currentTime = fromSaoPauloDate(spTime);
            }
            
            await query(
              `UPDATE campaign_messages SET scheduled_at = $1 WHERE id = $2`,
              [currentTime.toISOString(), msgId]
            );
            
            // Calculate next time
            const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            currentTime = new Date(currentTime.getTime() + delay * 1000);
            messagesSincePause++;
            
            // Add pause if needed
            if (messagesSincePause >= pauseAfter && i < pendingMessages.rows.length - 1) {
              currentTime = new Date(currentTime.getTime() + pauseDuration * 1000);
              messagesSincePause = 0;
            }
          }
          
          console.log(`Recalculated ${pendingMessages.rows.length} message times for campaign ${id} (respecting ${campaign.start_time}-${campaign.end_time} window)`);
        }
      }
    }

    const result = await query(
      `UPDATE campaigns 
       SET status = $1, updated_at = NOW()
       WHERE ${whereClause}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campanha não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update campaign status error:', error);
    res.status(500).json({ error: 'Erro ao atualizar campanha' });
  }
});

// Get campaign stats
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    const org = await getUserOrganization(req.userId);

    let whereClause = 'id = $1 AND user_id = $2';
    let params = [id, req.userId];

    if (org) {
      whereClause = `id = $1 AND (user_id = $2 OR connection_id IN (
        SELECT id FROM connections WHERE organization_id = $3
      ))`;
      params = [id, req.userId, org.organization_id];
    }

    const campaign = await query(
      `SELECT * FROM campaigns WHERE ${whereClause}`,
      params
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ error: 'Campanha não encontrada' });
    }

    const stats = await query(
      `SELECT 
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'sent') as sent,
         COUNT(*) FILTER (WHERE status = 'failed') as failed,
         COUNT(*) FILTER (WHERE status = 'pending') as pending
       FROM campaign_messages WHERE campaign_id = $1`,
      [id]
    );

    res.json({
      campaign: campaign.rows[0],
      stats: stats.rows[0]
    });
  } catch (error) {
    console.error('Get campaign stats error:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// Get campaign details with all messages
router.get('/:id/details', async (req, res) => {
  try {
    const { id } = req.params;

    const org = await getUserOrganization(req.userId);

    let whereClause = 'c.id = $1 AND c.user_id = $2';
    let params = [id, req.userId];

    if (org) {
      whereClause = `c.id = $1 AND (c.user_id = $2 OR c.connection_id IN (
        SELECT id FROM connections WHERE organization_id = $3
      ))`;
      params = [id, req.userId, org.organization_id];
    }

    // Get campaign with related info
    const campaignResult = await query(
      `SELECT c.*, 
              cl.name as list_name,
              mt.name as message_name,
              conn.name as connection_name,
              (SELECT COUNT(*) FROM contacts WHERE list_id = c.list_id) as total_contacts
       FROM campaigns c
       LEFT JOIN contact_lists cl ON c.list_id = cl.id
       LEFT JOIN message_templates mt ON c.message_id = mt.id
       LEFT JOIN connections conn ON c.connection_id = conn.id
       WHERE ${whereClause}`,
      params
    );

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: 'Campanha não encontrada' });
    }

    const campaign = campaignResult.rows[0];

    // Get all campaign messages with contact info and message template
    const messagesResult = await query(
      `SELECT cm.*, 
              co.name as contact_name,
              mt.name as message_template_name
       FROM campaign_messages cm
       LEFT JOIN contacts co ON cm.contact_id = co.id
       LEFT JOIN message_templates mt ON cm.message_id = mt.id
       WHERE cm.campaign_id = $1
       ORDER BY cm.scheduled_at ASC NULLS LAST, cm.created_at ASC`,
      [id]
    );

    // Calculate stats
    const messages = messagesResult.rows;
    const stats = {
      total: messages.length,
      sent: messages.filter(m => m.status === 'sent').length,
      failed: messages.filter(m => m.status === 'failed').length,
      pending: messages.filter(m => m.status === 'pending').length,
    };

    // Calculate estimated completion time based on last scheduled message
    let estimatedCompletion = null;
    const pendingMessages = messages.filter(m => m.status === 'pending' && m.scheduled_at);
    if (campaign.status === 'running' && pendingMessages.length > 0) {
      // Get the last scheduled message time
      const lastScheduled = pendingMessages[pendingMessages.length - 1];
      estimatedCompletion = lastScheduled.scheduled_at;
    }

    res.json({
      campaign,
      messages,
      stats,
      estimatedCompletion,
    });
  } catch (error) {
    console.error('Get campaign details error:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes da campanha' });
  }
});

// Campaign reports/analytics
router.get('/reports/overview', async (req, res) => {
  try {
    const org = await getUserOrganization(req.userId);
    const { start_date, end_date } = req.query;

    let orgFilter = 'c.user_id = $1';
    let params = [req.userId];
    let paramIdx = 2;

    if (org) {
      orgFilter = `(c.user_id = $1 OR c.connection_id IN (
        SELECT id FROM connections WHERE organization_id = $${paramIdx}
      ))`;
      params.push(org.organization_id);
      paramIdx++;
    }

    let dateFilter = '';
    if (start_date) {
      dateFilter += ` AND c.created_at >= $${paramIdx}::date`;
      params.push(start_date);
      paramIdx++;
    }
    if (end_date) {
      dateFilter += ` AND c.created_at <= ($${paramIdx}::date + interval '1 day')`;
      params.push(end_date);
      paramIdx++;
    }

    const generalStats = await query(
      `SELECT 
         COUNT(*) as total_campaigns,
         COUNT(*) FILTER (WHERE c.status = 'completed') as completed_campaigns,
         COUNT(*) FILTER (WHERE c.status = 'running') as running_campaigns,
         COUNT(*) FILTER (WHERE c.status = 'paused') as paused_campaigns,
         COALESCE(SUM(c.sent_count), 0) as total_sent,
         COALESCE(SUM(c.failed_count), 0) as total_failed,
         CASE WHEN COALESCE(SUM(c.sent_count) + SUM(c.failed_count), 0) > 0 
           THEN ROUND(SUM(c.sent_count)::numeric / (SUM(c.sent_count) + SUM(c.failed_count)) * 100, 1)
           ELSE 0 END as success_rate
       FROM campaigns c
       WHERE ${orgFilter} ${dateFilter}`,
      params
    );

    const connectionStats = await query(
      `SELECT 
         conn.id as connection_id,
         conn.name as connection_name,
         conn.status as connection_status,
         COUNT(c.id) as campaign_count,
         COALESCE(SUM(c.sent_count), 0) as total_sent,
         COALESCE(SUM(c.failed_count), 0) as total_failed,
         CASE WHEN COALESCE(SUM(c.sent_count) + SUM(c.failed_count), 0) > 0 
           THEN ROUND(SUM(c.sent_count)::numeric / (SUM(c.sent_count) + SUM(c.failed_count)) * 100, 1)
           ELSE 0 END as success_rate
       FROM campaigns c
       JOIN connections conn ON conn.id = c.connection_id
       WHERE ${orgFilter} ${dateFilter}
       GROUP BY conn.id, conn.name, conn.status
       ORDER BY total_sent DESC`,
      params
    );

    const dailyStats = await query(
      `SELECT 
         DATE(c.created_at) as date,
         COUNT(c.id) as campaigns,
         COALESCE(SUM(c.sent_count), 0) as sent,
         COALESCE(SUM(c.failed_count), 0) as failed
       FROM campaigns c
       WHERE ${orgFilter} ${dateFilter}
       GROUP BY DATE(c.created_at)
       ORDER BY date DESC
       LIMIT 30`,
      params
    );

    const campaignList = await query(
      `SELECT 
         c.id, c.name, c.status, c.sent_count, c.failed_count,
         c.created_at, c.start_date, c.start_time, c.end_time,
         conn.name as connection_name,
         cl.name as list_name,
         (SELECT COUNT(*) FROM contacts WHERE list_id = c.list_id) as total_contacts,
         CASE WHEN (c.sent_count + c.failed_count) > 0
           THEN ROUND(c.sent_count::numeric / (c.sent_count + c.failed_count) * 100, 1)
           ELSE 0 END as success_rate
       FROM campaigns c
       LEFT JOIN connections conn ON conn.id = c.connection_id
       LEFT JOIN contact_lists cl ON c.list_id = cl.id
       WHERE ${orgFilter} ${dateFilter}
       ORDER BY c.created_at DESC`,
      params
    );

    res.json({
      general: generalStats.rows[0],
      connections: connectionStats.rows,
      daily: dailyStats.rows,
      campaigns: campaignList.rows,
    });
  } catch (error) {
    console.error('Campaign reports error:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// Update campaign (edit connection, reschedule)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { connection_id, start_date, end_date, start_time, end_time } = req.body;

    const org = await getUserOrganization(req.userId);

    let whereClause = 'id = $1 AND user_id = $2';
    let checkParams = [id, req.userId];

    if (org) {
      whereClause = `id = $1 AND (user_id = $2 OR connection_id IN (
        SELECT id FROM connections WHERE organization_id = $3
      ))`;
      checkParams = [id, req.userId, org.organization_id];
    }

    const existing = await query(`SELECT * FROM campaigns WHERE ${whereClause}`, checkParams);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Campanha não encontrada' });
    }

    const campaign = existing.rows[0];

    if (!['paused', 'pending'].includes(campaign.status)) {
      return res.status(400).json({ error: 'Só é possível editar campanhas pausadas ou agendadas' });
    }

    const updates = [];
    const updateParams = [];
    let pIdx = 1;

    if (connection_id) {
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
      updates.push(`connection_id = $${pIdx++}`);
      updateParams.push(connection_id);
    }

    if (start_date !== undefined) {
      updates.push(`start_date = $${pIdx++}`);
      updateParams.push(start_date || null);
    }
    if (end_date !== undefined) {
      updates.push(`end_date = $${pIdx++}`);
      updateParams.push(end_date || null);
    }
    if (start_time !== undefined) {
      updates.push(`start_time = $${pIdx++}`);
      updateParams.push(start_time || null);
    }
    if (end_time !== undefined) {
      updates.push(`end_time = $${pIdx++}`);
      updateParams.push(end_time || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push(`updated_at = NOW()`);
    updateParams.push(id);

    const result = await query(
      `UPDATE campaigns SET ${updates.join(', ')} WHERE id = $${pIdx} RETURNING *`,
      updateParams
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ error: 'Erro ao atualizar campanha' });
  }
});

// Delete campaign
router.delete('/:id', async (req, res) => {
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
      `DELETE FROM campaigns WHERE ${whereClause} RETURNING id`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campanha não encontrada' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({ error: 'Erro ao deletar campanha' });
  }
});

export default router;
