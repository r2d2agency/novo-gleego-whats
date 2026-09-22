// Flow Executor - Processes visual flow nodes and sends messages
import { query } from '../db.js';
import * as whatsappProvider from './whatsapp-provider.js';
import { sendMetaTemplate } from './meta-template-send.js';

// In-memory execution logs for debugging (per conversation, limited)
const EXECUTION_LOGS_MAX_PER_CONVERSATION = 100;
const EXECUTION_LOGS_MAX_CONVERSATIONS = 50;
const executionLogs = new Map(); // Map<conversationId, Array<ExecutionLogEntry>>

/**
 * Add an execution log entry
 */
export function addExecutionLog(conversationId, entry) {
  if (!executionLogs.has(conversationId)) {
    executionLogs.set(conversationId, []);
  }
  const logs = executionLogs.get(conversationId);
  logs.unshift({
    at: new Date().toISOString(),
    ...entry,
  });
  // Limit logs per conversation
  if (logs.length > EXECUTION_LOGS_MAX_PER_CONVERSATION) {
    logs.length = EXECUTION_LOGS_MAX_PER_CONVERSATION;
  }
  // Limit total conversations tracked
  if (executionLogs.size > EXECUTION_LOGS_MAX_CONVERSATIONS) {
    const keys = Array.from(executionLogs.keys());
    executionLogs.delete(keys[keys.length - 1]);
  }
}

/**
 * Get execution logs for a conversation or all
 */
export function getExecutionLogs(conversationId = null, limit = 100) {
  if (conversationId) {
    return (executionLogs.get(conversationId) || []).slice(0, limit);
  }
  // Return all logs flattened, sorted by time
  const all = [];
  executionLogs.forEach((logs, convId) => {
    logs.forEach(log => all.push({ ...log, conversationId: convId }));
  });
  all.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return all.slice(0, limit);
}

/**
 * Clear execution logs
 */
export function clearExecutionLogs(conversationId = null) {
  if (conversationId) {
    executionLogs.delete(conversationId);
  } else {
    executionLogs.clear();
  }
}

/**
 * Execute a flow starting from a given node
 * @param {string} flowId - The flow ID to execute
 * @param {string} conversationId - The conversation ID
 * @param {string} startNodeId - The node ID to start from (default: 'start')
 * @param {object} initialVariables - Optional initial variables to inject (for campaigns)
 */
