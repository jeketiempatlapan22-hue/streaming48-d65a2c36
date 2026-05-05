import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Single source of truth for viewer count.
 *
 * - One global poller for the whole tab (refcount across components).
 * - Polls every 30s, skips when tab hidden, refreshes immediately on resume.
 * - Watchdog: if no successful refresh for >90s while visible, force a retry
 *   so the count can never get permanently "stuck".
 * - Components subscribe via `useViewerCount()` and receive live updates.
 */

type Listener = (n: number) => void;

const POLL_MS = 60_000;
const WATCHDOG_MS = 180_000;

let currentCount = 0;
let lastSuccessAt = 0;
let listeners = new Set<Listener>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

const isHidden = () => typeof document !== "undefined" && document.hidden;

const emit = () => {
  for (const l of listeners) {
    try { l(currentCount); } catch {}
  }
};

async function fetchOnce() {
  if (inflight || isHidden()) return;
  inflight = true;
  try {
    const { data, error } = await supabase.rpc("get_viewer_count");
    if (!error && typeof data === "number") {
      currentCount = data;
      lastSuccessAt = Date.now();
      emit();
    }
  } catch {
    // swallow — watchdog will retry
  } finally {
    inflight = false;
  }
}

function startPolling() {
  if (pollTimer == null) {
    pollTimer = setInterval(fetchOnce, POLL_MS);
  }
  if (watchdogTimer == null) {
    watchdogTimer = setInterval(() => {
      if (isHidden()) return;
      // If we haven't had a successful update in too long, force one.
      if (Date.now() - lastSuccessAt > WATCHDOG_MS) {
        fetchOnce();
      }
    }, 15_000);
  }
}

function stopPolling() {
  if (pollTimer != null) { clearInterval(pollTimer); pollTimer = null; }
  if (watchdogTimer != null) { clearInterval(watchdogTimer); watchdogTimer = null; }
}

function onVisibilityChange() {
  if (isHidden()) {
    stopPolling();
  } else {
    fetchOnce();
    startPolling();
  }
}

let visibilityBound = false;
function ensureVisibilityBound() {
  if (visibilityBound || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  visibilityBound = true;
}

/**
 * Subscribe to the global viewer-count stream.
 * Polling auto-starts on first subscriber and stops when the last unsubscribes.
 */
export function useViewerCount(): number {
  const [count, setCount] = useState<number>(currentCount);

  useEffect(() => {
    listeners.add(setCount);
    ensureVisibilityBound();

    // Kick off immediately for fresh data
    fetchOnce();
    if (!isHidden()) startPolling();

    return () => {
      listeners.delete(setCount);
      if (listeners.size === 0) stopPolling();
    };
  }, []);

  return count;
}
