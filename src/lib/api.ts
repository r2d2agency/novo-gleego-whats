const ENV_API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const isBrowser = typeof window !== 'undefined';
const isLocalhost = isBrowser && ['localhost', '127.0.0.1'].includes(window.location.hostname);

const getBaseCandidates = (endpoint: string) => {
  const sameOriginBase = '';
  const supportsSameOrigin = endpoint.startsWith('/api/') || endpoint.startsWith('/uploads/');
  const shouldPreferSameOrigin = isBrowser && !isLocalhost && supportsSameOrigin;

  const ordered = shouldPreferSameOrigin
    ? [sameOriginBase, ENV_API_URL]
    : [ENV_API_URL, sameOriginBase];

  return [...new Set(ordered.filter((base) => base !== undefined && base !== null))];
};

const buildUrl = (base: string, endpoint: string) =>
  base ? `${base}${endpoint}` : endpoint;

export const API_URL = ENV_API_URL;

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_GET_RETRIES = 2;
const ERROR_LOG_COOLDOWN_MS = 15000;
const REQUEST_TIMEOUT_MS = 15000;
const lastErrorLogByKey = new Map<string, number>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetry = (method: string, status?: number) => {
  if (method !== 'GET') return false;
  if (!status) return true;
  return RETRYABLE_STATUS.has(status);
};

const shouldLogNow = (key: string) => {
  const now = Date.now();
  const last = lastErrorLogByKey.get(key) || 0;
  if (now - last < ERROR_LOG_COOLDOWN_MS) return false;
  lastErrorLogByKey.set(key, now);
  return true;
};

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
}

class HttpError extends Error {
  status?: number;
  response?: unknown;

  constructor(message: string, status?: number, response?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.response = response;
  }
}

export const api = async <T>(endpoint: string, options: ApiOptions = {}): Promise<T> => {
  const { method = 'GET', body, auth = true, timeoutMs } = options;
  const effectiveTimeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : REQUEST_TIMEOUT_MS;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth) {
    const token = localStorage.getItem('auth_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const baseCandidates = getBaseCandidates(endpoint);
  const retries = method === 'GET' ? MAX_GET_RETRIES : 0;
  let lastError: Error | null = null;

  for (let baseIndex = 0; baseIndex < baseCandidates.length; baseIndex++) {
    const base = baseCandidates[baseIndex];
    const url = buildUrl(base, endpoint);

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), effectiveTimeout);
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        let data: any = null;

        // Read body as text first for safer parsing
        const rawText = await response.text().catch(() => '');

        if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
          try {
            data = JSON.parse(rawText);
          } catch {
            data = { raw: rawText };
          }
        } else {
          if ((rawText.trim().startsWith('<!') || rawText.includes('<html')) && shouldLogNow(`html:${url}:${response.status}`)) {
            // eslint-disable-next-line no-console
            console.error('[api] Got HTML instead of JSON', {
              url,
              status: response.status,
              preview: rawText.substring(0, 300),
            });
          }
          data = { raw: rawText };
        }

        if (!response.ok) {
          if (attempt < retries && shouldRetry(method, response.status)) {
            await sleep(250 * Math.pow(2, attempt));
            continue;
          }

          const baseMsg = data?.error || data?.message || `Erro na requisição (${response.status})`;
          const details = data?.details ? `: ${data.details}` : '';
          const logKey = `fail:${url}:${response.status}`;
          if (shouldLogNow(logKey)) {
            // eslint-disable-next-line no-console
            console.error('[api] request failed', {
              url,
              status: response.status,
              contentType,
              body,
              response: data,
            });
          }

          // Fallback para same-origin somente em GET, evitando duplicidade em mutações
          const shouldTryNextBase = method === 'GET' && baseIndex < baseCandidates.length - 1 && response.status >= 500;
          if (shouldTryNextBase) {
            lastError = new HttpError(`${baseMsg}${details}`, response.status, data);
            break;
          }

          throw new HttpError(`${baseMsg}${details}`, response.status, data);
        }

        return data as T;
      } catch (error: any) {
        window.clearTimeout(timeoutId);
        if (error instanceof HttpError) {
          throw error;
        }

        const normalizedError = error?.name === 'AbortError'
          ? new Error('Tempo limite excedido ao conectar com a API')
          : error;

        const canRetry = attempt < retries && shouldRetry(method);
        if (canRetry) {
          await sleep(250 * Math.pow(2, attempt));
          continue;
        }

        if (shouldLogNow(`network:${url}`)) {
          // eslint-disable-next-line no-console
          console.error('[api] network failure', {
            url,
            method,
            message: normalizedError?.message || 'Erro de rede',
          });
        }

        const shouldTryNextBase = method === 'GET' && baseIndex < baseCandidates.length - 1;
        if (shouldTryNextBase) {
          lastError = normalizedError instanceof Error ? normalizedError : new Error('Erro de rede');
          break;
        }

        throw normalizedError;
      }
    }
  }

  if (lastError) throw lastError;
  throw new Error('Falha inesperada na requisição');
};

// Auth helpers
export const authApi = {
  login: (email: string, password: string) =>
    api<{ user: { id: string; email: string; name: string }; token: string }>(
      '/api/auth/login',
      { method: 'POST', body: { email, password }, auth: false }
    ),

  register: (email: string, password: string, name: string, plan_id?: string) =>
    api<{ user: { id: string; email: string; name: string }; token: string }>(
      '/api/auth/register',
      { method: 'POST', body: { email, password, name, plan_id }, auth: false }
    ),

  getMe: () =>
    api<{ user: { id: string; email: string; name: string } }>('/api/auth/me'),

  getSignupPlans: () =>
    api<Array<{
      id: string;
      name: string;
      description: string | null;
      max_connections: number;
      max_monthly_messages: number;
      max_users: number;
      price: number;
      billing_period: string;
      trial_days: number;
      has_chat: boolean;
      has_campaigns: boolean;
      has_asaas_integration: boolean;
    }>>('/api/auth/plans', { auth: false }),
};

export const setAuthToken = (token: string) => {
  localStorage.setItem('auth_token', token);
};

export const clearAuthToken = () => {
  localStorage.removeItem('auth_token');
};

export const getAuthToken = () => {
  return localStorage.getItem('auth_token');
};