export async function executeFlow(flowId, conversationId, startNodeId = 'start', initialVariables = {}) {
  try {
    console.log(`Flow executor: Starting flow ${flowId} for conversation ${conversationId}`);
    
    // Get conversation and connection info
    const convResult = await query(
      `SELECT c.*, 
              conn.api_url, conn.api_key, conn.instance_name, conn.instance_id, 
              conn.wapi_token, conn.provider,
              conn.uazapi_url, conn.uazapi_token,
              conn.meta_token, conn.meta_phone_number_id, conn.meta_waba_id
       FROM conversations c
       JOIN connections conn ON conn.id = c.connection_id
       WHERE c.id = $1`,
      [conversationId]
    );

    if (convResult.rows.length === 0) {
      console.error('Flow executor: Conversation not found:', conversationId);
      return { success: false, error: 'Conversa não encontrada' };
    }

    const conversation = convResult.rows[0];
    const connection = {
      id: conversation.connection_id,
      api_url: conversation.api_url,
      api_key: conversation.api_key,
      instance_name: conversation.instance_name,
      instance_id: conversation.instance_id,
      wapi_token: conversation.wapi_token,
      provider: conversation.provider,
      uazapi_url: conversation.uazapi_url,
      uazapi_token: conversation.uazapi_token,
      meta_token: conversation.meta_token,
      meta_phone_number_id: conversation.meta_phone_number_id,
      meta_waba_id: conversation.meta_waba_id,
    };

    console.log(`Flow executor: Connection provider: ${connection.provider}, instance: ${connection.instance_name || connection.instance_id}`);

    // Get all nodes and edges for this flow
    const [nodesResult, edgesResult] = await Promise.all([
      query('SELECT * FROM flow_nodes WHERE flow_id = $1', [flowId]),
      query('SELECT * FROM flow_edges WHERE flow_id = $1', [flowId]),
    ]);

    const nodes = nodesResult.rows;
    const edges = edgesResult.rows;

    console.log(`Flow executor: Found ${nodes.length} nodes and ${edges.length} edges`);

    if (nodes.length === 0) {
      return { success: false, error: 'Fluxo sem nós configurados' };
    }

    // Create a map for easy node lookup
    const nodeMap = new Map();
    nodes.forEach(node => {
      nodeMap.set(node.node_id, node);
      console.log(`Flow executor: Node mapped: ${node.node_id} (${node.node_type})`);
    });

    // Create edge map (source_node_id -> edges)
    // Sort edges by target node's Y position to maintain visual flow order
    const edgeMap = new Map();
    edges.forEach(edge => {
      const key = edge.source_node_id;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, []);
      }
      edgeMap.get(key).push(edge);
    });
    
    // Sort edges by target node's Y position (top to bottom = execution order)
    edgeMap.forEach((edgeList, key) => {
      edgeList.sort((a, b) => {
        const nodeA = nodeMap.get(a.target_node_id);
        const nodeB = nodeMap.get(b.target_node_id);
        // Primary sort: Y position (top first)
        const yA = nodeA?.position_y ?? 0;
        const yB = nodeB?.position_y ?? 0;
        if (yA !== yB) return yA - yB;
        // Secondary sort: X position (left first)
        const xA = nodeA?.position_x ?? 0;
        const xB = nodeB?.position_x ?? 0;
        return xA - xB;
      });
    });

    // Initialize session variables - merge conversation data with initial variables from campaigns
    const variables = {
      nome: conversation.contact_name || '',
      telefone: conversation.contact_phone || '',
      ...initialVariables, // Allow campaigns to override/inject variables
    };

    // Try to load deal context + custom_fields if this conversation has a linked deal
    try {
      const dealVarsResult = await query(
        `SELECT d.id as deal_id, d.title as deal_title, d.value as deal_value, d.status as deal_status,
                d.funnel_id as deal_funnel_id, d.stage_id as deal_stage_id, d.custom_fields,
                d.source as deal_source, d.probability as deal_probability,
                s.name as deal_stage_name, f.name as deal_funnel_name,
                co.name as deal_company_name
         FROM crm_deals d
         JOIN crm_deal_contacts dc ON dc.deal_id = d.id
         JOIN contacts c ON c.id = dc.contact_id
         LEFT JOIN crm_stages s ON s.id = d.stage_id
         LEFT JOIN crm_funnels f ON f.id = d.funnel_id
         LEFT JOIN crm_companies co ON co.id = d.company_id
         WHERE c.phone = $1 AND d.status = 'open'
         ORDER BY d.updated_at DESC LIMIT 1`,
        [conversation.contact_phone]
      );
      if (dealVarsResult.rows[0]) {
        const deal = dealVarsResult.rows[0];
        // Inject standard deal fields
        variables.deal_id = deal.deal_id || '';
        variables.deal_title = deal.deal_title || '';
        variables.deal_value = deal.deal_value || 0;
        variables.deal_status = deal.deal_status || '';
        variables.deal_stage_id = deal.deal_stage_id || '';
        variables.deal_stage_name = deal.deal_stage_name || '';
        variables.deal_funnel_id = deal.deal_funnel_id || '';
        variables.deal_funnel_name = deal.deal_funnel_name || '';
        variables.deal_company_name = deal.deal_company_name || '';
        variables.deal_source = deal.deal_source || '';
        variables.deal_probability = deal.deal_probability || 0;

        // Inject custom fields
        if (deal.custom_fields) {
          const cf = typeof deal.custom_fields === 'string'
            ? JSON.parse(deal.custom_fields)
            : deal.custom_fields;
          for (const [k, v] of Object.entries(cf)) {
            if (!(k in variables) && v !== null && v !== undefined) {
              variables[k] = v;
            }
          }
        }
      }
    } catch (cfErr) {
      console.log('Flow executor: Could not load deal context:', cfErr.message);
    }

    // Create or update flow session to track state.
    // IMPORTANT: keep this compatible with backend/src/routes/flows.js (manual start)
    // so keyword-triggered flows can also be continued by webhooks.
    try {
      await query(
        `INSERT INTO flow_sessions (
          flow_id, conversation_id, contact_phone, current_node_id, is_active, started_by
        ) VALUES ($1, $2, $3, 'start', true, $4)
        ON CONFLICT (conversation_id) WHERE is_active = true
        DO UPDATE SET
          flow_id = $1,
          current_node_id = 'start',
          started_at = NOW(),
          started_by = $4,
          variables = '{}'`,
        // started_by can be null for system/keyword triggers
        [flowId, conversationId, conversation.contact_phone, null]
      );

      // Ensure initial variables are present (update after upsert)
      await query(
        `UPDATE flow_sessions
         SET variables = $1
         WHERE conversation_id = $2 AND flow_id = $3 AND is_active = true`,
        [JSON.stringify(variables), conversationId, flowId]
      );

      console.log(`Flow executor: Flow session ensured for conversation ${conversationId}`);
    } catch (sessionError) {
      console.log('Flow executor: flow_sessions table missing or incompatible, skipping session creation:', sessionError.message);
    }

    // Find the start node and its first connected node
    let currentNodeId = startNodeId;
    
    // If starting from 'start', find the first connected node
    if (startNodeId === 'start') {
      const startEdges = edgeMap.get('start') || [];
      if (startEdges.length > 0) {
        currentNodeId = startEdges[0].target_node_id;
        console.log(`Flow executor: Start node found, moving to first connected node: ${currentNodeId}`);
      } else {
        console.log('Flow executor: No edges from start node');
        return { success: false, error: 'Nó inicial não conectado a outros nós' };
      }
    }

    let processedNodes = 0;
    const maxNodes = 50; // Safety limit

    while (currentNodeId && processedNodes < maxNodes) {
      const node = nodeMap.get(currentNodeId);
      
      if (!node) {
        console.log('Flow executor: Node not found:', currentNodeId);
        addExecutionLog(conversationId, {
          type: 'error',
          flowId,
          nodeId: currentNodeId,
          nodeType: 'unknown',
          message: `Nó não encontrado: ${currentNodeId}`,
          step: processedNodes + 1,
        });
        return { success: false, error: `Nó não encontrado: ${currentNodeId}` };
      }

      processedNodes++;
      console.log(`Flow executor: Processing node ${node.node_id} (${node.node_type}) - content:`, JSON.stringify(node.content).substring(0, 200));

      // Log node processing start
      addExecutionLog(conversationId, {
        type: 'node_start',
        flowId,
        nodeId: node.node_id,
        nodeType: node.node_type,
        nodeName: node.name || node.node_id,
        step: processedNodes,
        message: `Executando nó: ${node.name || node.node_id} (${node.node_type})`,
      });

      // Process the node based on its type
      const result = await processNode(node, connection, conversation.contact_phone, variables, conversationId);

      if (!result.success) {
        console.error('Flow executor: Node processing failed:', result.error || 'Erro desconhecido');
        addExecutionLog(conversationId, {
          type: 'error',
          flowId,
          nodeId: node.node_id,
          nodeType: node.node_type,
          step: processedNodes,
          message: `Erro no nó: ${result.error || 'Erro desconhecido'}`,
        });
        return { success: false, error: result.error || `Falha ao executar nó ${node.node_id}` };
      }

      // If node requires user input, stop here and wait
      if (result.waitForInput) {
        addExecutionLog(conversationId, {
          type: 'waiting_input',
          flowId,
          nodeId: node.node_id,
          nodeType: node.node_type,
          step: processedNodes,
          message: `Aguardando entrada do usuário`,
          variables: { ...variables },
        });
        // Update session with current state
        await updateFlowSession(flowId, conversationId, currentNodeId, variables);
        return { success: true, waitingForInput: true, currentNode: currentNodeId };
      }

      // Get next node
      const outgoingEdges = edgeMap.get(currentNodeId) || [];
      
      if (outgoingEdges.length === 0) {
        // No more nodes - flow complete
        console.log('Flow executor: No more edges, flow complete');
        addExecutionLog(conversationId, {
          type: 'flow_complete',
          flowId,
          nodeId: node.node_id,
          step: processedNodes,
          message: `Fluxo finalizado após ${processedNodes} nós`,
        });
        break;
      }

      // For now, follow the first edge (or handle specific routing based on node type)
      const nextEdge = result.nextHandle 
        ? outgoingEdges.find(e => e.source_handle === result.nextHandle) || outgoingEdges[0]
        : outgoingEdges[0];

      const previousNodeId = currentNodeId;
      currentNodeId = nextEdge?.target_node_id;
      
      addExecutionLog(conversationId, {
        type: 'transition',
        flowId,
        fromNodeId: previousNodeId,
        toNodeId: currentNodeId,
        step: processedNodes,
        message: `Transição: ${previousNodeId} → ${currentNodeId}`,
        handle: result.nextHandle || 'default',
      });
      
      console.log(`Flow executor: Moving to next node: ${currentNodeId}`);
    }

    if (processedNodes >= maxNodes && currentNodeId) {
      addExecutionLog(conversationId, {
        type: 'error',
        flowId,
        nodeId: currentNodeId,
        step: processedNodes,
        message: `Execução interrompida: limite de ${maxNodes} nós atingido`,
      });
      return { success: false, error: `Execução interrompida: limite de ${maxNodes} nós atingido` };
    }

    if (processedNodes === 0) {
      return { success: false, error: 'Fluxo não processou nenhum nó executável' };
    }

    return { success: true, nodesProcessed: processedNodes };
  } catch (error) {
    console.error('Flow executor error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Process a single node
 */
async function processNode(node, connection, phone, variables, conversationId) {
  const content = typeof node.content === 'string' 
    ? JSON.parse(node.content) 
    : (node.content || {});

  switch (node.node_type) {
    case 'start':
      // Start node - just continue to next
      return { success: true };

    case 'end':
      // End node - flow complete
      return { success: true };

    case 'message':
      return await processMessageNode(content, connection, phone, variables, conversationId);

    case 'menu':
      // Menu requires user input
      await processMenuNode(content, connection, phone, variables, conversationId);
      return { success: true, waitForInput: true };

    case 'input':
      // Input requires user input
      await processInputNode(content, connection, phone, variables, conversationId);
      return { success: true, waitForInput: true };

    case 'delay':
      // Frontend stores delay as { duration, unit }, but older payloads may use delay_seconds.
      // Support both formats.
      {
        const rawDelaySeconds = content.delay_seconds;
        const rawDuration = content.duration;
        const unit = String(content.unit || 'seconds');

        let delayMs = 1000;

        if (rawDelaySeconds !== undefined && rawDelaySeconds !== null && rawDelaySeconds !== '') {
          const seconds = Number(rawDelaySeconds);
          if (!Number.isNaN(seconds) && seconds > 0) delayMs = seconds * 1000;
        } else if (rawDuration !== undefined && rawDuration !== null && rawDuration !== '') {
          const duration = Number(rawDuration);
          if (!Number.isNaN(duration) && duration > 0) {
            const factor = unit === 'hours' ? 3600 : unit === 'minutes' ? 60 : 1;
            delayMs = duration * factor * 1000;
          }
        }

        console.log(`Flow executor: Delay node waiting ${delayMs}ms (unit=${unit})`);
        await sleep(delayMs);
        return { success: true };
      }

    case 'wait_reply':
      // Wait for reply node - pause and wait for user response with timeout
      {
        const timeoutValue = Number(content.timeout_value) || 24;
        const timeoutUnit = content.timeout_unit || 'hours';
        const factor = timeoutUnit === 'days' ? 86400 : timeoutUnit === 'hours' ? 3600 : 60;
        const timeoutSeconds = timeoutValue * factor;
        const expiresAt = new Date(Date.now() + timeoutSeconds * 1000).toISOString();

        // Store timeout metadata in session for the scheduler to check
        await query(
          `UPDATE flow_sessions 
           SET wait_reply_expires_at = $1, wait_reply_variable = $2, updated_at = NOW()
           WHERE conversation_id = $3 AND is_active = true`,
          [expiresAt, content.response_variable || null, conversationId]
        );

        console.log(`Flow executor: Wait reply node - waiting until ${expiresAt}`);
        return { success: true, waitForInput: true };
      }

    case 'condition':
      return processConditionNode(content, variables);

    case 'action':
      return await processActionNode(content, connection, phone, variables, conversationId);

    case 'external_send':
      return await processExternalSendNode(content, connection, variables, conversationId);

    default:
      console.log('Flow executor: Unknown node type:', node.node_type);
      return { success: true };
  }
}

/**
 * Helper to save sent message to database
 */
async function saveSentMessage(conversationId, content, messageType, mediaUrl = null, messageId = null) {
  try {
    // Flow sends are persisted optimistically and reconciled with the provider webhook.
    // Mark the synthetic ID as temp and set sender_id so W-API can replace it with
    // the real provider ID instead of inserting a second bubble.
    const dbMessageId = messageId || `temp_flow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await query(
      `INSERT INTO chat_messages
        (conversation_id, message_id, from_me, content, message_type, media_url, sender_id, status, timestamp)
       VALUES ($1, $2, true, $3, $4, $5, 'flow', 'sent', NOW())`,
      [conversationId, dbMessageId, content, messageType, mediaUrl]
    );
    
    // Update conversation last_message
    await query(
      `UPDATE conversations SET last_message_at = NOW() WHERE id = $1`,
      [conversationId]
    );
    
    console.log(`Flow executor: Message saved to database - type: ${messageType}, content: ${content?.substring(0, 30) || 'N/A'}`);
    return dbMessageId;
  } catch (error) {
    console.error('Flow executor: Error saving message to database:', error);
    return null;
  }
}

/**
 * Process message node - send text/media
 */
async function processMessageNode(content, connection, phone, variables, conversationId) {
  const mediaType = content.media_type || 'text';

  console.log(`Flow executor: processMessageNode - mediaType: ${mediaType}`, JSON.stringify(content).substring(0, 300));

  try {
    const ensureSent = (result, nodeType) => {
      if (!result?.success) {
        throw new Error(result?.error || `Falha ao enviar mensagem no nó ${nodeType}`);
      }
    };

    if (mediaType === 'meta_template') {
      if (connection.provider !== 'meta' || !connection.meta_token || !connection.meta_phone_number_id) {
        throw new Error('Nó de Template Meta exige uma conexão Meta Cloud API');
      }
      const contact = {
        name: variables?.nome || variables?.name || '',
        phone: variables?.telefone || variables?.phone || phone || '',
        email: variables?.email || '',
        company: variables?.company_name || variables?.empresa || '',
      };
      const components = content.template_components || [];
      const paramValues = content.template_params || {};
      // Resolve {variable} tokens in params using current flow variables before sending
      const resolvedParams = {};
      for (const [k, v] of Object.entries(paramValues)) {
        resolvedParams[k] = replaceVariables(String(v || ''), variables);
      }
      const { metaMessageId, readable } = await sendMetaTemplate({
        metaToken: connection.meta_token,
        metaPhoneNumberId: connection.meta_phone_number_id,
        toPhone: phone,
        templateName: content.template_name,
        language: content.template_language || 'pt_BR',
        components,
        paramValues: resolvedParams,
        contact,
      });
      await saveSentMessage(conversationId, `📋 ${readable}`, 'text', null, metaMessageId);
    } else if (mediaType === 'gallery' && content.gallery_images?.length > 0) {
      // Send gallery images sequentially with proper delay
      console.log(`Flow executor: Sending gallery with ${content.gallery_images.length} images`);
      for (let i = 0; i < content.gallery_images.length; i++) {
        const img = content.gallery_images[i];
        const caption = i === 0 && content.caption ? replaceVariables(content.caption, variables) : '';
        
        console.log(`Flow executor: Sending gallery image ${i + 1}: ${img.url?.substring(0, 50)}`);
        const result = await whatsappProvider.sendMessage(connection, phone, caption, 'image', img.url);
        ensureSent(result, 'gallery');
        
        // Save to database
        await saveSentMessage(conversationId, caption || null, 'image', img.url, result?.messageId);
        
        // Delay between images (2s) to ensure proper ordering
        if (i < content.gallery_images.length - 1) {
          await sleep(2000);
        }
      }
    } else if (mediaType === 'image' && content.media_url) {
      const caption = content.caption ? replaceVariables(content.caption, variables) : '';
      console.log(`Flow executor: Sending image: ${content.media_url?.substring(0, 50)}`);
      const result = await whatsappProvider.sendMessage(connection, phone, caption, 'image', content.media_url);
      ensureSent(result, 'image');
      await saveSentMessage(conversationId, caption || null, 'image', content.media_url, result?.messageId);
    } else if (mediaType === 'video' && content.media_url) {
      const caption = content.caption ? replaceVariables(content.caption, variables) : '';
      console.log(`Flow executor: Sending video: ${content.media_url?.substring(0, 50)}`);
      const result = await whatsappProvider.sendMessage(connection, phone, caption, 'video', content.media_url);
      ensureSent(result, 'video');
      await saveSentMessage(conversationId, caption || null, 'video', content.media_url, result?.messageId);
    } else if (mediaType === 'audio' && content.media_url) {
      console.log(`Flow executor: Sending audio: ${content.media_url?.substring(0, 50)}`);
      const result = await whatsappProvider.sendMessage(connection, phone, '', 'audio', content.media_url);
      ensureSent(result, 'audio');
      await saveSentMessage(conversationId, null, 'audio', content.media_url, result?.messageId);
    } else if (content.message || content.text) {
      // Text message
      const text = replaceVariables(content.message || content.text, variables);
      console.log(`Flow executor: Sending text: ${text?.substring(0, 50)}`);
      const result = await whatsappProvider.sendMessage(connection, phone, text, 'text');
      ensureSent(result, 'text');
      await saveSentMessage(conversationId, text, 'text', null, result?.messageId);
    } else {
      console.log('Flow executor: processMessageNode - no content to send');
    }

    // Add small delay between consecutive message nodes to maintain order in WhatsApp
    await sleep(800);

    return { success: true };
  } catch (error) {
    console.error('Flow executor: Message node error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Process menu node - send menu message
 */
async function processMenuNode(content, connection, phone, variables, conversationId) {
  let menuText = content.prompt || content.message || 'Selecione uma opção:';
  menuText = replaceVariables(menuText, variables);

  // Check if provider is UAZAPI and use native interactive menu if possible
  if (connection.provider === 'uazapi' && Array.isArray(content.options) && content.options.length > 0) {
    const options = content.options.map(opt => opt.label || opt.text).filter(Boolean).slice(0, 3);
    
    if (options.length > 0) {
      console.log(`Flow executor: Sending UAZAPI native interactive menu to ${phone}`);
      const result = await whatsappProvider.sendMessage(
        connection, 
        phone, 
        JSON.stringify({
          text: menuText,
          buttons: options,
          footer: content.footer || ''
        }), 
        'interactive_menu'
      );
      
      if (result?.success) {
        await saveSentMessage(conversationId, menuText, 'text', null, result?.messageId);
        return;
      }
      console.warn('Flow executor: UAZAPI native menu failed, falling back to text menu');
    }
  }

  // Fallback: Build text menu
  if (Array.isArray(content.options) && content.options.length > 0) {
    menuText += '\n\n' + content.options.map((opt, idx) => `${idx + 1}. ${opt.label || opt.text}`).join('\n');
  }

  const result = await whatsappProvider.sendMessage(connection, phone, menuText, 'text');
  if (!result?.success) {
    throw new Error(result?.error || 'Falha ao enviar menu');
  }
  await saveSentMessage(conversationId, menuText, 'text', null, result?.messageId);
}

/**
 * Process input node - send prompt for user input
 * The frontend saves the prompt in content.text, so we check that field as well
 */
async function processInputNode(content, connection, phone, variables, conversationId) {
  // Check text field first (frontend saves here), then prompt/message as fallbacks
  let promptText = content.text || content.prompt || content.message || '';
  
  // Only send if there's actual prompt text - don't send default placeholder
  if (!promptText || !promptText.trim()) {
    console.log('Flow executor: Input node has no prompt text, skipping message send');
    return; // Don't send any message, just wait for input
  }
  
  promptText = replaceVariables(promptText, variables);

  const result = await whatsappProvider.sendMessage(connection, phone, promptText, 'text');
  if (!result?.success) {
    throw new Error(result?.error || 'Falha ao enviar prompt de input');
  }
  await saveSentMessage(conversationId, promptText, 'text', null, result?.messageId);
}

/**
 * Process condition node - evaluate and return next handle
 */
function processConditionNode(content, variables) {
  // Evaluate conditions and determine path
  const rules = content.rules || [];
  const operator = content.operator || 'AND';

  let result = operator === 'AND';

  for (const rule of rules) {
    // Support both raw variable names ("resposta_cliente") and template
    // syntax ("{resposta_cliente}" or "{{resposta_cliente}}") in rule.variable.
    let varName = String(rule.variable || '').trim();
    const templateMatch = varName.match(/^\{\{?\s*([\w.]+)\s*\}?\}$/);
    if (templateMatch) varName = templateMatch[1];
    const varValue = getVariableValue(variables, varName);
    // Compare value may also reference variables
    const compareValue = replaceVariables(String(rule.value ?? ''), variables);
    const ruleResult = evaluateRule(varValue ?? '', rule.operator, compareValue);
    console.log(`[Condition] var="${varName}" value="${varValue}" op=${rule.operator} compare="${compareValue}" => ${ruleResult}`);

    if (operator === 'AND') {
      result = result && ruleResult;
    } else {
      result = result || ruleResult;
    }
  }

  return { 
    success: true, 
    nextHandle: result ? 'true' : 'false' 
  };
}

/**
 * Evaluate a single condition rule
 */
function evaluateRule(value, operator, compareValue) {
  const strValue = String(value || '').toLowerCase();
  const strCompare = String(compareValue || '').toLowerCase();

  switch (operator) {
    case 'equals':
    case 'equal':
      return strValue === strCompare;
    case 'not_equals':
    case 'not_equal':
      return strValue !== strCompare;
    case 'contains':
      return strValue.includes(strCompare);
    case 'not_contains':
      return !strValue.includes(strCompare);
    case 'starts_with':
      return strValue.startsWith(strCompare);
    case 'ends_with':
      return strValue.endsWith(strCompare);
    case 'is_empty':
      return strValue === '';
    case 'is_not_empty':
      return strValue !== '';
    case 'greater_than':
      return parseFloat(value) > parseFloat(compareValue);
    case 'less_than':
      return parseFloat(value) < parseFloat(compareValue);
    default:
      return false;
  }
}

/**
 * Process action node
 */
async function processActionNode(content, connection, phone, variables, conversationId) {
  const actionType = content.action_type;

  try {
    switch (actionType) {
      case 'add_tag': {
        const tagId = content.tag_id;
        if (!tagId || !conversationId) {
          console.log('Flow action: add_tag missing tag_id or conversationId');
          addExecutionLog(conversationId, {
            type: 'action_skipped',
            nodeType: 'action',
            message: `add_tag ignorado: ${!tagId ? 'tag_id ausente' : 'conversationId ausente'}`,
          });
          break;
        }
        try {
          await query(
            `INSERT INTO conversation_tag_links (conversation_id, tag_id)
             VALUES ($1, $2)
             ON CONFLICT (conversation_id, tag_id) DO NOTHING`,
            [conversationId, tagId]
          );
          console.log(`Flow action: Added tag ${tagId} to conversation ${conversationId}`);
          addExecutionLog(conversationId, {
            type: 'action_done',
            nodeType: 'action',
            message: `Tag adicionada (${tagId})`,
          });
        } catch (e) {
          console.error('Flow action add_tag error:', e.message);
          addExecutionLog(conversationId, {
            type: 'error',
            nodeType: 'action',
            message: `Erro add_tag: ${e.message}`,
          });
        }
        break;
      }
      case 'remove_tag': {
        const tagId = content.tag_id;
        if (!tagId || !conversationId) {
          console.log('Flow action: remove_tag missing tag_id or conversationId');
          break;
        }
        try {
          await query(
            `DELETE FROM conversation_tag_links WHERE conversation_id = $1 AND tag_id = $2`,
            [conversationId, tagId]
          );
          console.log(`Flow action: Removed tag ${tagId} from conversation ${conversationId}`);
        } catch (e) {
          console.error('Flow action remove_tag error:', e.message);
          addExecutionLog(conversationId, {
            type: 'error',
            nodeType: 'action',
            message: `Erro remove_tag: ${e.message}`,
          });
        }
        break;
      }
      case 'set_variable': {
        const varName = content.variable_name || content.variable;
        if (varName) {
          const val = replaceVariables(String(content.value ?? ''), variables);
          variables[varName] = val;
          console.log(`Flow action: set_variable ${varName} = ${val}`);
          addExecutionLog(conversationId, {
            type: 'action_done',
            nodeType: 'action',
            message: `Variável definida: ${varName} = ${val}`,
          });
        }
        break;
      }
      case 'close_conversation': {
        if (!conversationId) break;
        try {
          await query(
            `UPDATE conversations SET attendance_status = 'finished', updated_at = NOW() WHERE id = $1`,
            [conversationId]
          );
          console.log(`Flow action: Closed conversation ${conversationId}`);
        } catch (e) {
          console.error('Flow action close_conversation error:', e.message);
        }
        break;
      }
      case 'send_email':
        // Send email via SMTP queue
        if (content.email_to && content.email_subject) {
          const toEmail = replaceVariables(content.email_to, variables);
          const subject = replaceVariables(content.email_subject, variables);
          const body = replaceVariables(content.email_body || '', variables);
          
          console.log(`Flow action: Send email to ${toEmail}`);
          
          // Get organization from connection
          const orgResult = await query(
            'SELECT organization_id FROM connections WHERE id = $1',
            [connection.id]
          );
          
          if (orgResult.rows.length > 0) {
            const orgId = orgResult.rows[0].organization_id;
            
            // Add to email queue
            await query(
              `INSERT INTO email_queue 
                (organization_id, to_email, subject, body_html, body_text, context_type, status, priority)
               VALUES ($1, $2, $3, $4, $4, 'flow', 'pending', 5)`,
              [orgId, toEmail, subject, body]
            );
            console.log('Flow action: Email queued successfully');
          }
        }
        break;
      case 'notify_external':
      case 'external_notification':
        // Send message to external number
        if (content.external_phone || content.phone_number) {
          const extPhone = content.external_phone || content.phone_number;
          const extMsg = content.external_message || content.notification_message || '';
          const msg = replaceVariables(extMsg, variables);
          const targetPhone = replaceVariables(extPhone, variables);
          const sendResult = await whatsappProvider.sendMessage(connection, targetPhone, msg, 'text');
          if (!sendResult?.success) {
            throw new Error(sendResult?.error || 'Falha ao enviar notificação externa');
          }
        }
        break;

      case 'move_kanban': {
        // Move an existing CRM deal to a specific funnel/stage
        const funnelId = content.funnel_id;
        const stageId = content.stage_id;
        if (!funnelId || !stageId) {
          console.log('Flow action: move_kanban missing funnel_id or stage_id');
          break;
        }

        const orgResult2 = await query(
          'SELECT organization_id FROM connections WHERE id = $1',
          [connection.id]
        );
        if (orgResult2.rows.length === 0) break;
        const orgId2 = orgResult2.rows[0].organization_id;

        const cleanPhone = phone.replace(/\D/g, '').slice(-11);

        // Find existing open deal for this contact (in any funnel)
        const existingDeal = await query(
          `SELECT d.id, d.stage_id, d.funnel_id FROM crm_deals d
           JOIN crm_deal_contacts dc ON dc.deal_id = d.id
           JOIN contacts cnt ON cnt.id = dc.contact_id
           WHERE d.organization_id = $1 AND d.status = 'open'
             AND regexp_replace(COALESCE(cnt.phone, ''), '\\D', '', 'g') LIKE '%' || $2 || '%'
           ORDER BY d.last_activity_at DESC NULLS LAST, d.created_at DESC LIMIT 1`,
          [orgId2, cleanPhone]
        );

        if (existingDeal.rows.length > 0) {
          const deal = existingDeal.rows[0];
          const changes = {};
          if (deal.funnel_id !== funnelId) changes.funnel_id = funnelId;
          if (deal.stage_id !== stageId) changes.stage_id = stageId;

          if (Object.keys(changes).length > 0) {
            await query(
              `UPDATE crm_deals SET funnel_id = $1, stage_id = $2, last_activity_at = NOW(), updated_at = NOW() WHERE id = $3`,
              [funnelId, stageId, deal.id]
            );
            await query(
              `INSERT INTO crm_deal_history (deal_id, action, from_value, to_value, notes)
               VALUES ($1, 'stage_changed', $2, $3, 'Movido automaticamente via fluxo')`,
              [deal.id, deal.stage_id, stageId]
            );
            console.log(`Flow action: Moved CRM deal ${deal.id} from stage ${deal.stage_id} to stage ${stageId} (funnel ${funnelId})`);
          } else {
            console.log(`Flow action: Deal ${deal.id} already in target funnel/stage`);
          }
        } else {
          console.log(`Flow action: No open deal found for phone ${cleanPhone}, skipping move`);
        }
        break;
      }
    }
    return { success: true };
  } catch (error) {
    console.error('Flow executor: Action node error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Process external_send node - send a WhatsApp message to a fixed external number
 * using the same conversation's connection. Useful for notifying internal teams
 * with the captured user reply, contact info and current date/time.
 */
async function processExternalSendNode(content, connection, variables, conversationId) {
  try {
    const rawPhone = String(content.phone || content.external_phone || '').trim();
    if (!rawPhone) {
      console.log('Flow executor: external_send missing phone');
      return { success: false, error: 'Número externo não configurado' };
    }

    // Inject runtime date/time variables (America/Sao_Paulo)
    const tz = 'America/Sao_Paulo';
    const now = new Date();
    const localVars = {
      ...variables,
      data: now.toLocaleDateString('pt-BR', { timeZone: tz }),
      hora: now.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }),
      data_hora: now.toLocaleString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }),
    };

    const targetPhone = replaceVariables(rawPhone, localVars).replace(/\D/g, '');
    if (!targetPhone) {
      return { success: false, error: 'Número externo inválido após resolver variáveis' };
    }

    const defaultTemplate = [
      '🔔 Nova resposta recebida',
      '',
      'Contato: {nome}',
      'Telefone: {telefone}',
      'Resposta: {resposta_cliente}',
      'Data/Hora: {data_hora}',
    ].join('\n');
    const messageTpl = content.message || content.text || defaultTemplate;
    const message = replaceVariables(messageTpl, localVars);

    console.log(`Flow executor: external_send -> ${targetPhone} (${message.length} chars)`);
    const result = await whatsappProvider.sendMessage(connection, targetPhone, message, 'text');
    if (!result?.success) {
      const errMsg = result?.error || 'Falha ao enviar mensagem externa';
      if (content.continue_on_error) {
        console.warn('Flow executor: external_send failed but continuing:', errMsg);
        return { success: true };
      }
      throw new Error(errMsg);
    }
    return { success: true };
  } catch (error) {
    console.error('Flow executor: external_send error:', error);
    if (content?.continue_on_error) return { success: true };
    return { success: false, error: error.message };
  }
}

/**
 * Replace variables in text - supports {var}, {{var}}, and {obj.key} dot notation
 */
function replaceVariables(text, variables) {
  if (!text) return text;
  
  // Replace {{var.path}} and {var.path} patterns with dot notation support
  return text
    .replace(/\{\{([\w.]+)\}\}/g, (match, varPath) => {
      const val = getVariableValue(variables, varPath);
      return val !== undefined ? String(val) : match;
    })
    .replace(/\{([\w.]+)\}/g, (match, varPath) => {
      const val = getVariableValue(variables, varPath);
      return val !== undefined ? String(val) : match;
    });
}

/**
 * Get variable value supporting dot notation (e.g. "custom_fields.campo1" or just "campo1")
 */
function getVariableValue(variables, path) {
  // Direct match first
  if (path in variables && variables[path] !== undefined) {
    return variables[path];
  }
  // Dot notation
  const parts = path.split('.');
  let current = variables;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Update flow session state
 */
async function updateFlowSession(flowId, conversationId, currentNodeId, variables) {
  try {
    await query(
      `UPDATE flow_sessions 
       SET current_node_id = $1, variables = $2, updated_at = NOW()
       WHERE conversation_id = $3 AND flow_id = $4 AND is_active = true`,
      [currentNodeId, JSON.stringify(variables), conversationId, flowId]
    );
  } catch (error) {
    console.log('Flow session update skipped:', error.message);
  }
}

/**
 * Mark flow session as complete
 */
async function completeFlowSession(conversationId) {
  try {
    await query(
      `UPDATE flow_sessions 
       SET is_active = false, ended_at = NOW()
       WHERE conversation_id = $1 AND is_active = true`,
      [conversationId]
    );
  } catch (error) {
    console.log('Flow session complete skipped:', error.message);
  }
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Continue a paused flow with user input
 */
export async function continueFlowWithInput(conversationId, userInput) {
  try {
    console.log(`Flow executor: Continuing flow for conversation ${conversationId} with input:`, userInput?.substring(0, 50));
    
    // Get active flow session
    const sessionResult = await query(
      `SELECT fs.*, f.id as flow_id
       FROM flow_sessions fs
       JOIN flows f ON f.id = fs.flow_id
       WHERE fs.conversation_id = $1 AND fs.is_active = true
       LIMIT 1`,
      [conversationId]
    );

    if (sessionResult.rows.length === 0) {
      console.log('Flow executor: No active session found');
      return { success: false, error: 'Nenhuma sessão ativa' };
    }

    const session = sessionResult.rows[0];
    const flowId = session.flow_id;
    const currentNodeId = session.current_node_id;
    const variables = typeof session.variables === 'string' 
      ? JSON.parse(session.variables || '{}') 
      : (session.variables || {});

    console.log(`Flow executor: Resuming from node ${currentNodeId}`, variables);
    addExecutionLog(conversationId, {
      type: 'continue_input',
      flowId,
      nodeId: currentNodeId,
      message: `Recebida resposta do contato, retomando fluxo a partir de ${currentNodeId}`,
      userInput: String(userInput || '').substring(0, 80),
    });

    // Get the current node to understand what we're waiting for
    const nodeResult = await query(
      'SELECT * FROM flow_nodes WHERE flow_id = $1 AND node_id = $2',
      [flowId, currentNodeId]
    );

    if (nodeResult.rows.length === 0) {
      console.error('Flow executor: Current node not found:', currentNodeId);
      return { success: false, error: 'Nó atual não encontrado' };
    }

    const currentNode = nodeResult.rows[0];
    const content = typeof currentNode.content === 'string' 
      ? JSON.parse(currentNode.content) 
      : (currentNode.content || {});

    console.log(`Flow executor: Current node type: ${currentNode.node_type}`);

    // Process user input based on node type
    let nextHandle = null;
    
    if (currentNode.node_type === 'input') {
      // Store the input in the variable (frontend saves as 'variable', not 'variable_name')
      const varName = content.variable || content.variable_name || 'resposta';
      variables[varName] = userInput;
      console.log(`Flow executor: Stored input in variable '${varName}':`, userInput?.substring(0, 50));
    } else if (currentNode.node_type === 'wait_reply') {
      // Wait reply node - user responded, follow "replied" handle
      const responseVar = session.wait_reply_variable || content.response_variable;
      if (responseVar) {
        variables[responseVar] = userInput;
        console.log(`Flow executor: Stored reply in variable '${responseVar}':`, userInput?.substring(0, 50));
      }
      nextHandle = 'replied';
      
      // Clear wait_reply metadata
      await query(
        `UPDATE flow_sessions SET wait_reply_expires_at = NULL, wait_reply_variable = NULL, updated_at = NOW()
         WHERE conversation_id = $1 AND is_active = true`,
        [conversationId]
      );
      console.log('Flow executor: Wait reply - user responded, following "replied" handle');
    } else if (currentNode.node_type === 'menu') {
      // Match user input to menu options
      const options = content.options || [];
      const inputLower = String(userInput || '').trim().toLowerCase();
      
      // Try to match by number (1, 2, 3...) or by label text
      let matchedOption = null;
      
      // Try numeric match first
      const inputNum = parseInt(inputLower);
      if (!isNaN(inputNum) && inputNum >= 1 && inputNum <= options.length) {
        matchedOption = options[inputNum - 1];
      }
      
      // Try text match if no numeric match
      if (!matchedOption) {
        matchedOption = options.find(opt => {
          const label = String(opt.label || opt.text || '').toLowerCase().trim();
          return label === inputLower || inputLower.includes(label);
        });
      }
      
      if (matchedOption) {
        const optionIndex = options.indexOf(matchedOption);
       nextHandle = `opt_${optionIndex}`;
        
        // Store selected option in variable if configured
        const varName = content.variable_name || 'opcao';
        variables[varName] = matchedOption.label || matchedOption.text;
        
        console.log(`Flow executor: Menu option matched: ${matchedOption.label || matchedOption.text} (handle: ${nextHandle})`);
      } else {
        // No match - use default handle
        nextHandle = 'default';
        console.log('Flow executor: No menu option matched, using default handle');
      }
    }

    console.log(`Flow executor: Continuing flow for conversation ${conversationId}. Node: ${currentNodeId} (${currentNode.node_type}), nextHandle: ${nextHandle}`);

    // Get all edges AND nodes to find the next node with proper ordering
    const [edgesResult, nodesResult] = await Promise.all([
      query('SELECT * FROM flow_edges WHERE flow_id = $1 AND source_node_id = $2', [flowId, currentNodeId]),
      query('SELECT node_id, position_x, position_y FROM flow_nodes WHERE flow_id = $1', [flowId]),
    ]);

    const edges = edgesResult.rows;
    const nodePositions = new Map();
    nodesResult.rows.forEach(n => nodePositions.set(n.node_id, { x: n.position_x || 0, y: n.position_y || 0 }));
    
    if (edges.length === 0) {
      console.log('Flow executor: No outgoing edges from current node, flow complete');
      addExecutionLog(conversationId, {
        type: 'flow_complete',
        flowId,
        nodeId: currentNodeId,
        message: 'Fluxo finalizado - sem mais conexões',
      });
      await completeFlowSession(conversationId);
      return { success: true, flowComplete: true };
    }

    // Sort edges by target node Y position (top to bottom = execution order)
    edges.sort((a, b) => {
      const posA = nodePositions.get(a.target_node_id) || { x: 0, y: 0 };
      const posB = nodePositions.get(b.target_node_id) || { x: 0, y: 0 };
      if (posA.y !== posB.y) return posA.y - posB.y;
      return posA.x - posB.x;
    });

    // Find the next edge based on handle (for menu) or just take the first one (for input)
    let nextEdge = null;
    if (nextHandle) {
      nextEdge = edges.find(e => e.source_handle === nextHandle);
      if (!nextEdge && nextHandle === 'replied') {
        // Fallback for case sensitivity or slight variations
        nextEdge = edges.find(e => e.source_handle?.toLowerCase() === 'replied');
      }
      // Fallback: if there's no 'timeout' edge and only one edge, follow it for 'replied'
      if (!nextEdge && nextHandle === 'replied') {
        const nonTimeout = edges.filter(e => e.source_handle !== 'timeout');
        if (nonTimeout.length >= 1) nextEdge = nonTimeout[0];
      }
      if (!nextEdge) {
        nextEdge = edges.find(e => e.source_handle === 'default') || edges[0];
      }
    } else {
      nextEdge = edges[0];
    }

    const nextNodeId = nextEdge?.target_node_id;

    if (!nextNodeId) {
      console.log('Flow executor: No next node found, flow complete');
      addExecutionLog(conversationId, {
        type: 'flow_complete',
        flowId,
        nodeId: currentNodeId,
        message: 'Fluxo finalizado - próximo nó não encontrado',
      });
      await completeFlowSession(conversationId);
      return { success: true, flowComplete: true };
    }

    console.log(`Flow executor: Moving to next node: ${nextNodeId}`);
    
    addExecutionLog(conversationId, {
      type: 'transition',
      flowId,
      fromNodeId: currentNodeId,
      toNodeId: nextNodeId,
      message: `Após input: ${currentNodeId} → ${nextNodeId}`,
      userInput: userInput?.substring(0, 50),
      variables: { ...variables },
    });

    // Update session with new variables
    await query(
      `UPDATE flow_sessions 
       SET variables = $1, current_node_id = $2, updated_at = NOW()
       WHERE conversation_id = $3 AND is_active = true`,
      [JSON.stringify(variables), nextNodeId, conversationId]
    );

    // Continue execution from the next node
    return await resumeFlowFromNode(flowId, conversationId, nextNodeId, variables);
  } catch (error) {
    console.error('Flow executor: Continue with input error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Resume flow execution from a specific node with given variables
 */
async function resumeFlowFromNode(flowId, conversationId, startNodeId, variables) {
  try {
    console.log(`Flow executor: Resuming from node ${startNodeId}`);
    
    // Get conversation and connection info
    const convResult = await query(
      `SELECT c.*, 
              conn.api_url, conn.api_key, conn.instance_name, conn.instance_id,
              conn.wapi_token, conn.provider,
              conn.uazapi_url, conn.uazapi_token,
              conn.meta_token, conn.meta_phone_number_id, conn.meta_waba_id
       FROM conversations c
       JOIN connections conn ON conn.id = c.connection_id
       WHERE c.id = $1`,
      [conversationId]
    );

    if (convResult.rows.length === 0) {
      return { success: false, error: 'Conversa não encontrada' };
    }

    const conversation = convResult.rows[0];
    const connection = {
      id: conversation.connection_id,
      api_url: conversation.api_url,
      api_key: conversation.api_key,
      instance_name: conversation.instance_name,
      instance_id: conversation.instance_id,
      wapi_token: conversation.wapi_token,
      provider: conversation.provider,
      uazapi_url: conversation.uazapi_url,
      uazapi_token: conversation.uazapi_token,
      meta_token: conversation.meta_token,
      meta_phone_number_id: conversation.meta_phone_number_id,
      meta_waba_id: conversation.meta_waba_id,
    };

    // Get all nodes and edges
    const [nodesResult, edgesResult] = await Promise.all([
      query('SELECT * FROM flow_nodes WHERE flow_id = $1', [flowId]),
      query('SELECT * FROM flow_edges WHERE flow_id = $1', [flowId]),
    ]);

    const nodes = nodesResult.rows;
    const edges = edgesResult.rows;

    // Create maps
    const nodeMap = new Map();
    nodes.forEach(node => nodeMap.set(node.node_id, node));

    const edgeMap = new Map();
    edges.forEach(edge => {
      const key = edge.source_node_id;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, []);
      }
      edgeMap.get(key).push(edge);
    });
    
    // Sort edges by target node's Y position (top to bottom = execution order)
    edgeMap.forEach((edgeList, key) => {
      edgeList.sort((a, b) => {
        const nodeA = nodeMap.get(a.target_node_id);
        const nodeB = nodeMap.get(b.target_node_id);
        const yA = nodeA?.position_y ?? 0;
        const yB = nodeB?.position_y ?? 0;
        if (yA !== yB) return yA - yB;
        const xA = nodeA?.position_x ?? 0;
        const xB = nodeB?.position_x ?? 0;
        return xA - xB;
      });
    });

    // Start processing from the given node
    let currentNodeId = startNodeId;
    let processedNodes = 0;
    const maxNodes = 50;

    while (currentNodeId && processedNodes < maxNodes) {
      const node = nodeMap.get(currentNodeId);
      
      if (!node) {
        console.log('Flow executor: Node not found:', currentNodeId);
        addExecutionLog(conversationId, {
          type: 'error',
          flowId,
          nodeId: currentNodeId,
          nodeType: 'unknown',
          message: `Nó não encontrado: ${currentNodeId}`,
          step: processedNodes + 1,
          resumed: true,
        });
        return { success: false, error: `Nó não encontrado: ${currentNodeId}` };
      }

      processedNodes++;
      console.log(`Flow executor: Processing node ${node.node_id} (${node.node_type})`);

      // Log node processing
      addExecutionLog(conversationId, {
        type: 'node_start',
        flowId,
        nodeId: node.node_id,
        nodeType: node.node_type,
        nodeName: node.name || node.node_id,
        step: processedNodes,
        message: `Executando nó: ${node.name || node.node_id} (${node.node_type})`,
        resumed: true,
      });

      // Process the node
      const result = await processNode(node, connection, conversation.contact_phone, variables, conversationId);

      if (!result.success) {
        console.error('Flow executor: Node processing failed:', result.error || 'Erro desconhecido');
        addExecutionLog(conversationId, {
          type: 'error',
          flowId,
          nodeId: node.node_id,
          nodeType: node.node_type,
          step: processedNodes,
          message: `Erro no nó: ${result.error || 'Erro desconhecido'}`,
          resumed: true,
        });
        return { success: false, error: result.error || `Falha ao executar nó ${node.node_id}` };
      }

      // If node requires user input, stop here
      if (result.waitForInput) {
        addExecutionLog(conversationId, {
          type: 'waiting_input',
          flowId,
          nodeId: node.node_id,
          nodeType: node.node_type,
          step: processedNodes,
          message: `Aguardando entrada do usuário`,
          variables: { ...variables },
          resumed: true,
        });
        await updateFlowSession(flowId, conversationId, currentNodeId, variables);
        return { success: true, waitingForInput: true, currentNode: currentNodeId };
      }

      // Get next node
      const outgoingEdges = edgeMap.get(currentNodeId) || [];
      
      if (outgoingEdges.length === 0) {
        console.log('Flow executor: No more edges, flow complete');
        addExecutionLog(conversationId, {
          type: 'flow_complete',
          flowId,
          nodeId: node.node_id,
          step: processedNodes,
          message: `Fluxo retomado e finalizado após ${processedNodes} nós`,
          resumed: true,
        });
        break;
      }

      const nextEdge = result.nextHandle 
        ? outgoingEdges.find(e => e.source_handle === result.nextHandle) || outgoingEdges[0]
        : outgoingEdges[0];

      const previousNodeId = currentNodeId;
      currentNodeId = nextEdge?.target_node_id;
      
      addExecutionLog(conversationId, {
        type: 'transition',
        flowId,
        fromNodeId: previousNodeId,
        toNodeId: currentNodeId,
        step: processedNodes,
        message: `Transição: ${previousNodeId} → ${currentNodeId}`,
        handle: result.nextHandle || 'default',
        resumed: true,
      });
      
      console.log(`Flow executor: Moving to next node: ${currentNodeId}`);
    }

    if (processedNodes >= maxNodes && currentNodeId) {
      addExecutionLog(conversationId, {
        type: 'error',
        flowId,
        nodeId: currentNodeId,
        step: processedNodes,
        message: `Execução retomada interrompida: limite de ${maxNodes} nós atingido`,
        resumed: true,
      });
      return { success: false, error: `Execução interrompida: limite de ${maxNodes} nós atingido` };
    }

    if (processedNodes === 0) {
      return { success: false, error: 'Fluxo retomado sem nós executáveis' };
    }

    // Mark session as complete
    await completeFlowSession(conversationId);

    console.log(`Flow executor: Flow resumed and completed. Processed ${processedNodes} nodes`);
    return { success: true, nodesProcessed: processedNodes };
  } catch (error) {
    console.error('Flow executor: Resume flow error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Continue flow after wait_reply timeout (called by scheduler)
 */
export async function continueFlowAfterTimeout(conversationId, flowId, startNodeId, variables) {
  return await resumeFlowFromNode(flowId, conversationId, startNodeId, variables);
}
