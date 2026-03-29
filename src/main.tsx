import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const CACHE_RESET_VERSION = "rt48-cache-reset-v5";

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

// Security guard - only in production
if (import.meta.env.PROD) {
  import("./lib/security").then(({ initSecurityGuard }) => {
    initSecurityGuard();
  });
}

// PWA: Listen for service worker updates and reload automatically
if ("serviceWorker" in navigator) {
  let controllerChanged = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controllerChanged) return;
    controllerChanged = true;
    // New service worker took control — reload for latest version
    window.location.reload();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
