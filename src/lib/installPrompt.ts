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

export function onInstallPromptChange(fn: (prompt: BeforeInstallPromptEvent | null) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export type { BeforeInstallPromptEvent };
