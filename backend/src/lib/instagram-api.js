const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function graphRequest(path, accessToken, options = {}) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (options.query) Object.entries(options.query).forEach(([key, value]) => value != null && url.searchParams.set(key, value));
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url, { method: options.method || 'GET', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Instagram Graph error ${response.status}`);
  return payload;
}

export function listMedia(instagramUserId, accessToken, options = {}) {
  return graphRequest(`/${encodeURIComponent(instagramUserId)}/media`, accessToken, { query: { fields: options.fields || 'id,caption,media_type,media_url,permalink,timestamp', limit: options.limit, after: options.after } });
}

export function replyToComment(commentId, message, accessToken) {
  return graphRequest(`/${encodeURIComponent(commentId)}/replies`, accessToken, { method: 'POST', body: { message } });
}

export function sendDirectMessage(recipientId, message, accessToken) {
  return graphRequest(`/${encodeURIComponent(recipientId)}/messages`, accessToken, { method: 'POST', body: { recipient: { id: recipientId }, message: { text: message } } });
}

export { graphRequest };
