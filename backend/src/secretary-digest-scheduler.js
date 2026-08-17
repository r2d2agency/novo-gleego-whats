import { query } from './db.js';
import * as whatsappProvider from './lib/whatsapp-provider.js';
import { generateGroupsNarrativeSummary } from './lib/group-secretary.js';

/**
 * Secretary Daily Digest Scheduler
 * Sends a daily summary of detections to the configured external number
 */
export async function executeSecretaryDigest({ organizationId = null, force = false } = {}) {
  try {
    const now = new Date();
    let configResult;
    if (force && organizationId) {
      configResult = await query(
        `SELECT * FROM group_secretary_config WHERE organization_id = $1`,
        [organizationId]
      );
    } else {
      const saoPauloTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        hour: 'numeric', minute: 'numeric', hour12: false
      }).formatToParts(now);
      const currentHour = parseInt(saoPauloTime.find(p => p.type === 'hour').value);
      const currentMinute = parseInt(saoPauloTime.find(p => p.type === 'minute').value);
      configResult = await query(`
        SELECT * FROM group_secretary_config 
        WHERE daily_digest_enabled = true
          AND daily_digest_hour = $1
          AND COALESCE(daily_digest_minute, 0) = $2
          AND (notify_external_phone IS NOT NULL OR notify_members_whatsapp = true)
      `, [currentHour, currentMinute]);
      if (configResult.rows.length > 0) {
        console.log(`📊 [DIGEST] Cron match @ ${currentHour}:${String(currentMinute).padStart(2,'0')} SP — ${configResult.rows.length} org(s)`);
      }
    }

    if (configResult.rows.length === 0) {
      return { sent: 0, reason: 'no_config' };
    }

    let sentCount = 0;
    let lastError = null;

    for (const config of configResult.rows) {
      try {
        // Get yesterday's detections
        const logsResult = await query(`
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN matched_user_id IS NOT NULL THEN 1 END) as matched,
            COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent,
            COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_priority,
            COUNT(CASE WHEN sentiment IN ('negative', 'urgent_negative') THEN 1 END) as negative_sentiment
          FROM group_secretary_logs 
          WHERE organization_id = $1 
            AND created_at >= NOW() - INTERVAL '24 hours'
        `, [config.organization_id]);

        const stats = logsResult.rows[0];
        // NOTE: we no longer skip when total=0 — the narrative summary may still
        // contain useful info, and the user expects to receive the daily report
        // every day at the scheduled time, even with zero detections.

        // Get pending tasks from secretary
        const pendingResult = await query(`
          SELECT COUNT(*) as pending
          FROM crm_tasks 
          WHERE organization_id = $1 
            AND source = 'group_secretary' 
            AND status = 'pending'
        `, [config.organization_id]);

        const pending = parseInt(pendingResult.rows[0]?.pending || 0);

        // Get top members by requests
        const topMembersResult = await query(`
          SELECT matched_user_name, COUNT(*) as count
          FROM group_secretary_logs 
          WHERE organization_id = $1 
            AND created_at >= NOW() - INTERVAL '24 hours'
            AND matched_user_name IS NOT NULL
          GROUP BY matched_user_name
          ORDER BY count DESC
          LIMIT 5
        `, [config.organization_id]);

        const topMembers = topMembersResult.rows
          .map(r => `  • ${r.matched_user_name}: ${r.count} solicitações`)
          .join('\n');

        const headerMessage = `📊 *Resumo Diário - Secretária IA*\n` +
          `📅 ${now.toLocaleDateString('pt-BR')}\n\n` +
          `📌 *Detecções (24h):* ${stats.total}\n` +
          `✅ *Com responsável:* ${stats.matched}\n` +
          `🔴 *Urgentes:* ${stats.urgent}\n` +
          `🟠 *Alta prioridade:* ${stats.high_priority}\n` +
          `😠 *Sentimento negativo:* ${stats.negative_sentiment}\n` +
          `⏳ *Tarefas pendentes:* ${pending}\n` +
          (topMembers ? `\n👥 *Mais demandados:*\n${topMembers}` : '');

        // Generate narrative summary per group (AI)
        let narrative = null;
        try {
          narrative = await generateGroupsNarrativeSummary({
            organizationId: config.organization_id,
            hours: 24,
            maxGroups: 8,
          });
        } catch (narrErr) {
          console.error('📊 [DIGEST] Narrative error:', narrErr.message);
        }

        const groups = narrative?.groups || [];
        const multiGroup = groups.length > 1;

        // When multiple groups: keep per-group messages CONCISE (summary +
        // top 3 key points + top 3 actions). When single group: full detail.
        const buildGroupBlock = (g, { concise }) => {
          let block = `*📍 ${g.groupName}*`;
          block += `\n_${g.messageCount} mensagens • ${g.participants.length} participantes_`;
          if (g.summary) block += `\n\n${g.summary}`;
          const kpLimit = concise ? 3 : (g.key_points?.length || 0);
          const acLimit = concise ? 3 : (g.action_items?.length || 0);
          if (g.key_points?.length) {
            block += `\n\n*Pontos-chave:*\n` +
              g.key_points.slice(0, kpLimit).map(p => `• ${p}`).join('\n');
          }
          if (!concise && g.decisions?.length) {
            block += `\n\n*Decisões:*\n` + g.decisions.map(d => `✅ ${d}`).join('\n');
          }
          if (g.action_items?.length) {
            block += `\n\n*Ações:*\n` + g.action_items.slice(0, acLimit).map(a => {
              const resp = a.responsible ? ` — _${a.responsible}_` : '';
              const dl = a.deadline ? ` (${a.deadline})` : '';
              return `🎯 ${a.task}${resp}${dl}`;
            }).join('\n');
          }
          if (!concise && g.highlights?.length) {
            block += `\n\n*Destaques:*\n` + g.highlights.map(h => `💬 ${h}`).join('\n');
          }
          return block;
        };

        // Build the message list to send:
        // - multi-group: [header (with index), one message per group]
        // - single-group or none: one combined message (legacy behavior)
        const messagesToSend = [];
        if (multiGroup) {
          let header = headerMessage;
          header += `\n\n━━━━━━━━━━━━━━━━━━\n📝 *Resumo por grupo*` +
            `\n_Enviarei ${groups.length} mensagens a seguir, uma por grupo._\n` +
            groups.map((g, i) => `${i + 1}. ${g.groupName} (${g.messageCount} msgs)`).join('\n');
          messagesToSend.push(header);
          for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const prefix = `*[${i + 1}/${groups.length}]*\n\n`;
            messagesToSend.push(prefix + buildGroupBlock(g, { concise: true }) +
              `\n\n_Acesse o sistema para mais detalhes._`);
          }
        } else {
          let narrativeSection = '';
          if (groups.length === 1) {
            narrativeSection = '\n\n━━━━━━━━━━━━━━━━━━\n📝 *Resumo Detalhado*\n━━━━━━━━━━━━━━━━━━\n\n' +
              buildGroupBlock(groups[0], { concise: false });
          } else if (narrative?.error === 'no_ai_config') {
            narrativeSection = '\n\n_⚠️ Configure a IA da organização para receber o resumo narrativo dos grupos._';
          }
          messagesToSend.push(headerMessage + narrativeSection + `\n\n_Acesse o sistema para mais detalhes._`);
        }

        const recipients = await getDigestRecipients(config);
        if (recipients.length === 0) {
          lastError = 'no_recipients';
          console.warn(`📊 [DIGEST] No valid recipients for org ${config.organization_id}`);
          continue;
        }

        const connection = await getDigestConnection(config);
        if (!connection) {
          lastError = 'no_connected_connection';
          console.warn(`📊 [DIGEST] No connected WhatsApp connection for org ${config.organization_id}`);
          continue;
        }

        for (const recipient of recipients) {
          for (let m = 0; m < messagesToSend.length; m++) {
            const chunks = splitMessage(messagesToSend[m], 3500);
            for (let i = 0; i < chunks.length; i++) {
              const part = chunks.length > 1
                ? `${chunks[i]}\n\n_(parte ${i + 1}/${chunks.length})_`
                : chunks[i];
              const sendResult = await whatsappProvider.sendMessage(connection, recipient.phone, part, 'text', null);
              if (!sendResult?.success) {
                throw new Error(sendResult?.error || `Falha ao enviar relatório para ${recipient.label}`);
              }
              if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 1500));
            }
            // Delay between per-group messages (3s) so o WhatsApp não trate como spam
            if (m < messagesToSend.length - 1) {
              await new Promise(r => setTimeout(r, 3000));
            }
          }

          console.log(
            `📊 [DIGEST] Sent daily digest (${messagesToSend.length} msg) to ${recipient.phone} (${recipient.label}) for org ${config.organization_id}`
          );
          sentCount++;
        }
      } catch (orgErr) {
        console.error(`📊 [DIGEST] Error for org ${config.organization_id}:`, orgErr.message);
        lastError = orgErr.message;
      }
    }
    return { sent: sentCount, error: lastError };
  } catch (error) {
    console.error('📊 [DIGEST] Error:', error);
    return { sent: 0, error: error.message };
  }
}

