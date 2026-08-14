/**
 * Group Secretary - AI-powered group message analyzer
 * 
 * Monitors WhatsApp group messages, detects requests/mentions,
 * identifies the responsible team member, and creates CRM tasks + popup alerts.
 * Supports external WhatsApp notifications.
 */

import { query } from '../db.js';
import { logInfo, logError } from '../logger.js';
import * as whatsappProvider from './whatsapp-provider.js';
import { recordSecretaryEvent } from './group-secretary-diagnostic.js';
import { normalizeBrazilDateTime } from './timezone.js';

/**
 * Analyze a group message with AI to detect requests and identify mentioned members
 */
export async function analyzeGroupMessage({
  organizationId,
  conversationId,
  messageContent,
  senderName,
  senderPhone,
  groupName,
  mentionedJids = [],
  messageId = null,
  provider = 'unknown',
}) {
  const startTime = Date.now();

  try {
    // 1. Get secretary config
    const configResult = await query(
      `SELECT * FROM group_secretary_config WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    );

    if (configResult.rows.length === 0) {
      recordSecretaryEvent({
        organizationId, provider, messageId, conversationId, groupName, senderName,
        stage: 'skipped', level: 'warn',
        message: 'Secretária não está ativa para esta organização',
      });
      return null;
    }
    const config = configResult.rows[0];

    // 2. Check if sender is excluded (team members whose messages should be ignored)
    if (config.excluded_senders && config.excluded_senders.length > 0) {
      const phoneToCheck = senderPhone || String(senderName || '').replace(/\D/g, '');
      if (phoneToCheck && phoneToCheck.length >= 8) {
        const isExcluded = config.excluded_senders.some(excl => {
          const exclPhone = String(excl || '').replace(/\D/g, '');
          if (!exclPhone || exclPhone.length < 8) return false;
          return exclPhone === phoneToCheck || 
            exclPhone.slice(-9) === phoneToCheck.slice(-9) ||
            exclPhone.includes(phoneToCheck) || phoneToCheck.includes(exclPhone);
        });
        if (isExcluded) {
          logInfo('group_secretary', `Sender ${senderName} (phone: ${phoneToCheck}) is in excluded_senders list, skipping`);
          recordSecretaryEvent({
            organizationId, provider, messageId, conversationId, groupName, senderName,
            stage: 'skipped', message: `Remetente está na lista de excluídos (${phoneToCheck})`,
          });
          return null;
        }
      }
    }

    // 2b. Check if this group should be monitored
    if (config.group_jids && config.group_jids.length > 0) {
      const convResult = await query(
        `SELECT remote_jid FROM conversations WHERE id = $1`,
        [conversationId]
      );
      const remoteJid = convResult.rows[0]?.remote_jid;
      if (remoteJid && !config.group_jids.includes(remoteJid)) {
        recordSecretaryEvent({
          organizationId, provider, messageId, conversationId, groupName, senderName,
          stage: 'skipped', message: `Grupo ${remoteJid} não está na lista monitorada`,
        });
        return null; // Group not monitored
      }
    }

    // 3. Get team members with aliases
    const membersResult = await query(
      `SELECT gsm.*, u.name as user_name, u.email, u.whatsapp_phone
       FROM group_secretary_members gsm
       JOIN users u ON u.id = gsm.user_id
       WHERE gsm.organization_id = $1 AND gsm.is_active = true`,
      [organizationId]
    );

    if (membersResult.rows.length === 0) {
      recordSecretaryEvent({
        organizationId, provider, messageId, conversationId, groupName, senderName,
        stage: 'skipped', level: 'warn',
        message: 'Nenhum membro cadastrado na Secretária IA',
      });
      return null;
    }

    const members = membersResult.rows;

    // 4. Get AI config (secretary override or org default)
    const aiConfig = await getAIConfig(organizationId, config);
    if (!aiConfig || !aiConfig.apiKey) {
      logInfo('group_secretary', 'No AI config available, skipping analysis');
      recordSecretaryEvent({
        organizationId, provider, messageId, conversationId, groupName, senderName,
        stage: 'skipped', level: 'error',
        message: 'Sem chave de IA configurada (secretária ou organização)',
      });
      return null;
    }

    // 5. Build prompt with member context
    const membersList = members.map(m => {
      const aliases = m.aliases?.length ? m.aliases.join(', ') : 'nenhum';
      const depts = m.departments?.length ? m.departments.join(', ') : 'não definido';
      const phone = m.whatsapp_phone ? m.whatsapp_phone.replace(/\D/g, '') : '';
      return `- ${m.user_name} (ID: ${m.user_id}) | Apelidos: ${aliases} | Telefone: ${phone || 'não cadastrado'} | Áreas: ${depts} | Descrição: ${m.role_description || 'sem descrição'}`;
    }).join('\n');

    const systemPrompt = `Você é uma secretária virtual inteligente que monitora grupos de WhatsApp de um escritório jurídico.
Sua função é analisar mensagens e detectar pedidos, solicitações, perguntas direcionadas ou menções a responsáveis.

MEMBROS DA EQUIPE:
${membersList}

REGRAS:
1. Analise se a mensagem contém um pedido, solicitação, tarefa ou menção a algum membro
2. Identifique TODOS os membros responsáveis (pode ser mais de um) por:
   - Nome direto ou apelido
    - @menção do WhatsApp (ex: @João, @5511999999999 - no WhatsApp menções podem aparecer como número de telefone, compare com os telefones dos membros)
   - Número de telefone mencionado com @ que corresponda ao telefone de um membro
   - Contexto + cargo/área (ex: "preciso do financeiro" → membro da área financeira)
3. Se nenhum membro for identificado, retorne array vazio para matched_users
4. Avalie a confiança da detecção de 0.0 a 1.0
5. Classifique a URGÊNCIA baseado em palavras-chave e contexto:
   - "urgent": palavras como "urgente", "agora", "imediatamente", "ASAP", "pra ontem", "emergência"
   - "high": palavras como "importante", "prioridade", "preciso hoje", "não pode esperar"
   - "normal": solicitações comuns sem indicador de pressa
   - "low": pedidos opcionais, "quando puder", "sem pressa"
6. Detecte PRAZOS mencionados na mensagem (ex: "até sexta", "dia 15", "amanhã", "essa semana")
7. Avalie o SENTIMENTO da mensagem:
   - "positive": elogios, agradecimentos, satisfação
   - "neutral": informativo, neutro
   - "negative": reclamação, frustração, insatisfação
   - "urgent_negative": reclamação urgente, ameaça, raiva

Retorne SOMENTE um JSON válido:
{
  "is_request": true/false,
  "detected_request": "descrição do pedido/solicitação detectada",
  "matched_users": [
    {"user_id": "UUID", "user_name": "nome", "reason": "por que esta pessoa"}
  ],
  "confidence": 0.0-1.0,
  "priority": "urgent|high|normal|low",
  "deadline": "YYYY-MM-DD ou null se não houver prazo mencionado",
  "deadline_text": "texto original do prazo ou null",
  "sentiment": "positive|neutral|negative|urgent_negative",
  "reason": "breve explicação da detecção"
}`;

    // Pre-process: resolve mentionedJids to member names for direct matching
    const mentionedMembers = [];
    logInfo('group_secretary', `mentionedJids received: ${JSON.stringify(mentionedJids)}, members phones: ${JSON.stringify(members.map(m => ({ name: m.user_name, phone: m.whatsapp_phone })))}`);
    if (mentionedJids && mentionedJids.length > 0) {
      for (const jid of mentionedJids) {
        // Extract phone number from JID format: 5511999999999@s.whatsapp.net or just a number
        const jidPhone = String(jid || '').split('@')[0].replace(/\D/g, '');
        logInfo('group_secretary', `Processing mentionedJid: ${jid} -> extracted phone: ${jidPhone}`);
        if (jidPhone.length >= 8) {
          const matched = members.find(m => {
            const mPhone = (m.whatsapp_phone || '').replace(/\D/g, '');
            if (!mPhone) return false;
            // Compare full numbers or last 9 digits (ignoring country code variations)
            return mPhone === jidPhone || jidPhone === mPhone ||
              mPhone.includes(jidPhone) || jidPhone.includes(mPhone) ||
              mPhone.slice(-9) === jidPhone.slice(-9);
          });
          if (matched) {
            mentionedMembers.push(matched);
            logInfo('group_secretary', `✅ Resolved mentionedJid ${jid} -> ${matched.user_name} (phone: ${matched.whatsapp_phone})`);
          } else {
            logInfo('group_secretary', `❌ No member matched for mentionedJid phone: ${jidPhone}`);
          }
        }
      }
    }

    // Pre-process message: replace phone mentions with names for better AI understanding
    let processedMessage = messageContent || '';
    for (const m of members) {
      const memberPhone = (m.whatsapp_phone || '').replace(/\D/g, '');
      if (memberPhone && memberPhone.length >= 8) {
        // Replace @phone patterns with @name
        processedMessage = processedMessage.replace(new RegExp(`@${memberPhone}`, 'g'), `@${m.user_name}`);
        // Also try without country code (last 8-11 digits)
        if (memberPhone.length > 8) {
          const shortPhone = memberPhone.slice(-11);
          processedMessage = processedMessage.replace(new RegExp(`@${shortPhone}`, 'g'), `@${m.user_name}`);
          const shorterPhone = memberPhone.slice(-9);
          processedMessage = processedMessage.replace(new RegExp(`@${shorterPhone}`, 'g'), `@${m.user_name}`);
        }
      }
    }

    const userPrompt = `Grupo: ${groupName || 'Desconhecido'}
Remetente: ${senderName || 'Desconhecido'}
Mensagem: "${processedMessage}"`;

    // 6. Call AI
    recordSecretaryEvent({
      organizationId, provider, messageId, conversationId, groupName, senderName,
      stage: 'ai_called',
      message: `Chamando IA (${aiConfig.provider}/${aiConfig.model})`,
      details: { content: String(messageContent || '').slice(0, 200) },
    });
    let aiResult;
    try {
      aiResult = await callAI(aiConfig, systemPrompt, userPrompt);
    } catch (aiErr) {
      recordSecretaryEvent({
        organizationId, provider, messageId, conversationId, groupName, senderName,
        stage: 'error', level: 'error',
        message: 'Erro na chamada da IA',
        error: aiErr?.message || String(aiErr),
      });
      throw aiErr;
    }
    if (!aiResult) {
      recordSecretaryEvent({
        organizationId, provider, messageId, conversationId, groupName, senderName,
        stage: 'error', level: 'error',
        message: 'IA retornou resposta vazia ou inválida',
      });
      return null;
    }

    const processingTime = Date.now() - startTime;

    // 7. Check confidence threshold
    if (!aiResult.is_request || aiResult.confidence < (config.min_confidence || 0.6)) {
      logInfo('group_secretary', `Message below threshold: confidence=${aiResult.confidence}, is_request=${aiResult.is_request}`);
      recordSecretaryEvent({
        organizationId, provider, messageId, conversationId, groupName, senderName,
        stage: 'no_detection',
        message: `Mensagem ignorada (is_request=${aiResult.is_request}, confiança=${aiResult.confidence}, mínimo=${config.min_confidence || 0.6})`,
        details: { reason: aiResult.reason },
      });
      return null;
    }

    // 8. Validate matched users exist in our members list (supports multiple)
    const rawMatches = aiResult.matched_users || [];
    // Backward compat: if old format with single matched_user_id
    if (rawMatches.length === 0 && aiResult.matched_user_id) {
      rawMatches.push({ user_id: aiResult.matched_user_id, user_name: aiResult.matched_user_name, reason: aiResult.reason });
    }

    const matchedMembers = [];
    
    // First: add members resolved directly from mentionedJids (most reliable)
    for (const m of mentionedMembers) {
      if (!matchedMembers.find(mm => mm.user_id === m.user_id)) {
        matchedMembers.push(m);
        logInfo('group_secretary', `Matched member from mentionedJid: ${m.user_name}`);
      }
    }

    // Then: process AI matches for any additional members
    for (const match of rawMatches) {
      // Skip if already matched via mentionedJid
      if (matchedMembers.find(mm => mm.user_id === match.user_id)) continue;
      
      let member = members.find(m => m.user_id === match.user_id);
      if (!member && match.user_name) {
        // Try matching by name (case-insensitive, accent-insensitive)
        const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const matchName = normalize(match.user_name);
        member = members.find(m => {
          const mName = normalize(m.user_name);
          return mName.includes(matchName) || matchName.includes(mName);
        });
      }
      if (!member && match.user_name) {
        // Try matching by phone number (WhatsApp mentions often use phone numbers)
        const cleanPhone = (match.user_name || '').replace(/\D/g, '');
        if (cleanPhone.length >= 8) {
          member = members.find(m => {
            const memberPhone = (m.whatsapp_phone || '').replace(/\D/g, '');
            return memberPhone && (memberPhone.includes(cleanPhone) || cleanPhone.includes(memberPhone));
          });
        }
      }
      if (!member && match.user_name) {
        // Try matching by aliases (accent-insensitive)
        const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const matchName = normalize(match.user_name);
        member = members.find(m =>
          (m.aliases || []).some(a => {
            const na = normalize(a);
            return na.includes(matchName) || matchName.includes(na);
          })
        );
      }
      if (member && !matchedMembers.find(mm => mm.user_id === member.user_id)) {
        matchedMembers.push(member);
      }
    }

    // Determine priority from AI (with fallback)
    const priority = aiResult.priority || 'normal';
    const priorityMap = { urgent: 'urgent', high: 'high', normal: 'medium', low: 'low' };
    const crmPriority = priorityMap[priority] || 'medium';

    // Determine deadline from AI
    let dueDate = null;
    if (aiResult.deadline) {
      try {
        dueDate = new Date(aiResult.deadline);
        if (isNaN(dueDate.getTime())) dueDate = null;
      } catch { dueDate = null; }
    }

    const sentiment = aiResult.sentiment || 'neutral';
    const taskIds = [];
    const alertIds = [];

    // Process each matched member
    const membersToProcess = matchedMembers.length > 0 ? matchedMembers : [null];

    for (const matchedMember of membersToProcess) {
      if (!matchedMember) continue;

      // 9. Create CRM task if enabled
      let taskId = null;
      if (config.create_crm_task) {
        const priorityEmoji = { urgent: '🔴', high: '🟠', normal: '🟡', low: '🟢' };
        taskId = await createCRMTask({
          organizationId,
          assignedTo: matchedMember.user_id,
          title: `${priorityEmoji[priority] || '🟡'} [Grupo] ${aiResult.detected_request || 'Nova solicitação'}`.slice(0, 255),
          description: `📱 Grupo: ${groupName || 'Desconhecido'}\n👤 Solicitante: ${senderName || 'Desconhecido'}\n💬 Mensagem: ${messageContent}\n🎯 Prioridade: ${priority}\n${aiResult.deadline_text ? `📅 Prazo mencionado: ${aiResult.deadline_text}\n` : ''}${sentiment !== 'neutral' ? `💭 Sentimento: ${sentiment}\n` : ''}\n🤖 Análise: ${aiResult.reason || ''}`,
          priority: crmPriority,
          dueDate,
          source: 'group_secretary',
        });
        if (taskId) taskIds.push(taskId);
      }

      // 10. Create popup alert if enabled
      let alertId = null;
      if (config.show_popup_alert) {
        const urgencyLabel = priority === 'urgent' ? '🔴 URGENTE: ' : priority === 'high' ? '🟠 ' : '';
        alertId = await createPopupAlert({
          userId: matchedMember.user_id,
          senderName: senderName || 'Alguém',
          groupName: groupName || 'Grupo',
          request: `${urgencyLabel}${aiResult.detected_request || messageContent}`,
          conversationId,
        });
        if (alertId) alertIds.push(alertId);
      }

      // 10b. Notify matched member via WhatsApp if enabled
      if (config.notify_members_whatsapp && (config.individual_notifications_enabled !== false)) {
        await notifyMatchedMember({
          organizationId,
          matchedUserId: matchedMember.user_id,
          matchedUserName: matchedMember.user_name,
          senderName: senderName || 'Alguém',
          groupName: groupName || 'Grupo',
          request: aiResult.detected_request || messageContent,
          confidence: aiResult.confidence,
          priority,
          defaultConnectionId: config.default_connection_id,
        });
      }
    }

    // 10c. Notify external WhatsApp number if enabled
    if (config.notify_external_enabled && config.notify_external_phone && (config.individual_notifications_enabled !== false)) {
      const matchedNames = matchedMembers.map(m => m.user_name).join(', ') || 'Não identificado';
      await notifyExternalNumber({
        organizationId,
        phone: config.notify_external_phone,
        senderName: senderName || 'Alguém',
        groupName: groupName || 'Grupo',
        request: aiResult.detected_request || messageContent,
        matchedUser: matchedNames,
        confidence: aiResult.confidence,
        priority,
        sentiment,
        defaultConnectionId: config.default_connection_id,
      });
    }

    // 11. Log the detection (one log per detection, with first matched user for backward compat)
    const firstMatch = matchedMembers[0] || null;
    await query(
      `INSERT INTO group_secretary_logs 
       (organization_id, conversation_id, message_content, sender_name, detected_request, 
        matched_user_id, matched_user_name, confidence, crm_task_id, alert_id, 
        ai_provider, ai_model, processing_time_ms, priority, deadline, sentiment, matched_users_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        organizationId, conversationId, messageContent?.slice(0, 1000), senderName,
        aiResult.detected_request?.slice(0, 500),
        firstMatch?.user_id || null, firstMatch?.user_name || null,
        aiResult.confidence, taskIds[0] || null, alertIds[0] || null,
        aiConfig.provider, aiConfig.model, processingTime,
        priority, dueDate, sentiment, matchedMembers.length,
      ]
    );

    logInfo('group_secretary', `Detection: request="${aiResult.detected_request}", users=${matchedMembers.map(m=>m.user_name).join(',')||'none'}, priority=${priority}, confidence=${aiResult.confidence}, time=${processingTime}ms`);

    recordSecretaryEvent({
      organizationId, provider, messageId, conversationId, groupName, senderName,
      stage: 'detected',
      message: `✅ Detectado: ${aiResult.detected_request}`,
      details: {
        matched: matchedMembers.map(m => m.user_name),
        priority,
        confidence: aiResult.confidence,
        sentiment,
        processing_ms: processingTime,
      },
    });

    return {
      isRequest: true,
      detectedRequest: aiResult.detected_request,
      matchedUsers: matchedMembers.map(m => ({ id: m.user_id, name: m.user_name })),
      confidence: aiResult.confidence,
      priority,
      deadline: aiResult.deadline,
      sentiment,
      taskIds,
      alertIds,
    };
  } catch (error) {
    logError('group_secretary.analyze_error', error);
    recordSecretaryEvent({
      organizationId, provider, messageId, conversationId, groupName, senderName,
      stage: 'error', level: 'error',
      message: 'Erro inesperado durante análise',
      error: error?.message || String(error),
    });
    return null;
  }
}

