import { query } from './db.js';
import { logInfo, logError } from './logger.js';

export async function executeDailyAudit(organizationId = null) {
  logInfo(`[Supervisor] Starting daily audit${organizationId ? ` for org ${organizationId}` : ''}...`);
  let totalFindings = 0;
  try {
    const params = [];
    let where = `WHERE d.status = 'open'`;
    if (organizationId) {
      params.push(organizationId);
      where += ` AND d.organization_id = $${params.length}`;
    }
    const deals = await query(`
      SELECT d.*, s.new_lead_sla_minutes, s.no_followup_sla_hours, s.no_response_sla_days, s.monitored_tags
      FROM crm_deals d
      JOIN supervisor_settings s ON s.organization_id = d.organization_id
      ${where}
    `, params);

    for (const deal of deals.rows) {
      const findings = [];
      
      // 1. Check No Approach
      if (!deal.first_seller_message_at) {
        const diffMin = (new Date() - new Date(deal.created_at)) / 60000;
        if (diffMin > (deal.new_lead_sla_minutes || 30)) {
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

      // 4. Tag-based Engagement Analysis (New Feature)
      if (deal.monitored_tags && Array.isArray(deal.monitored_tags) && deal.monitored_tags.length > 0) {
        const dealTags = Array.isArray(deal.tags) ? deal.tags : [];
        const matchesMonitoredTag = dealTags.some(t => deal.monitored_tags.includes(t));
        
        if (matchesMonitoredTag) {
          // Check engagement: if last customer message was > 3 days ago and seller asked something
          const threeDaysAgo = new Date();
          threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
          
          if (deal.last_customer_message_at && new Date(deal.last_customer_message_at) < threeDaysAgo) {
            findings.push({
              status: 'baixa_engajamento',
              reason: `Cliente da tag monitorada não responde há mais de 3 dias (Última: ${new Date(deal.last_customer_message_at).toLocaleString()}).`,
              action: 'Tentar reengajamento com nova abordagem.',
              urgency: 'medium'
            });
          }
        }
      }

      // Record findings
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

    logInfo(`[Supervisor] Daily audit complete. Processed ${deals.rows.length} deals, ${totalFindings} findings.`);
    return { dealsProcessed: deals.rows.length, findings: totalFindings };
  } catch (error) {
    logError('[Supervisor] Daily audit failed', error);
    throw error;
  }
}
