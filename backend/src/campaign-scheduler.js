import { query } from './db.js';
import * as whatsappProvider from './lib/whatsapp-provider.js';
import * as uazapiProvider from './lib/uazapi-provider.js';
import { executeFlow } from './lib/flow-executor.js';
import { sendMetaTemplate } from './lib/meta-template-send.js';
// Translation map for common Evolution API errors
const errorTranslations = {
  'not a whatsapp number': 'Número não é WhatsApp',
  'number not on whatsapp': 'Número não é WhatsApp',
  'not on whatsapp': 'Número não é WhatsApp',
  'connection closed': 'Conexão fechada',
  'disconnected': 'Desconectado',
  'instance not connected': 'Instância desconectada',
  'instance not found': 'Instância não encontrada',
  'invalid number': 'Número inválido',
  'number is invalid': 'Número inválido',
  'timeout': 'Tempo esgotado',
  'rate limit': 'Limite de envios excedido',
  'blocked': 'Número bloqueado',
  'chat not found': 'Chat não encontrado',
  'media not found': 'Mídia não encontrada',
  'unauthorized': 'Não autorizado',
  'forbidden': 'Acesso negado',
};

function translateError(error) {
  if (!error) return 'Erro desconhecido';
  const lowerError = error.toLowerCase();
  for (const [key, translation] of Object.entries(errorTranslations)) {
    if (lowerError.includes(key)) {
      return translation;
    }
  }
  return error;
}

// Replace variables in message content
function replaceVariables(text, contact) {
  if (!text) return text;
  
  return text
    .replace(/\{\{?\s*nome\s*\}?\}/gi, contact.name || '')
    .replace(/\{\{?\s*telefone\s*\}?\}/gi, contact.phone || '')
    .replace(/\{\{?\s*email\s*\}?\}/gi, contact.email || '')
    .replace(/\{\{?\s*empresa\s*\}?\}/gi, contact.company || '')
    .replace(/\{\{?\s*cargo\s*\}?\}/gi, contact.position || '')
    .replace(/\{\{?\s*observacao\s*\}?\}/gi, contact.notes || '')
    .replace(/\{\{?\s*obs\s*\}?\}/gi, contact.notes || '');
}