/**
 * Get AI configuration (secretary override → org default)
 */
export async function getAIConfig(organizationId, config) {
  // Use secretary-specific config if available
  if (config.ai_api_key && config.ai_provider) {
    return {
      provider: config.ai_provider,
      model: config.ai_model || (config.ai_provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash'),
      apiKey: config.ai_api_key,
    };
  }

  // Fallback to organization AI config
  const orgResult = await query(
    `SELECT ai_provider, ai_model, ai_api_key FROM organizations WHERE id = $1`,
    [organizationId]
  );

  const org = orgResult.rows[0];
  if (!org || !org.ai_api_key || org.ai_provider === 'none') return null;

  return {
    provider: org.ai_provider,
    model: org.ai_model || (org.ai_provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash'),
    apiKey: org.ai_api_key,
  };
}

/**
 * Call AI provider (OpenAI or Gemini)
 */
async function callAI(config, systemPrompt, userPrompt) {
  try {
    let response;

    if (config.provider === 'openai') {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
      });
    } else if (config.provider === 'gemini') {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.model || 'gemini-2.0-flash'}:generateContent?key=${config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 500,
              responseMimeType: 'application/json',
            },
          }),
        }
      );
    } else {
      logError('group_secretary', new Error(`Unsupported AI provider: ${config.provider}`));
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      logError('group_secretary.ai_call', new Error(`AI API error ${response.status}: ${errorText}`));
      return null;
    }

    const data = await response.json();
    let content;

    if (config.provider === 'openai') {
      content = data.choices?.[0]?.message?.content;
    } else {
      content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    }

    if (!content) return null;

    return JSON.parse(content);
  } catch (error) {
    logError('group_secretary.ai_parse_error', error);
    return null;
  }
}

