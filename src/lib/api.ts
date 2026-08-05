const ENV_API_URL = 'https://gleego-whats-back.ckilhl.easypanel.host';
const isBrowser = typeof window !== 'undefined';
const isLocalhost = isBrowser && ['localhost', '127.0.0.1'].includes(window.location.hostname);

const getBaseCandidates = (endpoint: string) => {
  // NUNCA use sameOriginBase ('') para evitar vazamento entre domínios no Easypanel
  // Se estivermos no navegador, usamos estritamente a URL do backend configurada
  return [ENV_API_URL];
};

const buildUrl = (base: string, endpoint: string) =>
  base ? `${base}${endpoint}` : endpoint;

export const API_URL = ENV_API_URL;

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_GET_RETRIES = 2;
const ERROR_LOG_COOLDOWN_MS = 15000;
const REQUEST_TIMEOUT_MS = 120000;
const lastErrorLogByKey = new Map<string, number>();
const inFlightGetRequests = new Map<string, Promise<unknown>>();

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
  retryCount?: number;
  allowBaseFallback?: boolean;
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

const executeApiRequest = async <T>(endpoint: string, options: ApiOptions = {}): Promise<T> => {
  const {
    method = 'GET',
    body,
    auth = true,
    timeoutMs,
    retryCount,
    allowBaseFallback = true,
  } = options;
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
  const retries = method === 'GET' ? Math.max(0, retryCount ?? MAX_GET_RETRIES) : 0;
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
          // Silent in UI, but keep for telemetry if needed
          if (isLocalhost) console.error('[api] network failure', normalizedError);
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

export const api = <T>(endpoint: string, options: ApiOptions = {}): Promise<T> => {
  const method = options.method || 'GET';
  if (method !== 'GET') return executeApiRequest<T>(endpoint, options);

  const key = `${endpoint}|${options.auth !== false ? 'auth' : 'public'}`;
  const existing = inFlightGetRequests.get(key);
  if (existing) return existing as Promise<T>;

  const request = executeApiRequest<T>(endpoint, options).finally(() => {
    if (inFlightGetRequests.get(key) === request) {
      inFlightGetRequests.delete(key);
    }
  });
  inFlightGetRequests.set(key, request);
  return request;
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
    api<{ user: { id: string; email: string; name: string } }>('/api/auth/me', {
      timeoutMs: 7000,
      retryCount: 0,
      allowBaseFallback: false,
    }),

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
