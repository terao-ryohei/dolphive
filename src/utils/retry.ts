export type RetryOptions = {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly backoffMultiplier?: number;
};

const DEFAULT_MAX_RETRIES = 3;
const RATE_LIMIT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

const hasStatus = (error: unknown): error is Error & { status: number } =>
  error instanceof Error && 'status' in error && typeof (error as { status: unknown }).status === 'number';

const isServerError = (error: unknown): boolean => {
  if (!hasStatus(error)) return false;
  return error.status >= 500 && error.status < 600;
};

const isRateLimitError = (error: unknown): boolean => {
  if (!hasStatus(error)) return false;
  return error.status === 429;
};

const isSecondaryRateLimit = (error: unknown): boolean => {
  if (!hasStatus(error)) return false;
  if (error.status !== 403) return false;
  return error.message.toLowerCase().includes('secondary rate limit');
};

const isNetworkOrTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const patterns = ['timeout', 'etimedout', 'econnreset', 'econnrefused', 'enotfound', 'network'];
  return patterns.some((p) => msg.includes(p));
};

export const isRetryableError = (error: unknown): boolean =>
  isServerError(error) || isRateLimitError(error) || isSecondaryRateLimit(error) || isNetworkOrTimeoutError(error);

const extractRetryAfterMs = (error: unknown): number | null => {
  if (!(error instanceof Error)) return null;

  // OpenAI SDK: APIError.headers is a Headers-like object
  if ('headers' in error) {
    const headers = (error as { headers: unknown }).headers;
    if (headers && typeof headers === 'object') {
      // Headers with .get() method (OpenAI SDK Headers)
      if ('get' in headers && typeof (headers as { get: unknown }).get === 'function') {
        const value = (headers as { get(name: string): string | null }).get('retry-after');
        if (value) {
          const seconds = parseFloat(value);
          if (!isNaN(seconds)) return seconds * 1000;
        }
      }
    }
  }

  // Octokit: RequestError.response?.headers['retry-after']
  if ('response' in error) {
    const response = (error as { response: unknown }).response;
    if (response && typeof response === 'object' && 'headers' in response) {
      const headers = (response as { headers: Record<string, unknown> }).headers;
      const value = headers['retry-after'];
      if (typeof value === 'number') {
        return value * 1000;
      }
      if (typeof value === 'string') {
        const seconds = parseFloat(value);
        if (!isNaN(seconds)) return seconds * 1000;
      }
    }
  }

  return null;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const withRetry = async <T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> => {
  const initialDelayMs = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const backoffMultiplier = options?.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;

  let lastError: unknown;

  // maxRetries is determined dynamically: use higher limit for rate limit errors
  const baseMaxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      const rateLimited = isRateLimitError(error) || isSecondaryRateLimit(error);
      const maxRetries = rateLimited ? RATE_LIMIT_MAX_RETRIES : baseMaxRetries;

      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const retryAfterMs = rateLimited ? extractRetryAfterMs(error) : null;
      const delay = retryAfterMs ?? initialDelayMs * backoffMultiplier ** attempt;
      await sleep(delay);
    }
  }

  throw lastError;
};