/**
 * Create a CRM task for the identified member
 */
async function createCRMTask({ organizationId, assignedTo, title, description, priority, dueDate, source }) {
  try {
    // Default: same day (+2h) so the task shows up in the "Hoje" view instead of tomorrow
    const actualDueDate = normalizeBrazilDateTime(dueDate) || new Date(Date.now() + 2 * 60 * 60 * 1000);
    const result = await query(
      `INSERT INTO crm_tasks (organization_id, assigned_to, title, description, type, priority, status, due_date, source)
       VALUES ($1, $2, $3, $4, 'task', $5, 'pending', $6, $7)
       RETURNING id`,
      [organizationId, assignedTo, title, description, priority || 'medium', actualDueDate, source || null]
    );
    const crmTaskId = result.rows[0]?.id || null;

    // Also create a card in the Global Kanban board
    try {
      const { createTaskCardInGlobalBoard } = await import('./task-card-helper.js');
      await createTaskCardInGlobalBoard({
        organizationId,
        createdBy: assignedTo,
        assignedTo,
        title,
        description,
        priority: priority || 'medium',
        dueDate: actualDueDate,
        sourceModule: 'group_secretary',
        crmTaskId,
      });
    } catch (kanbanErr) {
      logError('group_secretary.kanban_card_error', kanbanErr);
    }

    return crmTaskId;
  } catch (error) {
    logError('group_secretary.create_task_error', error);
    return null;
  }
}