// Helper to send message via unified WhatsApp provider
async function sendWhatsAppMessage(connection, phone, messageItems, contact) {
  const results = [];
  
  // Expand gallery items into individual image messages
  const expandedItems = [];
  for (const item of messageItems) {
    if (item.type === 'gallery' && item.galleryImages && item.galleryImages.length > 0) {
      // Each gallery image becomes a separate image message
      item.galleryImages.forEach((img, idx) => {
        expandedItems.push({
          type: 'image',
          mediaUrl: img.url,
          media_url: img.url,
          caption: idx === 0 ? item.caption : undefined, // Caption only on first image
          content: idx === 0 ? item.caption : undefined,
        });
      });
    } else {
      expandedItems.push(item);
    }
  }

  for (const item of expandedItems) {
    try {
      const remoteJid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;

      // Support both camelCase (frontend) and snake_case formats
      const mediaUrl = item.mediaUrl || item.media_url;

      // Replace variables in content
      const processedContent = replaceVariables(item.content || item.caption, contact);

      let result;

      // UAZAPI exclusive interactive types
      if (item.type === 'buttons' || item.type === 'list' || item.type === 'poll') {
        const provider = whatsappProvider.detectProvider(connection);
        if (provider !== 'uazapi') {
          result = { success: false, error: `Tipo "${item.type}" requer conexão UAZAPI` };
        } else if (item.type === 'buttons') {
          result = await uazapiProvider.sendButtons(
            connection.uazapi_url,
            connection.uazapi_token,
            phone,
            processedContent || '',
            (item.options || []).map((o) => o.label),
            { footer: item.footer }
          );
        } else if (item.type === 'list') {
          result = await uazapiProvider.sendList(
            connection.uazapi_url,
            connection.uazapi_token,
            phone,
            processedContent || '',
            (item.options || []).map((o) => o.label),
            { buttonText: item.buttonText || 'Ver opções', footer: item.footer }
          );
        } else {
          result = await uazapiProvider.sendPoll(
            connection.uazapi_url,
            connection.uazapi_token,
            phone,
            processedContent || '',
            (item.options || []).map((o) => o.label),
            { multiSelect: !!item.multiSelect }
          );
        }
      } else {
        result = await whatsappProvider.sendMessage(
          connection,
          remoteJid,
          processedContent,
          item.type,
          mediaUrl
        );
      }

      results.push({ success: result.success, item, error: result.error, messageId: result.messageId });

      // Small delay between items of same message
      if (expandedItems.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (error) {
      console.error('WhatsApp provider error for item:', error);
      results.push({ success: false, item, error: error.message });
    }
  }

  // Message is successful if at least the first item was sent
  const firstResult = results[0];
  return {
    success: firstResult?.success || false,
    error: firstResult?.error,
    results,
  };
}

// Execute pending campaign messages
export async function executeCampaignMessages() {
  const stats = {
    processed: 0,
    sent: 0,
    failed: 0,
    campaignsStarted: 0,
    connectionLost: 0,
  };

  try {
    // Check running campaigns for offline connections and auto-pause them
    const runningCampaigns = await query(`
      SELECT DISTINCT c.id, c.name, c.connection_id, 
             conn.status as connection_status, conn.instance_id, conn.wapi_token, conn.provider,
             conn.uazapi_url, conn.uazapi_token,
             conn.name as connection_name
      FROM campaigns c
      JOIN connections conn ON conn.id = c.connection_id
      WHERE c.status = 'running'
    `);

    for (const campaign of runningCampaigns.rows) {
      const provider = whatsappProvider.detectProvider(campaign);
      const isConnected = campaign.connection_status === 'connected' || 
        (provider === 'wapi' && campaign.instance_id && campaign.wapi_token);

      if (!isConnected) {
        await query(
          `UPDATE campaigns SET status = 'paused', updated_at = NOW() WHERE id = $1`,
          [campaign.id]
        );

        const ownerResult = await query(`SELECT user_id FROM campaigns WHERE id = $1`, [campaign.id]);
        if (ownerResult.rows.length > 0) {
          await query(
            `INSERT INTO user_alerts (user_id, type, title, message, metadata)
             VALUES ($1, 'campaign_connection_lost', $2, $3, $4)`,
            [
              ownerResult.rows[0].user_id,
              '⚠️ Campanha pausada - Conexão offline',
              `A campanha "${campaign.name}" foi pausada porque a conexão "${campaign.connection_name}" ficou offline.`,
              JSON.stringify({
                campaign_id: campaign.id,
                connection_id: campaign.connection_id,
                connection_name: campaign.connection_name,
              })
            ]
          );
        }

        stats.connectionLost++;
        console.log(`📤 [CAMPAIGN] Auto-paused campaign "${campaign.name}" - connection offline`);
      }
    }

    // Auto-start campaigns that have pending messages with scheduled_at <= NOW()
    // We add a 5-minute buffer to handle minor timezone or clock skews
    const campaignsToStart = await query(`
      SELECT DISTINCT c.id, c.name, c.connection_id
      FROM campaigns c
      JOIN campaign_messages cm ON cm.campaign_id = c.id
      WHERE c.status = 'pending'
        AND cm.status = 'pending'
        AND cm.scheduled_at <= (NOW() + INTERVAL '10 minutes')
    `);

    if (campaignsToStart.rows.length > 0) {
      for (const campaign of campaignsToStart.rows) {
        // Double check if connection is valid for this campaign
        const conn = await query('SELECT status, provider, meta_token FROM connections WHERE id = $1', [campaign.connection_id]);
        const connection = conn.rows[0];
        
        if (!connection) {
          console.log(`  ⚠ [CAMPAIGN] Skipping auto-start for "${campaign.name}" - connection not found`);
          continue;
        }

        await query(
          `UPDATE campaigns SET status = 'running', updated_at = NOW() WHERE id = $1`,
          [campaign.id]
        );
        stats.campaignsStarted++;
        console.log(`📤 [CAMPAIGN] Auto-started campaign: ${campaign.name} (Connection: ${connection.provider})`);
      }
    }

    // Get pending messages that should be sent now (scheduled_at <= now)
    // Include contact data for variable replacement
    // NOTE: Some deployments may not have contacts.email yet; we fallback gracefully.
    // For W-API, accept connections with instance_id/wapi_token even if status not 'connected'
    const pendingMessagesSqlBase = `
      SELECT 
        cm.id,
        cm.campaign_id,
        cm.contact_id,
        cm.phone,
        cm.message_id,
        cm.scheduled_at,
        c.status as campaign_status,
        c.connection_id,
        c.flow_id,
        c.meta_template_id,
        c.meta_template_name,
        c.meta_template_language,
        c.meta_template_components,
        c.meta_template_params,
        conn.provider,
        conn.api_url,
        conn.api_key,
        conn.instance_name,
        conn.instance_id,
        conn.wapi_token,
        conn.uazapi_url,
        conn.uazapi_token,
        conn.meta_token,
        conn.meta_phone_number_id,
        conn.status as connection_status,
        mt.items as message_items,
        co.name as contact_name,
        co.phone as contact_phone,
        {{CONTACT_EMAIL_SELECT}}
      FROM campaign_messages cm
      JOIN campaigns c ON c.id = cm.campaign_id
      JOIN connections conn ON conn.id = c.connection_id
      LEFT JOIN message_templates mt ON mt.id = cm.message_id
      LEFT JOIN contacts co ON co.id = cm.contact_id
      WHERE cm.status = 'pending'
        AND cm.scheduled_at <= (NOW() + INTERVAL '10 minutes')
        AND c.status = 'running'
        AND (
          conn.status = 'connected' 
          OR (conn.instance_id IS NOT NULL AND conn.wapi_token IS NOT NULL) 
          OR (conn.uazapi_url IS NOT NULL AND conn.uazapi_token IS NOT NULL) 
          OR (conn.provider = 'meta' AND conn.meta_token IS NOT NULL AND conn.meta_phone_number_id IS NOT NULL)
        )
        AND (co.id IS NULL OR co.is_whatsapp IS NOT FALSE) -- Skip only if explicitly marked as not WhatsApp
        AND c.connection_id IS NOT NULL -- Safety filter
      ORDER BY cm.scheduled_at ASC
      LIMIT 50
    `;

    let pendingMessages;
    try {
      pendingMessages = await query(
        pendingMessagesSqlBase.replace('{{CONTACT_EMAIL_SELECT}}', 'co.email as contact_email')
      );
    } catch (error) {
      const isMissingEmailColumn =
        error?.code === '42703' &&
        typeof error?.message === 'string' &&
        (error.message.includes('co.email') || error.message.includes('column') && error.message.includes('email'));

      if (!isMissingEmailColumn) throw error;

      console.warn(
        '📤 [CAMPAIGN] contacts.email column missing; falling back to NULL contact_email. Consider migrating DB to add contacts.email.'
      );

      pendingMessages = await query(
        pendingMessagesSqlBase.replace('{{CONTACT_EMAIL_SELECT}}', "NULL::text as contact_email")
      );
    }

    if (pendingMessages.rows.length === 0) {
      if (stats.campaignsStarted > 0) {
        console.log(`📤 [CAMPAIGN] ${stats.campaignsStarted} campaign(s) started, processing on next cycle.`);
      }
      
      // LOGGING FOR DIAGNOSTICS: Check if there are messages that SHOULD be processed but aren't due to connection status
      if (stats.campaignsStarted === 0) {
        const checkBlocked = await query(`
          SELECT count(*) as blocked_count 
          FROM campaign_messages cm
          JOIN campaigns c ON c.id = cm.campaign_id
          WHERE cm.status = 'pending' 
            AND cm.scheduled_at <= (NOW() + INTERVAL '10 minutes')
            AND c.status = 'running'
            AND c.connection_id IS NOT NULL
        `);
        if (parseInt(checkBlocked.rows[0].blocked_count) > 0) {
          console.log(`  ⚠ [CAMPAIGN] Found ${checkBlocked.rows[0].blocked_count} messages that are pending/running but didn't pass connection or contact filters.`);
        }
      }
      return stats;
    }

    console.log(`📤 [CAMPAIGN] Found ${pendingMessages.rows.length} messages to process. Server Time: ${new Date().toISOString()}`);

    for (const msg of pendingMessages.rows) {
      // Step 1: Atomic update to 'processing' to prevent race conditions between scheduler cycles
      // A message is only processing if its status is 'processing' AND it was updated in the last 15 minutes.
      // If it has been 'processing' for more than 15 minutes, it's considered stuck and we retry it.
      const lockResult = await query(
        `UPDATE campaign_messages 
         SET status = 'processing'
         WHERE id = $1 AND (status = 'pending' OR (status = 'processing' AND created_at < NOW() - INTERVAL '15 minutes'))
         RETURNING id`,
        [msg.id]
      );

      if (lockResult.rows.length === 0) {
        console.log(`  ⚠ [${msg.phone}] Message already being processed or locked by another cycle, skipping.`);
        continue;
      }

      // Step 2: Double-check if this contact already received a message for THIS campaign
      // (Safety net for duplicate list entries or multiple campaign_messages for same contact)
      const alreadySent = await query(
        `SELECT id FROM campaign_messages 
         WHERE campaign_id = $1 AND contact_id = $2 AND status = 'sent' AND id != $3
         LIMIT 1`,
        [msg.campaign_id, msg.contact_id, msg.id]
      );

      if (alreadySent.rows.length > 0) {
        console.log(`  ⚠ [${msg.phone}] Contact already received a message for this campaign, marking duplicate as cancelled.`);
        await query(
          `UPDATE campaign_messages SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [msg.id]
        );
        continue;
      }

      stats.processed++;

      try {
        // Build contact object early for reuse
        const contactObj = {
          name: msg.contact_name || '',
          phone: msg.phone || '',
          email: msg.contact_email || '',
        };

        // ============ META TEMPLATE CAMPAIGN ============
        if (msg.meta_template_id) {
          try {
            const tplComponents = typeof msg.meta_template_components === 'string'
              ? JSON.parse(msg.meta_template_components)
              : (msg.meta_template_components || []);
            const tplParams = typeof msg.meta_template_params === 'string'
              ? JSON.parse(msg.meta_template_params)
              : (msg.meta_template_params || {});

            const { metaMessageId, readable } = await sendMetaTemplate({
              metaToken: msg.meta_token,
              metaPhoneNumberId: msg.meta_phone_number_id,
              toPhone: msg.phone,
              templateName: msg.meta_template_name,
              language: msg.meta_template_language,
              components: tplComponents,
              paramValues: tplParams,
              contact: contactObj,
            });

            // Persist a chat_messages row so the conversation has history
            try {
              const remoteJid = msg.phone.includes('@') ? msg.phone : `${msg.phone}@s.whatsapp.net`;
              let conv = await query(
                `SELECT id FROM conversations WHERE connection_id = $1 AND remote_jid = $2`,
                [msg.connection_id, remoteJid]
              );
              let convId;
              if (conv.rows.length === 0) {
                const newConv = await query(
                  `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone, last_message_at, updated_at)
                   VALUES ($1, $2, $3, $4, NOW(), NOW())
                   RETURNING id`,
                  [msg.connection_id, remoteJid, msg.contact_name || '', msg.phone]
                );
                convId = newConv.rows[0].id;
              } else {
                convId = conv.rows[0].id;
              }
              await query(
                `INSERT INTO chat_messages (conversation_id, message_id, from_me, content, message_type, status, timestamp)
                 VALUES ($1, $2, true, $3, 'text', 'sent', NOW())`,
                [convId, metaMessageId, `📋 ${readable}`]
              );
              await query(
                `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
                [convId]
              );
            } catch (persistErr) {
              console.warn('  ⚠ falha ao salvar histórico do template:', persistErr.message);
            }

            await query(
              `UPDATE campaign_messages SET status = 'sent', sent_at = NOW() WHERE id = $1`,
              [msg.id]
            );
            await query(
              `UPDATE campaigns SET sent_count = sent_count + 1, updated_at = NOW() WHERE id = $1`,
              [msg.campaign_id]
            );
            stats.sent++;
            console.log(`  ✓ [${msg.phone}] Template "${msg.meta_template_name}" enviado`);
          } catch (tplErr) {
            const errorMsg = translateError(tplErr.message || 'Erro ao enviar template');
            const isDefinitiveError = 
              errorMsg.includes('Número não é WhatsApp') || 
              errorMsg.includes('Número inválido') || 
              errorMsg.includes('Não autorizado') ||
              errorMsg.includes('Acesso negado');

            await query(
              `UPDATE campaign_messages SET status = 'failed', error_message = $1, sent_at = NOW() WHERE id = $2`,
              [errorMsg, msg.id]
            );
            await query(
              `UPDATE campaigns SET failed_count = failed_count + 1, updated_at = NOW() WHERE id = $1`,
              [msg.campaign_id]
            );

            // If it's a connection error or authentication error, pause the campaign
            const isAuthError = tplErr.status === 401 || (tplErr.metaError && tplErr.metaError.code === 190);
            const isConnError = errorMsg.includes('Conexão fechada') || errorMsg.includes('Desconectado');

            if (isAuthError || isConnError) {
              console.log(`  ⚠ [CAMPAIGN] Pausing campaign ${msg.campaign_id} due to ${isAuthError ? 'Auth' : 'Connection'} error: ${errorMsg}`);
              await query(
                `UPDATE campaigns SET status = 'paused', updated_at = NOW() WHERE id = $1`,
                [msg.campaign_id]
              );
              // Also reset processing messages for this campaign to pending so they can be retried once fixed
              await query(
                `UPDATE campaign_messages SET status = 'pending', updated_at = NOW() 
                 WHERE campaign_id = $1 AND status = 'processing'`,
                [msg.campaign_id]
              );
            }

            stats.failed++;
            console.log(`  ✗ [${msg.phone}] ${errorMsg}`);
          }
          continue;
        }

        // Check if this is a flow-based campaign
        if (msg.flow_id) {
          // Execute flow for this contact
          const remoteJid = msg.phone.includes('@') ? msg.phone : `${msg.phone}@s.whatsapp.net`;
          
          // Find or create conversation for this contact
          let conversation = await query(
            `SELECT id FROM conversations WHERE connection_id = $1 AND remote_jid = $2`,
            [msg.connection_id, remoteJid]
          );
          
          let conversationId;
          if (conversation.rows.length === 0) {
            // Create a new conversation for campaign flow
            const newConv = await query(
              `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone)
               VALUES ($1, $2, $3, $4)
               RETURNING id`,
              [msg.connection_id, remoteJid, msg.contact_name || '', msg.phone]
            );
            conversationId = newConv.rows[0].id;
          } else {
            conversationId = conversation.rows[0].id;
          }

          // Set contact variables in flow session
          const initialVariables = {
            nome: msg.contact_name || '',
            telefone: msg.phone || '',
            email: msg.contact_email || '',
          };

          // Execute flow
          const flowResult = await executeFlow(msg.flow_id, conversationId, 'start', initialVariables);
          
          if (flowResult.success !== false) {
            await query(
              `UPDATE campaign_messages 
               SET status = 'sent', sent_at = NOW()
               WHERE id = $1`,
              [msg.id]
            );
            stats.sent++;
            console.log(`  ✓ [${msg.phone}] Fluxo iniciado`);

            // Update campaign sent_count
            await query(
              `UPDATE campaigns SET sent_count = sent_count + 1, updated_at = NOW() WHERE id = $1`,
              [msg.campaign_id]
            );
          } else {
            const errorMsg = flowResult.error || 'Erro ao executar fluxo';
            await query(
              `UPDATE campaign_messages 
               SET status = 'failed', error_message = $1, sent_at = NOW()
               WHERE id = $2`,
              [errorMsg, msg.id]
            );
            stats.failed++;
            console.log(`  ✗ [${msg.phone}] ${errorMsg}`);

            await query(
              `UPDATE campaigns SET failed_count = failed_count + 1, updated_at = NOW() WHERE id = $1`,
              [msg.campaign_id]
            );
          }
          continue;
        }

        // Regular message-based campaign
        const messageItems = msg.message_items || [];
        
        if (messageItems.length === 0) {
          // Mark as failed - no content
          await query(
            `UPDATE campaign_messages 
             SET status = 'failed', error_message = 'Mensagem sem conteúdo', sent_at = NOW()
             WHERE id = $1`,
            [msg.id]
          );
          stats.failed++;
          console.log(`  ✗ [${msg.phone}] Mensagem sem conteúdo`);
          continue;
        }

        // Build connection object with all provider fields
        const connection = {
          provider: msg.provider,
          api_url: msg.api_url,
          api_key: msg.api_key,
          instance_name: msg.instance_name,
          instance_id: msg.instance_id,
          wapi_token: msg.wapi_token,
          uazapi_url: msg.uazapi_url,
          uazapi_token: msg.uazapi_token,
          meta_token: msg.meta_token,
          meta_phone_number_id: msg.meta_phone_number_id,
        };

        // Build contact object for variable replacement
        const contact = {
          name: msg.contact_name || '',
          phone: msg.phone || '',
          email: msg.contact_email || '',
          company: msg.contact_company || '',
          position: msg.contact_position || '',
          notes: msg.contact_notes || '',
        };

        // Send message using unified provider
        const result = await sendWhatsAppMessage(connection, msg.phone, messageItems, contact);

        if (result.success) {
          await query(
            `UPDATE campaign_messages 
             SET status = 'sent', sent_at = NOW()
             WHERE id = $1`,
            [msg.id]
          );
          stats.sent++;
          console.log(`  ✓ [${msg.phone}] Mensagem enviada (${messageItems.length} item(s))`);

          // Update campaign sent_count
          await query(
            `UPDATE campaigns SET sent_count = sent_count + 1, updated_at = NOW() WHERE id = $1`,
            [msg.campaign_id]
          );

          // Save sent messages to chat_messages so they appear in the chat UI
          const remoteJid = msg.phone.includes('@') ? msg.phone : `${msg.phone}@s.whatsapp.net`;
          
          // Find or create conversation
          let convResult = await query(
            `SELECT id FROM conversations WHERE connection_id = $1 AND remote_jid = $2`,
            [msg.connection_id, remoteJid]
          );
          
          let conversationId;
          if (convResult.rows.length === 0) {
            const newConv = await query(
              `INSERT INTO conversations (connection_id, remote_jid, contact_name, contact_phone)
               VALUES ($1, $2, $3, $4)
               RETURNING id`,
              [msg.connection_id, remoteJid, msg.contact_name || '', msg.phone]
            );
            conversationId = newConv.rows[0].id;
          } else {
            conversationId = convResult.rows[0].id;
          }

          // Save each sent item to chat_messages
          for (const r of (result.results || [])) {
            if (!r.success) continue;
            const item = r.item || {};
            const processedContent = replaceVariables(item.content || item.caption || '', contact);
            const mediaUrl = item.mediaUrl || item.media_url || null;
            const msgType = item.type || 'text';

            await query(
              `INSERT INTO chat_messages 
                (conversation_id, message_id, from_me, content, message_type, media_url, status, timestamp)
               VALUES ($1, $2, true, $3, $4, $5, 'sent', NOW())`,
              [
                conversationId,
                r.messageId || null,
                processedContent,
                msgType,
                mediaUrl,
              ]
            );
          }

          // Update conversation last_message_at
          await query(
            `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [conversationId]
          );
        } else {
          const translatedError = translateError(result.error);
          const isDefinitiveError = 
            translatedError.includes('Número não é WhatsApp') || 
            translatedError.includes('Número inválido') ||
            translatedError.includes('Não autorizado');

          await query(
            `UPDATE campaign_messages 
             SET status = 'failed', error_message = $1, sent_at = NOW()
             WHERE id = $2`,
            [translatedError, msg.id]
          );
          stats.failed++;
          console.log(`  ✗ [${msg.phone}] ${translatedError}`);

          // If connection is lost, pause campaign
          if (translatedError.includes('Conexão fechada') || translatedError.includes('Desconectado')) {
            await query(
              `UPDATE campaigns SET status = 'paused', updated_at = NOW() WHERE id = $1`,
              [msg.campaign_id]
            );
            // Reset other processing messages
            await query(
              `UPDATE campaign_messages SET status = 'pending', updated_at = NOW() 
               WHERE campaign_id = $1 AND status = 'processing'`,
              [msg.campaign_id]
            );
          }

          // Update campaign failed_count
          await query(
            `UPDATE campaigns SET failed_count = failed_count + 1, updated_at = NOW() WHERE id = $1`,
            [msg.campaign_id]
          );
        }
      } catch (error) {
        console.error(`  ✗ [${msg.phone}] Error:`, error);
        const translatedError = translateError(error.message);
        
        await query(
          `UPDATE campaign_messages 
           SET status = 'failed', error_message = $1, sent_at = NOW()
           WHERE id = $2`,
          [translatedError, msg.id]
        );
        stats.failed++;

        await query(
          `UPDATE campaigns SET failed_count = failed_count + 1, updated_at = NOW() WHERE id = $1`,
          [msg.campaign_id]
        );
      }
    }

    // Check if any campaigns are now complete
    await query(`
      UPDATE campaigns 
      SET status = 'completed', updated_at = NOW()
      WHERE status = 'running'
        AND id IN (
          SELECT campaign_id 
          FROM campaign_messages 
          GROUP BY campaign_id 
          HAVING COUNT(*) FILTER (WHERE status = 'pending') = 0
        )
    `);

    console.log(`📤 [CAMPAIGN] Execution complete:`, stats);
    return stats;
  } catch (error) {
    console.error('📤 [CAMPAIGN] Execution error:', error);
    throw error;
  }
}
