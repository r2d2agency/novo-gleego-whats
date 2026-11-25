import { query } from './db.js';
import * as whatsappProvider from './lib/whatsapp-provider.js';
import { buildTemplateComponents } from './lib/meta-template-send.js';

async function sendScheduledMetaTemplate(msg) {
  if (!msg.meta_token || !msg.meta_phone_number_id) {
    return { error: 'Conexão Meta sem token ou phone number ID configurado' };
  }
  const cleanPhone = String(msg.contact_phone || msg.remote_jid || '').replace(/\D/g, '');
  if (!cleanPhone) return { error: 'Telefone do contato não encontrado' };

  let components = null;
  let paramValues = {};
  try { components = msg.template_components ? JSON.parse(msg.template_components) : null; } catch {}
  try { paramValues = msg.template_params ? JSON.parse(msg.template_params) : {}; } catch {}

  const builtComponents = buildTemplateComponents(components || [], paramValues, {
    name: msg.contact_name,
    phone: cleanPhone,
  });
  const body = {
    messaging_product: 'whatsapp',
    to: cleanPhone,
    type: 'template',
    template: {
      name: msg.template_name,
      language: { code: msg.template_language || 'pt_BR' },
      ...(builtComponents.length ? { components: builtComponents } : {}),
    },
  };
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${msg.meta_phone_number_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${msg.meta_token}` },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = result?.error || {};
      return { error: err.error_user_msg || err.message || `HTTP ${response.status}` };
    }
    return { messageId: result?.messages?.[0]?.id || `template_scheduled_${msg.id}`, content: msg.content || msg.template_name };
  } catch (error) {
    return { error: error.message || 'Erro ao enviar template Meta' };
  }
}

// Send message via unified WhatsApp provider
async function sendWhatsAppMessage(connection, phone, content, messageType, mediaUrl) {
  return whatsappProvider.sendMessage(connection, phone, content, messageType, mediaUrl);
}

function getLocalMessageId(msg, result, suffix = '') {
  const provider = whatsappProvider.detectProvider(msg);

  // W-API often echoes outgoing messages by webhook using a different final id.
  // Keep a temporary scheduled id so the webhook can reconcile instead of inserting a duplicate.
  if (provider === 'wapi') {
    return `temp_scheduled_${msg.id}${suffix ? `_${suffix}` : ''}`;
  }

  return result?.messageId || `temp_scheduled_${msg.id}${suffix ? `_${suffix}` : ''}`;
}

async function insertScheduledChatMessage({ msg, result, suffix = '', content = null, messageType, mediaUrl = null, mediaMimetype = null }) {
  const provider = whatsappProvider.detectProvider(msg);

  // For W-API, the provider sends an outgoing webhook echo after the send.
  // If we also insert here, the chat shows the local copy first and then the
  // webhook copy about a minute later. Let the webhook be the single source.
  if (provider === 'wapi') {
    return;
  }

  await query(
    `INSERT INTO chat_messages 
      (conversation_id, message_id, from_me, sender_id, content, message_type, media_url, media_mimetype, status, timestamp)
     VALUES ($1, $2, true, $3, $4, $5, $6, $7, 'sent', NOW())
     ON CONFLICT (message_id) WHERE message_id IS NOT NULL AND message_id NOT LIKE 'temp_%'
     DO UPDATE SET
       status = 'sent',
       content = COALESCE(EXCLUDED.content, chat_messages.content),
       media_url = COALESCE(EXCLUDED.media_url, chat_messages.media_url),
       media_mimetype = COALESCE(EXCLUDED.media_mimetype, chat_messages.media_mimetype)`,
    [
      msg.conversation_id,
      getLocalMessageId(msg, result, suffix),
      msg.sender_id,
      content,
      messageType,
      mediaUrl,
      mediaMimetype,
    ]
  );
}

// Main function to execute scheduled messages
export async function executeScheduledMessages() {
  console.log('📅 [CRON] Checking scheduled messages...');
  
  const stats = {
    processed: 0,
    sent: 0,
    failed: 0,
  };

  try {
    // Recover messages claimed by a previous crashed/aborted worker.
    await query(`
      UPDATE scheduled_messages
      SET status = 'pending', updated_at = NOW()
      WHERE status = 'processing'
        AND updated_at < NOW() - INTERVAL '10 minutes'
    `);

    // Get all pending scheduled messages that are due
    // For W-API, accept connections with instance_id/wapi_token even if status not 'connected'
    const pendingMessages = await query(`
      SELECT 
        sm.*,
        conv.remote_jid,
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
        conv.contact_phone,
        conn.status as connection_status
      FROM scheduled_messages sm
      JOIN conversations conv ON conv.id = sm.conversation_id
      JOIN connections conn ON conn.id = sm.connection_id
      WHERE sm.status = 'pending'
        AND sm.scheduled_at <= NOW()
      ORDER BY sm.scheduled_at ASC
      LIMIT 50
    `);

    if (pendingMessages.rows.length === 0) {
      console.log('📅 [CRON] No scheduled messages to send');
      return stats;
    }

    console.log(`📅 [CRON] Found ${pendingMessages.rows.length} scheduled messages to send`);

    for (const msg of pendingMessages.rows) {
      stats.processed++;
      try {
      const claim = await query(
        `UPDATE scheduled_messages
         SET status = 'processing', updated_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [msg.id]
      );

      if (claim.rows.length === 0) {
        console.log(`  ↷ Scheduled message ${msg.id} already claimed by another worker`);
        continue;
      }

      // Check if connection is still active
      // For W-API, accept if has instance_id and wapi_token
      const provider = whatsappProvider.detectProvider(msg);
      const isConnected = msg.connection_status === 'connected' || 
        (provider === 'wapi' && msg.instance_id && msg.wapi_token);

      if (!isConnected) {
        console.log(`  ⚠ Connection not active for message ${msg.id}, marking as failed`);
        await query(
          `UPDATE scheduled_messages 
           SET status = 'failed', error_message = 'Conexão não está ativa', updated_at = NOW() 
           WHERE id = $1`,
          [msg.id]
        );
        stats.failed++;
        continue;
      }

      // Send the message using unified provider
      const connection = {
        provider: msg.provider,
        api_url: msg.api_url,
        api_key: msg.api_key,
        instance_name: msg.instance_name,
        instance_id: msg.instance_id,
        wapi_token: msg.wapi_token,
        uazapi_url: msg.uazapi_url,
        uazapi_token: msg.uazapi_token,
      };

      // Check if we need to send text separately from media
      const shouldSendSeparate = msg.send_text_separate && msg.media_url && msg.content;

      if (shouldSendSeparate) {
        // Step 1: Send media without caption
        const mediaResult = await sendWhatsAppMessage(
          connection,
          msg.remote_jid,
          null, // no caption
          msg.message_type,
          msg.media_url
        );

        if (!mediaResult.success) {
          await query(
            `UPDATE scheduled_messages 
             SET status = 'failed', error_message = $1, updated_at = NOW() 
             WHERE id = $2`,
            [mediaResult.error || 'Falha ao enviar mídia', msg.id]
          );
          stats.failed++;
          console.log(`  ✗ Failed to send scheduled media ${msg.id}: ${mediaResult.error}`);
          continue;
        }

        // Save media message to chat_messages
        await insertScheduledChatMessage({
          msg,
          result: mediaResult,
          suffix: 'media',
          content: null,
          messageType: msg.message_type,
          mediaUrl: msg.media_url,
          mediaMimetype: msg.media_mimetype,
        });

        // Small delay between the two messages
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 2: Send text as separate message
        const textResult = await sendWhatsAppMessage(
          connection,
          msg.remote_jid,
          msg.content,
          'text',
          null
        );

        if (!textResult.success) {
          console.log(`  ⚠ Media sent but text failed for ${msg.id}: ${textResult.error}`);
          // Still mark as sent since media went through, but note the error
        }

        // Save text message to chat_messages
        if (textResult.success) {
          await insertScheduledChatMessage({
            msg,
            result: textResult,
            suffix: 'text',
            content: msg.content,
            messageType: 'text',
          });
        }

        // Update scheduled message as sent
        await query(
          `UPDATE scheduled_messages 
           SET status = 'sent', sent_at = NOW(), updated_at = NOW() 
           WHERE id = $1`,
          [msg.id]
        );

      } else {
        // Standard: send as single message (media with caption or text only)
        var result = msg.template_name
          ? await sendScheduledMetaTemplate(msg)
          : await sendWhatsAppMessage(
              connection,
              msg.remote_jid,
              msg.content,
              msg.message_type,
              msg.media_url
            );

        if (!result.success) {
          await query(
            `UPDATE scheduled_messages 
             SET status = 'failed', error_message = $1, updated_at = NOW() 
             WHERE id = $2`,
            [result.error || 'Unknown error', msg.id]
          );
          stats.failed++;
          console.log(`  ✗ Failed to send scheduled message ${msg.id}: ${result.error}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }

        // Update scheduled message as sent
        await query(
          `UPDATE scheduled_messages 
           SET status = 'sent', sent_at = NOW(), updated_at = NOW() 
           WHERE id = $1`,
          [msg.id]
        );

        // Save message to chat_messages
        await insertScheduledChatMessage({
          msg,
          result,
          content: msg.content,
          messageType: msg.message_type,
          mediaUrl: msg.media_url,
          mediaMimetype: msg.media_mimetype,
        });
      }

      // Update conversation last_message_at
      await query(
        `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [msg.conversation_id]
      );

      // Create alert for user about sent scheduled message
      const convInfo = await query(
        `SELECT contact_name, contact_phone FROM conversations WHERE id = $1`,
        [msg.conversation_id]
      );
      const contactName = convInfo.rows[0]?.contact_name || convInfo.rows[0]?.contact_phone || 'Contato';
      
      try {
        await query(
          `INSERT INTO user_alerts (user_id, type, title, message, metadata)
           VALUES ($1, 'scheduled_message_sent', $2, $3, $4)`,
          [
            msg.sender_id,
            '📅 Mensagem agendada enviada',
            `Mensagem enviada para ${contactName}`,
            JSON.stringify({
              conversation_id: msg.conversation_id,
              scheduled_message_id: msg.id,
              message_preview: msg.content?.substring(0, 100),
            })
          ]
        );
      } catch (alertError) {
        console.error(`📅 [CRON] Failed to create sent alert for ${msg.id}:`, alertError);
      }

      stats.sent++;
      console.log(`  ✓ Sent scheduled message ${msg.id}`);

      // Small delay between messages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      } catch (iterErr) {
        console.error(`📅 [CRON] Iteration error for message ${msg.id}:`, iterErr);
        try {
          await query(
            `UPDATE scheduled_messages
             SET status = 'failed', error_message = $1, updated_at = NOW()
             WHERE id = $2 AND status IN ('pending', 'processing')`,
            [String(iterErr?.message || iterErr).slice(0, 500), msg.id]
          );
        } catch (e) {
          console.error('📅 [CRON] Failed to mark message as failed:', e);
        }
        stats.failed++;
        // Continue to next message — do NOT abort the whole batch
        await new Promise(resolve => setTimeout(resolve, 200));
        continue;
      }
    }

    console.log(`📅 [CRON] Scheduled messages execution complete:`, stats);
    return stats;
  } catch (error) {
    console.error('📅 [CRON] Scheduled messages execution error:', error);
    throw error;
  }
}
