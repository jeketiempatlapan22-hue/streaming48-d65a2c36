// Simple in-memory cache for reducing duplicate DB queries
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();
const inFlight = new Map<string, Promise<any>>();

const timeoutPattern = /timeout|timed out|deadline exceeded|upstream request timeout|processing this request timed out/i;

function isRetryableError(error: any): boolean {
  if (!error) return false;

  const code = String(error?.code ?? error?.status ?? "").toUpperCase();
  const message = String(error?.message ?? error?.error_description ?? "").toLowerCase();

  if (["PGRST301", "504", "ETIMEDOUT", "ECONNRESET"].includes(code)) return true;
  return timeoutPattern.test(message);
}

/**
 * Fetch with in-memory cache. Prevents duplicate queries across components.
 */
export async function cachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = 30_000
): Promise<T> {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data;
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const request = fetcher()
    .then((data) => {
      cache.set(key, { data, expiresAt: Date.now() + ttlMs });
      return data;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

/**
 * Invalidate a specific cache key
 */
export function invalidateCache(key: string) {
  cache.delete(key);
  inFlight.delete(key);
}

/**
 * Invalidate all cache entries
 */
export function clearCache() {
  cache.clear();
  inFlight.clear();
}

/**
 * Wrap a promise with timeout to avoid infinite loading states.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 10_000,
  timeoutMessage: string = "Permintaan ke server timeout"
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Retry a function with exponential backoff on failure.
 * Useful for handling 504 upstream timeouts.
 */
export async function withRetry<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  maxRetries: number = 2,
  baseDelay: number = 1000
): Promise<{ data: T | null; error: any }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fn();
    if (!result.error) {
      return result;
    }

    if (!isRetryableError(result.error) || attempt >= maxRetries) {
      return result;
    }

    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }

  return { data: null, error: new Error("Retry limit reached") };
}
