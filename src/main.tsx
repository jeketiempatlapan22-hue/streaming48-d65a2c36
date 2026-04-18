import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/installPrompt";

const CACHE_RESET_VERSION = "rt48-cache-reset-v11";

async function resetLegacyServiceWorkerCache() {
  if (!("caches" in window)) return;

  const lastVersion = localStorage.getItem("rt48-cache-version");
  const versionChanged = lastVersion !== CACHE_RESET_VERSION;

  try {
    // Always clear all caches on version change
    if (versionChanged) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));

      // Unregister all service workers
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((reg) => reg.unregister()));
      }

      localStorage.setItem("rt48-cache-version", CACHE_RESET_VERSION);

      // Only reload if there were actual caches/SWs to clear
      if (cacheKeys.length > 0) {
        window.location.reload();
        return;
      }
    }

    // For PWA: force SW update check on every page load
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      registrations.forEach((reg) => reg.update());
    }
  } catch {
    // noop: keep app usable even if cleanup fails
  }
}

void resetLegacyServiceWorkerCache();

// PWA iframe/preview guard: unregister SW in preview/iframe to avoid stale content
const isInIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if (isPreviewHost || isInIframe) {
  navigator.serviceWorker?.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}

// Start show reminder checker for PWA notifications
import("./lib/notifications").then(({ startReminderChecker }) => {
  startReminderChecker();
});
// Security guard - only in production
if (import.meta.env.PROD) {
  import("./lib/security").then(({ initSecurityGuard }) => {
    initSecurityGuard();
  });
}

// PWA: Listen for service worker updates — only reload on user-initiated navigation, not during streaming
if ("serviceWorker" in navigator) {
  let controllerChanged = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controllerChanged) return;
    controllerChanged = true;
    // Don't reload if user is on the live page (would interrupt streaming)
    if (window.location.pathname === "/live") {
      console.log("[SW] New service worker active, will apply on next navigation");
      return;
    }
    window.location.reload();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
