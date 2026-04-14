import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/installPrompt";

const CACHE_RESET_VERSION = "rt48-cache-reset-v6";

async function resetLegacyServiceWorkerCache() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || !("caches" in window)) return;
  if (localStorage.getItem(CACHE_RESET_VERSION) === "done") return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const cacheKeys = await caches.keys();

    await Promise.all(registrations.map((reg) => reg.unregister()));
    await Promise.all(cacheKeys.map((key) => caches.delete(key)));

    localStorage.setItem(CACHE_RESET_VERSION, "done");
    if (registrations.length > 0 || cacheKeys.length > 0) {
      window.location.reload();
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