/**
 * Create a popup alert for the identified member
 */
async function createPopupAlert({ userId, senderName, groupName, request, conversationId }) {
  try {
    const result = await query(
      `INSERT INTO user_alerts (user_id, type, title, message, metadata)
       VALUES ($1, 'group_secretary', $2, $3, $4)
       RETURNING id`,
      [
        userId,
        `📋 ${senderName} pediu algo no grupo "${groupName}"`,
        request?.slice(0, 500),
        JSON.stringify({ conversation_id: conversationId, source: 'group_secretary' }),
      ]
    );
    return result.rows[0]?.id || null;
  } catch (error) {
    logError('group_secretary.create_alert_error', error);
    return null;
  }
}

/**
 * Notify the matched member via their personal WhatsApp
 */
async function notifyMatchedMember({ organizationId, matchedUserId, matchedUserName, senderName, groupName, request, confidence, priority, defaultConnectionId }) {
  try {
    const userResult = await query(
      `SELECT whatsapp_phone FROM users WHERE id = $1`,
      [matchedUserId]
    );
    let phone = userResult.rows[0]?.whatsapp_phone;
    if (!phone) {
      logInfo('group_secretary', `No phone for user ${matchedUserName}, skipping WhatsApp notification`);
      return;
    }
    phone = phone.replace(/\D/g, '');
    if (!phone) return;

    const connection = await getNotificationConnection(organizationId, defaultConnectionId);
    if (!connection) return;

    const confPercent = Math.round((confidence || 0) * 100);
    const priorityEmoji = { urgent: '🔴 URGENTE', high: '🟠 Alta', normal: '🟡 Normal', low: '🟢 Baixa' };
    const message = `📋 *Secretária IA - Solicitação para você*\n\n` +
      `📱 *Grupo:* ${groupName}\n` +
      `👤 *Solicitante:* ${senderName}\n` +
      `🎯 *Prioridade:* ${priorityEmoji[priority] || 'Normal'}\n` +
      `📊 *Confiança:* ${confPercent}%\n\n` +
      `💬 *Solicitação:*\n${(request || '').substring(0, 500)}`;

    await whatsappProvider.sendMessage(connection, phone, message, 'text', null);
    logInfo('group_secretary.member_notified', { phone, matchedUserName, groupName });
  } catch (error) {
    logError('group_secretary.notify_member_error', error);
  }
}

