/**
 * Retry helper with exponential backoff for HTTP requests
 * 
 * Retries on 5xx errors (502, 500, 503, 504) with exponential backoff.
 * Does NOT retry on 4xx errors (client errors).
 */

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 10000;

/**
 * Fetch with automatic retry on server errors
 * 
 * @param {string} url - The URL to fetch
 * @param {RequestInit} options - Fetch options (headers, method, body, etc.)
 * @param {Object} retryOptions - Retry configuration
 * @param {number} retryOptions.retries - Max number of retries (default: 3)
 * @param {number} retryOptions.baseDelay - Initial delay in ms (default: 1000)
 * @param {number} retryOptions.maxDelay - Maximum delay in ms (default: 10000)
 * @param {string} retryOptions.label - Label for logging (optional)
 * @returns {Promise<Response>} - The fetch response
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const {
    retries = DEFAULT_RETRIES,
    baseDelay = DEFAULT_BASE_DELAY_MS,
    maxDelay = DEFAULT_MAX_DELAY_MS,
    label = 'fetch',
  } = retryOptions;

  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fetchOptions = { ...options };
      // Add timeout via AbortController if not already set
      const timeoutMs = retryOptions.timeout || 60000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (!fetchOptions.signal) fetchOptions.signal = controller.signal;

      let response;
      try {
        response = await fetch(url, fetchOptions);
      } finally {
        clearTimeout(timer);
      }
      
      // Only retry on 5xx server errors
      if (response.status >= 500 && response.status < 600 && attempt < retries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        console.warn(
          `[${label}] Server error ${response.status} on attempt ${attempt + 1}/${retries + 1}. ` +
          `Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error;
      
      // Network errors (ECONNREFUSED, ETIMEDOUT, etc.) - retry
      const isNetworkError = 
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNRESET' ||
        error.message?.includes('fetch failed') ||
        error.message?.includes('network');
      
      if (isNetworkError && attempt < retries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        console.warn(
          `[${label}] Network error on attempt ${attempt + 1}/${retries + 1}: ${error.message}. ` +
          `Retrying in ${delay}ms...`
        );
        await sleep(delay);
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * Fetch JSON with automatic retry on server errors
 * 
 * @param {string} url - The URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {Object} retryOptions - Retry configuration
 * @returns {Promise<{ok: boolean, status: number, data: any}>} - Parsed response
 */
export async function fetchJsonWithRetry(url, options = {}, retryOptions = {}) {
  const response = await fetchWithRetry(url, options, retryOptions);
  
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  
  let data;
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch (e) {
      data = await response.text().catch(() => null);
    }
  } else {
    data = await response.text().catch(() => null);
  }
  
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default { fetchWithRetry, fetchJsonWithRetry };