async function getDigestConnection(config) {
  try {
    if (config.default_connection_id) {
      const result = await query(
        `SELECT * FROM connections WHERE id = $1 AND status = 'connected'`,
        [config.default_connection_id]
      );
      if (result.rows.length > 0) return result.rows[0];
    }
    const result = await query(
      `SELECT * FROM connections WHERE organization_id = $1 AND status = 'connected' ORDER BY created_at ASC LIMIT 1`,
      [config.organization_id]
    );
    return result.rows[0] || null;
  } catch { return null; }
}

async function getDigestRecipients(config) {
  const recipients = [];
  const seenPhones = new Set();

  const addRecipient = (phone, label) => {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (!cleanPhone || seenPhones.has(cleanPhone)) return;
    seenPhones.add(cleanPhone);
    recipients.push({ phone: cleanPhone, label });
  };

  addRecipient(config.notify_external_phone, 'número externo');

  if (config.notify_members_whatsapp) {
    const membersResult = await query(
      `SELECT DISTINCT u.id AS user_id, u.name, u.whatsapp_phone, u.phone_number as phone
       FROM group_secretary_members gsm
       JOIN users u ON u.id = gsm.user_id
       WHERE gsm.organization_id = $1
         AND COALESCE(gsm.is_active, true) = true`,
      [config.organization_id]
    );

    for (const member of membersResult.rows) {
      addRecipient(member.whatsapp_phone || member.phone, member.name || 'responsável');
    }
  }

  return recipients;
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  const paragraphs = text.split('\n');
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n' + p).length > maxLen && current) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? current + '\n' + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