/**
 * Notify an external WhatsApp number about a detected request
 */
async function notifyExternalNumber({ organizationId, phone, senderName, groupName, request, matchedUser, confidence, priority, sentiment, defaultConnectionId }) {
  try {
    const connection = await getNotificationConnection(organizationId, defaultConnectionId);
    if (!connection) {
      logError('group_secretary.notify_external', new Error('No active connection found'));
      return;
    }

    const confPercent = Math.round((confidence || 0) * 100);
    const priorityEmoji = { urgent: '🔴', high: '🟠', normal: '🟡', low: '🟢' };
    const sentimentEmoji = { positive: '😊', neutral: '😐', negative: '😠', urgent_negative: '🚨' };

    const message = `📋 *Secretária IA - Detecção*\n\n` +
      `📱 *Grupo:* ${groupName}\n` +
      `👤 *Solicitante:* ${senderName}\n` +
      `🎯 *Responsável:* ${matchedUser}\n` +
      `${priorityEmoji[priority] || '🟡'} *Prioridade:* ${priority || 'normal'}\n` +
      `${sentimentEmoji[sentiment] || '😐'} *Sentimento:* ${sentiment || 'neutral'}\n` +
      `📊 *Confiança:* ${confPercent}%\n\n` +
      `💬 *Solicitação:*\n${(request || '').substring(0, 500)}`;

    await whatsappProvider.sendMessage(connection, phone, message, 'text', null);
    logInfo('group_secretary.external_notified', { phone, groupName });
  } catch (error) {
    logError('group_secretary.notify_external_error', error);
  }
}

