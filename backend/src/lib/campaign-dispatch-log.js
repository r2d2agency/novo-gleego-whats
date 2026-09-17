import { query } from '../db.js';

/**
 * Durable campaign dispatch logs.
 *
 * campaign_messages is operational state (pending/processing/sent/failed) and
 * gets mutated by retries, pause/resume and duplicate-cancellation. The
 * dispatch log is an append-only audit trail: one row per dispatch attempt,
 * written by the scheduler, readable through the tenant-scoped campaign logs API.
 */

/**
 * Append one dispatch attempt. Never throws — logging must not break dispatch.
 *
 * @param {object} entry
 * @param {string} entry.campaignId            campaigns.id
 * @param {string|null} [entry.campaignMessageId] campaign_messages.id
 * @param {string|null} [entry.organizationId] connections.organization_id (tenant scope)
 * @param {string|null} [entry.userId]         campaign owner (campaigns.user_id)
 * @param {string|null} [entry.contactId]      contacts.id
 * @param {string} entry.phone                 destination phone
 * @param {string} [entry.channel]             text | media | template | flow
 * @param {string|null} [entry.provider]       wapi | uazapi | meta
 * @param {string} entry.status                sent | failed
 * @param {string|null} [entry.errorMessage]   translated error message on failure
 * @param {string|null} [entry.whatsappMessageId] provider message id on success
 * @param {object} [entry.metadata]            extra context (items count, flow name, ...)
 * @returns {Promise<string|null>} log row id, or null when the write failed
 */
export async function logDispatch(entry) {
  try {
    const result = await query(
      `INSERT INTO campaign_dispatch_logs
        (campaign_id, campaign_message_id, organization_id, user_id, contact_id,
         phone, channel, provider, status, error_message, whatsapp_message_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       RETURNING id`,
      [
        entry.campaignId,
        entry.campaignMessageId ?? null,
        entry.organizationId ?? null,
        entry.userId ?? null,
        entry.contactId ?? null,
        entry.phone,
        entry.channel || 'text',
        entry.provider ?? null,
        entry.status,
        entry.errorMessage ?? null,
        entry.whatsappMessageId ?? null,
        JSON.stringify(entry.metadata || {}),
      ]
    );
    return result.rows[0]?.id || null;
  } catch (error) {
    // Table may not exist yet on a fresh deployment that skipped migrations,
    // or a transient DB hiccup — dispatch itself must continue.
    console.warn('⚠ [CAMPAIGN-LOG] Failed to write dispatch log:', error.message);
    return null;
  }
}

/**
 * Read dispatch logs for a campaign. Tenant scoping is enforced by the caller
 * (routes layer validates the campaign belongs to the user's organization);
 * when an organizationId is passed it is also applied as a WHERE condition on
 * the logs themselves (defense in depth for legacy rows without a tenant id).
 *
 * @param {object} opts
 * @param {string} opts.campaignId
 * @param {string|null} [opts.organizationId] extra tenant filter on the log rows
 * @param {string|null} [opts.status]        filter: sent | failed
 * @param {string|null} [opts.channel]       filter: text | media | template | flow
 * @param {number} [opts.limit=100]
 * @param {number} [opts.offset=0]
 * @returns {Promise<{rows: object[], total: number}>}
 */
export async function getDispatchLogs({ campaignId, organizationId, status, channel, limit = 100, offset = 0 }) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const where = ['campaign_id = $1'];
  const params = [campaignId];

  if (organizationId) {
    params.push(organizationId);
    where.push(`(organization_id = $${params.length} OR organization_id IS NULL)`);
  }

  if (status && ['sent', 'failed'].includes(status)) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (channel) {
    params.push(channel);
    where.push(`channel = $${params.length}`);
  }

  const rows = await query(
    `SELECT id, campaign_id, campaign_message_id, organization_id, user_id,
            contact_id, phone, channel, provider, status, error_message,
            whatsapp_message_id, metadata, dispatched_at
     FROM campaign_dispatch_logs
     WHERE ${where.join(' AND ')}
     ORDER BY dispatched_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, safeLimit, safeOffset]
  );

  const totalResult = await query(
    `SELECT COUNT(*)::int as total FROM campaign_dispatch_logs WHERE ${where.join(' AND ')}`,
    params
  );

  return { rows: rows.rows, total: totalResult.rows[0]?.total || 0 };
}
