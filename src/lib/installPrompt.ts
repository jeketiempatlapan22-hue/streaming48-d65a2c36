/**
 * Global PWA install prompt manager.
 * Captures `beforeinstallprompt` as early as possible so it's available
 * regardless of which component/page is mounted when the event fires.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(prompt: BeforeInstallPromptEvent | null) => void>();

function notify() {
  listeners.forEach((fn) => fn(deferredPrompt));
}

function getStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

// Start listening immediately on import
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

export function getInstallPrompt() {
  return deferredPrompt;
}

export function clearInstallPrompt() {
  deferredPrompt = null;
  notify();
}

export function isAppInstalled() {
  return getStandaloneMode();
}

export function onInstallPromptChange(fn: (prompt: BeforeInstallPromptEvent | null) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function waitForInstallPrompt(timeoutMs = 1800): Promise<BeforeInstallPromptEvent | null> {
  if (deferredPrompt) {
    return Promise.resolve(deferredPrompt);
  }

  if (typeof window === "undefined" || getStandaloneMode()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;

    const unsubscribe = onInstallPromptChange((prompt) => {
      if (!prompt || settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(prompt);
    });

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(deferredPrompt);
    }, timeoutMs);
  });
}

export type { BeforeInstallPromptEvent };
