// Client-side rate limiter to prevent spamming login/signup
const attempts = new Map<string, { count: number; resetAt: number }>();

/**
 * Check if an action is rate-limited.
 * @returns true if allowed, false if rate-limited
 */
export function checkClientRateLimit(
  key: string,
  maxAttempts: number = 3,
  windowMs: number = 60_000
): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxAttempts) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Get remaining seconds until rate limit resets.
 */
export function getRateLimitRemaining(key: string): number {
  const entry = attempts.get(key);
  if (!entry) return 0;
  const remaining = Math.ceil((entry.resetAt - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}