/**
 * Get the connection to use for sending notifications (default or first available)
 */
async function getNotificationConnection(organizationId, defaultConnectionId) {
  try {
    if (defaultConnectionId) {
      const result = await query(
        `SELECT * FROM connections WHERE id = $1 AND organization_id = $2 AND status = 'connected'`,
        [defaultConnectionId, organizationId]
      );
      if (result.rows.length > 0) return result.rows[0];
    }
    const result = await query(
      `SELECT * FROM connections WHERE organization_id = $1 AND status = 'connected' ORDER BY created_at ASC LIMIT 1`,
      [organizationId]
    );
    return result.rows[0] || null;
  } catch (error) {
    logError('group_secretary.get_connection_error', error);
    return null;
  }
}

/**
 * Generate meeting minutes from recent group messages using AI
 */
export async function generateMeetingMinutes({ organizationId, conversationId, hours = 24, generatedBy }) {
  try {
    // Get conversation info
    const convResult = await query(
      `SELECT c.*, conn.name as connection_name 
       FROM conversations c 
       JOIN connections conn ON conn.id = c.connection_id 
       WHERE c.id = $1 AND conn.organization_id = $2`,
      [conversationId, organizationId]
    );
    if (convResult.rows.length === 0) throw new Error('Conversa não encontrada');
    const conv = convResult.rows[0];

    // Get recent messages
    const messagesResult = await query(
      `SELECT m.content, m.sender_name, m.from_me, m.timestamp as created_at, m.message_type
       FROM chat_messages m
       WHERE m.conversation_id = $1 
         AND m.timestamp >= NOW() - INTERVAL '1 hour' * $2
         AND m.content IS NOT NULL AND m.content != ''
         AND m.message_type IN ('text', 'extendedTextMessage', 'conversation', 'chat')
       ORDER BY m.timestamp ASC
       LIMIT 500`,
      [conversationId, hours]
    );

    if (messagesResult.rows.length < 3) {
      throw new Error(`Não há mensagens suficientes no período selecionado (${messagesResult.rows.length} encontradas). São necessárias pelo menos 3 mensagens de texto.`);
    }

    const messages = messagesResult.rows;
    const participants = [...new Set(messages.map(m => m.sender_name).filter(Boolean))];

    // Get AI config
    const configResult = await query(
      `SELECT * FROM group_secretary_config WHERE organization_id = $1`,
      [organizationId]
    );
    const config = configResult.rows[0] || {};
    const aiConfig = await getAIConfig(organizationId, config);
    if (!aiConfig || !aiConfig.apiKey) {
      throw new Error('Configuração de IA não encontrada. Configure a API Key na aba Configurações ou na Organização.');
    }

    // Get team members for context
    const membersResult = await query(
      `SELECT gsm.*, u.name as user_name
       FROM group_secretary_members gsm
       JOIN users u ON u.id = gsm.user_id
       WHERE gsm.organization_id = $1 AND gsm.is_active = true`,
      [organizationId]
    );
    const memberNames = membersResult.rows.map(m => m.user_name);

    // Build message log for AI
    const messageLog = messages.map(m => {
      const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `[${time}] ${m.sender_name || 'Desconhecido'}: ${m.content}`;
    }).join('\n');

    const systemPrompt = `Você é um assistente especializado em gerar atas de reunião a partir de conversas de grupo do WhatsApp.
Analise a sequência de mensagens e produza uma ata estruturada.

MEMBROS DA EQUIPE CONHECIDOS: ${memberNames.join(', ') || 'Não informados'}

Retorne SOMENTE um JSON válido com esta estrutura:
{
  "title": "Título conciso da reunião/discussão",
  "summary": "Resumo executivo em 2-3 parágrafos do que foi discutido",
  "decisions": [
    {"description": "Decisão tomada", "responsible": "Nome do responsável ou null"}
  ],
  "action_items": [
    {"task": "Tarefa a ser feita", "responsible": "Nome do responsável", "deadline": "Prazo mencionado ou null"}
  ],
  "key_topics": ["Tópico 1", "Tópico 2"]
}

REGRAS:
- Foque em decisões concretas e itens de ação
- Identifique responsáveis quando mencionados
- Ignore mensagens triviais (saudações, emojis soltos)
- O título deve refletir o tema principal discutido
- O resumo deve ser profissional e objetivo`;

    const userPrompt = `Grupo: ${conv.group_name || 'Desconhecido'}
Período: últimas ${hours} horas
Total de mensagens: ${messages.length}
Participantes: ${participants.join(', ')}

MENSAGENS:
${messageLog}`;

    const aiResult = await callAI(aiConfig, systemPrompt, userPrompt);
    if (!aiResult) {
      throw new Error('A IA não retornou um resultado válido para a ata. Tente novamente mais tarde.');
    }

    // Save to database
    const periodStart = messages[0]?.created_at;
    const periodEnd = messages[messages.length - 1]?.created_at;

    const insertResult = await query(
      `INSERT INTO group_secretary_meeting_minutes 
       (organization_id, conversation_id, group_name, title, summary, decisions, action_items, participants, message_count, period_start, period_end, ai_provider, ai_model, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        organizationId, conversationId, conv.group_name || 'Grupo',
        aiResult.title || 'Ata de Reunião',
        aiResult.summary || '',
        JSON.stringify(aiResult.decisions || []),
        JSON.stringify(aiResult.action_items || []),
        participants,
        messages.length,
        periodStart, periodEnd,
        aiConfig.provider, aiConfig.model,
        generatedBy,
      ]
    );

    logInfo('group_secretary.meeting_minutes_generated', {
      conversationId, groupName: conv.group_name, messageCount: messages.length,
    });

    return insertResult.rows[0];
  } catch (error) {
    logError('group_secretary.meeting_minutes_error', error);
    throw error; // Rethrow to let the router handle it
  }
}

/**
 * Call AI provider with a larger token budget for narrative outputs.
 */
async function callAINarrative(config, systemPrompt, userPrompt) {
  try {
    let response;
    if (config.provider === 'openai') {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 1800,
          response_format: { type: 'json_object' },
        }),
      });
    } else if (config.provider === 'gemini') {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.model || 'gemini-2.0-flash'}:generateContent?key=${config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 1800,
              responseMimeType: 'application/json',
            },
          }),
        }
      );
    } else {
      return null;
    }
    if (!response.ok) {
      const txt = await response.text();
      logError('group_secretary.narrative_ai_call', new Error(`AI ${response.status}: ${txt}`));
      return null;
    }
    const data = await response.json();
    const content = config.provider === 'openai'
      ? data.choices?.[0]?.message?.content
      : data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) return null;
    return JSON.parse(content);
  } catch (e) {
    logError('group_secretary.narrative_parse', e);
    return null;
  }
}

/**
 * Generate AI narrative summaries for each monitored group over the last N hours.
 * Returns an array of { groupName, summary, key_points, decisions, action_items, participants, messageCount }
 */
export async function generateGroupsNarrativeSummary({ organizationId, hours = 24, maxGroups = 10 }) {
  const configResult = await query(
    `SELECT * FROM group_secretary_config WHERE organization_id = $1`,
    [organizationId]
  );
  const config = configResult.rows[0] || {};
  const aiConfig = await getAIConfig(organizationId, config);
  if (!aiConfig || !aiConfig.apiKey) {
    return { error: 'no_ai_config', groups: [] };
  }

  // Find candidate groups: monitored groups with recent messages
  let groupsQuery = `
    SELECT c.id, c.group_name, c.remote_jid
    FROM conversations c
    JOIN connections conn ON conn.id = c.connection_id
    WHERE conn.organization_id = $1 AND c.is_group = true
  `;
  const params = [organizationId];
  if (config.group_jids && config.group_jids.length > 0) {
    params.push(config.group_jids);
    groupsQuery += ` AND c.remote_jid = ANY($${params.length})`;
  }
  if (config.connection_ids && config.connection_ids.length > 0) {
    params.push(config.connection_ids);
    groupsQuery += ` AND c.connection_id = ANY($${params.length})`;
  }
  groupsQuery += ` ORDER BY c.last_message_at DESC NULLS LAST LIMIT 50`;
  const groupsResult = await query(groupsQuery, params);

  const results = [];
  for (const grp of groupsResult.rows) {
    if (results.length >= maxGroups) break;
    try {
      const msgs = await query(
        `SELECT content, sender_name, timestamp
         FROM chat_messages
         WHERE conversation_id = $1
           AND timestamp >= NOW() - INTERVAL '1 hour' * $2
           AND content IS NOT NULL AND content != ''
           AND message_type IN ('text','extendedTextMessage','conversation','chat')
         ORDER BY timestamp ASC
         LIMIT 400`,
        [grp.id, hours]
      );
      if (msgs.rows.length < 3) continue;
      const participants = [...new Set(msgs.rows.map(m => m.sender_name).filter(Boolean))];
      const log = msgs.rows.map(m => {
        const t = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `[${t}] ${m.sender_name || 'Desconhecido'}: ${m.content}`;
      }).join('\n');

      const systemPrompt = `Você é uma secretária executiva analisando conversas de grupos de WhatsApp.
Produza um resumo NARRATIVO e DETALHADO do que foi discutido, no estilo de uma ata, mas em formato corrido e completo.

Retorne SOMENTE JSON válido:
{
  "summary": "Resumo narrativo completo em 2 a 4 parágrafos, descrevendo claramente os assuntos discutidos, contexto, posições dos participantes e desdobramentos. NÃO seja superficial.",
  "key_points": ["Ponto-chave 1", "Ponto-chave 2", "..."],
  "decisions": ["Decisão tomada 1", "..."],
  "action_items": [{"task": "Tarefa", "responsible": "Nome ou null", "deadline": "Prazo ou null"}],
  "highlights": ["Trecho ou citação relevante 1", "..."]
}

REGRAS:
- Escreva em português do Brasil
- Cite nomes de participantes quando relevante
- Inclua TODOS os temas tratados (não resuma demais)
- Ignore apenas saudações e mensagens triviais
- Se não houve decisões ou ações, retorne arrays vazios`;

      const userPrompt = `Grupo: ${grp.group_name || 'Sem nome'}
Período: últimas ${hours} horas
Participantes (${participants.length}): ${participants.join(', ')}
Total de mensagens: ${msgs.rows.length}

MENSAGENS:
${log}`;

      const ai = await callAINarrative(aiConfig, systemPrompt, userPrompt);
      if (!ai) continue;
      results.push({
        groupName: grp.group_name || 'Grupo',
        summary: ai.summary || '',
        key_points: ai.key_points || [],
        decisions: ai.decisions || [],
        action_items: ai.action_items || [],
        highlights: ai.highlights || [],
        participants,
        messageCount: msgs.rows.length,
      });
    } catch (err) {
      logError('group_secretary.group_narrative_error', err);
    }
  }
  return { groups: results };
}
