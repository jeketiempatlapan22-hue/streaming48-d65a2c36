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
  if (["PGRST301", "504", "ETIMEDOUT", "ECONNRESET", "500"].includes(code)) return true;
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

export function invalidateCache(key: string) {
  cache.delete(key);
  inFlight.delete(key);
}

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
 */
export async function withRetry<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  maxRetries: number = 2,
  baseDelay: number = 1000
): Promise<{ data: T | null; error: any }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fn();
    if (!result.error) return result;
    if (!isRetryableError(result.error) || attempt >= maxRetries) return result;
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
  return { data: null, error: new Error("Retry limit reached") };
}

/**
 * Fetch data from cached edge function (server-side cache).
 * Falls back to null on failure — caller should use direct DB as fallback.
 */
export async function fetchCachedEndpoint(
  type: "landing" | "shows" | "stats" | "all" = "landing"
): Promise<any | null> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  if (!projectId) return null;

  const cacheKey = `edge_${type}`;
  const url = `https://${projectId}.supabase.co/functions/v1/cached-landing-data?type=${type}`;
  const doFetch = async (timeoutMs: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  return cachedQuery(cacheKey, async () => {
    try {
      let res = await doFetch(4000);
      // Retry once on transient edge runtime errors (503 / cold boot)
      if (!res.ok && (res.status === 503 || res.status === 504 || res.status >= 500)) {
        await new Promise(r => setTimeout(r, 400));
        res = await doFetch(5000);
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, 25_000).catch(() => null);
}

// Preload landing data as early as possible (module-level, fires on import)
let _preloadPromise: Promise<any> | null = null;
export function preloadLandingData(): Promise<any> {
  if (!_preloadPromise) {
    _preloadPromise = fetchCachedEndpoint("all");
  }
  return _preloadPromise;
}

// Fire preload immediately on module load
preloadLandingData();
