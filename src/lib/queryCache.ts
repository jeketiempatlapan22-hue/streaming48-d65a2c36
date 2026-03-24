import { supabase } from "@/integrations/supabase/client";

// Simple in-memory cache for reducing duplicate DB queries
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

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

  const data = await fetcher();
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

/**
 * Invalidate a specific cache key
 */
export function invalidateCache(key: string) {
  cache.delete(key);
}

/**
 * Invalidate all cache entries
 */
export function clearCache() {
  cache.clear();
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
    // If success or non-retryable error, return immediately
    if (!result.error || (result.error?.code && !['PGRST301', '504'].includes(String(result.error.code)))) {
      return result;
    }
    // Check if the error message indicates a timeout
    const errMsg = result.error?.message || '';
    if (!errMsg.includes('timeout') && !errMsg.includes('504') && attempt > 0) {
      return result;
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
  // Should not reach here, but just in case
  return await fn();
}
