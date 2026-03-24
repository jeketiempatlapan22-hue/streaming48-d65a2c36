import { supabase } from "@/integrations/supabase/client";

/**
 * Record an auth metric event (fire-and-forget, never blocks UI).
 */
export function recordAuthMetric(
  eventType: string,
  durationMs?: number,
  source: "viewer" | "admin" = "viewer",
  errorMessage?: string
) {
  try {
    const ua = navigator.userAgent?.slice(0, 200) || null;
    (supabase
      .from("auth_metrics" as any)
      .insert({
        event_type: eventType,
        duration_ms: durationMs ? Math.round(durationMs) : null,
        source,
        user_agent: ua,
        error_message: errorMessage?.slice(0, 500) || null,
      }) as any as Promise<any>)
      .then(() => {})
      .catch(() => {});
  } catch {
    // silently ignore - metrics must never break the app
  }
}

/**
 * Wraps an async auth operation, records timing + success/failure.
 */
export async function withAuthMetrics<T>(
  label: string,
  source: "viewer" | "admin",
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const ms = performance.now() - start;
    recordAuthMetric(`${label}_success`, ms, source);
    return result;
  } catch (err: any) {
    const ms = performance.now() - start;
    const isTimeout = /timeout|timed out|deadline|504/i.test(String(err?.message || err));
    recordAuthMetric(
      isTimeout ? `${label}_timeout` : `${label}_error`,
      ms,
      source,
      String(err?.message || err).slice(0, 500)
    );
    throw err;
  }
}
