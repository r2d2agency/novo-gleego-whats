// Wait Reply Timeout Scheduler
// Checks for flow sessions waiting for a reply that have timed out
import { query } from './db.js';

/**
 * Resume a flow from the timeout handle of a wait_reply node
 */
async function resumeFlowTimeout(session) {
  try {
    const { flow_id: flowId, conversation_id: conversationId, current_node_id: currentNodeId } = session;
    const variables = typeof session.variables === 'string'
      ? JSON.parse(session.variables || '{}')
      : (session.variables || {});

    console.log(`[WaitReply] Timeout triggered for conversation ${conversationId}, current node ${currentNodeId}, flow ${flowId}`);

    // Clear wait_reply metadata first
    await query(
      `UPDATE flow_sessions SET wait_reply_expires_at = NULL, wait_reply_variable = NULL, updated_at = NOW()
       WHERE conversation_id = $1 AND is_active = true`,
      [conversationId]
    );

    // Find the "timeout" edge from the current node
    const edgesResult = await query(
      'SELECT * FROM flow_edges WHERE flow_id = $1 AND source_node_id = $2',
      [flowId, currentNodeId]
    );

    console.log(`[WaitReply] Found ${edgesResult.rows.length} edges from node ${currentNodeId}:`, 
      edgesResult.rows.map(e => `${e.source_handle || 'default'} -> ${e.target_node_id}`).join(', '));

    const timeoutEdge = edgesResult.rows.find(e => e.source_handle === 'timeout') || null;

    if (!timeoutEdge) {
      console.log(`[WaitReply] No timeout edge found for node ${currentNodeId}, completing flow`);
      await query(
        `UPDATE flow_sessions SET is_active = false, ended_at = NOW() WHERE conversation_id = $1 AND is_active = true`,
        [conversationId]
      );
      return;
    }

    const nextNodeId = timeoutEdge.target_node_id;
    console.log(`[WaitReply] Following timeout edge to node ${nextNodeId}`);

    // Update session to next node BEFORE calling continueFlowAfterTimeout
    await query(
      `UPDATE flow_sessions 
       SET variables = $1, current_node_id = $2, updated_at = NOW()
       WHERE conversation_id = $3 AND is_active = true`,
      [JSON.stringify(variables), nextNodeId, conversationId]
    );

    // Continue the flow from the timeout target node
    try {
      const { continueFlowAfterTimeout } = await import('./lib/flow-executor.js');
      if (typeof continueFlowAfterTimeout === 'function') {
        const result = await continueFlowAfterTimeout(conversationId, flowId, nextNodeId, variables);
        console.log(`[WaitReply] Flow continued after timeout:`, result?.success ? 'success' : result?.error || 'unknown error');
      } else {
        console.error(`[WaitReply] continueFlowAfterTimeout not available as function, completing session`);
        await query(
          `UPDATE flow_sessions SET is_active = false, ended_at = NOW() WHERE conversation_id = $1 AND is_active = true`,
          [conversationId]
        );
      }
    } catch (flowError) {
      console.error(`[WaitReply] Error continuing flow after timeout:`, flowError);
      // Don't leave session hanging - mark as complete on error
      await query(
        `UPDATE flow_sessions SET is_active = false, ended_at = NOW() WHERE conversation_id = $1 AND is_active = true`,
        [conversationId]
      );
    }

    console.log(`[WaitReply] Timeout handled for conversation ${conversationId}, moved to node ${nextNodeId}`);
  } catch (error) {
    console.error(`[WaitReply] Error handling timeout for session:`, error);
  }
}

/**
 * Check for expired wait_reply sessions and trigger timeout path
 */
export async function executeWaitReplyTimeouts() {
  try {
    // Find active sessions where wait_reply has expired
    const result = await query(
      `SELECT fs.*
       FROM flow_sessions fs
       LEFT JOIN flows f ON f.id = fs.flow_id
       WHERE fs.is_active = true
         AND fs.wait_reply_expires_at IS NOT NULL
         AND fs.wait_reply_expires_at <= NOW()
         AND (f.id IS NULL OR f.is_active = true)
       LIMIT 20`
    );

    if (result.rows.length === 0) return;

    console.log(`[WaitReply] Found ${result.rows.length} expired wait_reply sessions`);

    for (const session of result.rows) {
      console.log(`[WaitReply] Processing session: conv=${session.conversation_id}, flow=${session.flow_id}, node=${session.current_node_id}, expires=${session.wait_reply_expires_at}`);
      await resumeFlowTimeout(session);
      // Small delay between processing
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (error) {
    console.error('[WaitReply] Scheduler error:', error);
  }
}
