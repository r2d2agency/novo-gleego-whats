import { query } from './db.js';
import { logInfo, logError } from './logger.js';

export async function executeDailyAudit(organizationId = null) {
  logInfo(`[Supervisor] Starting daily audit${organizationId ? ` for org ${organizationId}` : ''}...`);
  let totalFindings = 0;
  try {
    const settingsResult = await query(
      `SELECT * FROM supervisor_settings WHERE organization_id = $1`,
      [organizationId]
    );
    const settings = settingsResult.rows[0];
    
    if (!settings) {
      logInfo(`[Supervisor] No settings found for org ${organizationId}. Skipping.`);
      return { dealsProcessed: 0, findings: 0 };
    }

    const monitoredFunnels = settings.monitored_funnels;
    const monitoredTags = settings.monitored_tags || [];
    
    // 1. Process CRM Deals
    const dealsParams = [organizationId];
    let dealsWhere = `WHERE d.organization_id = $1 AND d.status = 'open'`;
    
    if (monitoredFunnels && Array.isArray(monitoredFunnels) && monitoredFunnels.length > 0) {
      dealsParams.push(monitoredFunnels);
      dealsWhere += ` AND d.funnel_id = ANY($${dealsParams.length})`;
    }

    const deals = await query(`
      SELECT d.*, s.new_lead_sla_minutes, s.no_followup_sla_hours, s.no_response_sla_days, s.monitored_tags
      FROM crm_deals d
      JOIN supervisor_settings s ON s.organization_id = d.organization_id
      ${dealsWhere}
    `, dealsParams);

    for (const deal of deals.rows) {
      const findings = analyzeDealEngagement(deal, settings);
      
      for (const finding of findings) {
        await query(
          `INSERT INTO supervisor_audits (
            organization_id, deal_id, owner_id, status_found, reason, suggested_action, urgency
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [deal.organization_id, deal.id, deal.owner_id, finding.status, finding.reason, finding.action, finding.urgency]
        );
        totalFindings++;
      }
    }

    // 2. Process Conversations (for tag-based monitoring even without CRM deals)
    let processedConversations = 0;
    if (monitoredTags.length > 0) {
      const convs = await query(`
        SELECT c.*, s.new_lead_sla_minutes, s.no_response_sla_days
        FROM conversations c
        JOIN supervisor_settings s ON s.organization_id = c.organization_id
        WHERE c.organization_id = $1 
          AND c.tags && $2
          AND c.is_archived = false
      `, [organizationId, monitoredTags]);

      processedConversations = convs.rows.length;

      for (const conv of convs.rows) {
        // Skip if this conversation is already linked to a deal we just processed
        const isLinkedToDeal = deals.rows.some(d => d.contact_phone === conv.contact_phone || d.jid === conv.remote_jid);
        if (isLinkedToDeal) continue;

        const findings = analyzeConversationEngagement(conv, settings);
        
        for (const finding of findings) {
          await query(
            `INSERT INTO supervisor_audits (
              organization_id, conversation_id, owner_id, status_found, reason, suggested_action, urgency
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [conv.organization_id, conv.id, conv.assigned_to, finding.status, finding.reason, finding.action, finding.urgency]
          );
          totalFindings++;
        }
      }
    }

    logInfo(`[Supervisor] Daily audit complete. Processed ${deals.rows.length} deals and ${processedConversations} conversations. Total findings: ${totalFindings}`);
    return { dealsProcessed: deals.rows.length + processedConversations, findings: totalFindings };
  } catch (error) {
    logError('[Supervisor] Daily audit failed', error);
    throw error;
  }
}

function analyzeDealEngagement(deal, settings) {
  const findings = [];
  
  // 1. Check No Approach
  if (!deal.first_seller_message_at) {
    const diffMin = (new Date() - new Date(deal.created_at)) / 60000;
    if (diffMin > (settings.new_lead_sla_minutes || 30)) {
      findings.push({
        status: 'sem_abordagem',
        reason: `Lead entrou em ${new Date(deal.created_at).toLocaleString()} e não recebeu abordagem.`,
        action: 'Entrar em contato imediatamente.',
        urgency: 'high'
      });
    }
  }

  // 2. Check No Follow-up
  if (deal.next_followup_at && new Date(deal.next_followup_at) < new Date()) {
    findings.push({
      status: 'followup_atrasado',
      reason: `Follow-up agendado para ${new Date(deal.next_followup_at).toLocaleString()} está atrasado.`,
      action: 'Realizar follow-up agora.',
      urgency: 'medium'
    });
  }

  // 3. Check No Response from Seller (Lead waiting)
  if (deal.last_customer_message_at && deal.last_seller_message_at && 
      new Date(deal.last_customer_message_at) > new Date(deal.last_seller_message_at)) {
    findings.push({
      status: 'aguardando_retorno',
      reason: `Cliente respondeu em ${new Date(deal.last_customer_message_at).toLocaleString()} e aguarda retorno.`,
      action: 'Responder ao cliente.',
      urgency: 'high'
    });
  }

  // 4. Tag-based Engagement Analysis
  const monitoredTags = settings.monitored_tags || [];
  if (monitoredTags.length > 0) {
    const dealTags = Array.isArray(deal.tags) ? deal.tags : [];
    const matchesMonitoredTag = dealTags.some(t => monitoredTags.includes(t));
    
    if (matchesMonitoredTag) {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      
      if (deal.last_customer_message_at && new Date(deal.last_customer_message_at) < threeDaysAgo) {
        findings.push({
          status: 'baixa_engajamento',
          reason: `Lead da tag monitorada parado há mais de 3 dias.`,
          action: 'Tentar reengajamento.',
          urgency: 'medium'
        });
      }
    }
  }

  return findings;
}

function analyzeConversationEngagement(conv, settings) {
  const findings = [];
  
  // 1. Check No Approach (No seller message ever)
  if (!conv.last_seller_message_at) {
    const diffMin = (new Date() - new Date(conv.created_at)) / 60000;
    if (diffMin > (settings.new_lead_sla_minutes || 30)) {
      findings.push({
        status: 'sem_abordagem',
        reason: `Conversa iniciada em ${new Date(conv.created_at).toLocaleString()} e nunca recebeu resposta do vendedor.`,
        action: 'Iniciar atendimento.',
        urgency: 'high'
      });
    }
  }

  // 2. Check No Response (Last message is from customer)
  if (conv.last_customer_message_at && (!conv.last_seller_message_at || new Date(conv.last_customer_message_at) > new Date(conv.last_seller_message_at))) {
    const diffDays = (new Date() - new Date(conv.last_customer_message_at)) / (1000 * 60 * 60 * 24);
    if (diffDays > (settings.no_response_sla_days || 2)) {
      findings.push({
        status: 'aguardando_retorno',
        reason: `Cliente aguarda resposta há ${Math.floor(diffDays)} dias.`,
        action: 'Responder ao cliente.',
        urgency: 'high'
      });
    }
  }

  // 3. Low engagement for monitored tags
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  if (conv.last_customer_message_at && new Date(conv.last_customer_message_at) < threeDaysAgo) {
    findings.push({
      status: 'baixa_engajamento',
      reason: `Contato monitorado por tag sem interação há mais de 3 dias.`,
      action: 'Tentar reengajamento.',
      urgency: 'medium'
    });
  }

  return findings;
}

