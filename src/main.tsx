import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/installPrompt";

const CACHE_RESET_VERSION = "rt48-cache-reset-v13";

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

      // Only reload if there were actual caches/SWs to clear AND user is not mid-stream.
      // Reloading on /live would interrupt playback; user account/session in localStorage is preserved either way.
      if (cacheKeys.length > 0 && window.location.pathname !== "/live") {
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

// PWA standalone: when launched with ?t=TOKEN at root, route directly to /live
try {
  const isStandaloneLaunch =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true;
  if (isStandaloneLaunch) {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("t");
    if (t && window.location.pathname !== "/live") {
      window.history.replaceState({}, "", `/live?t=${encodeURIComponent(t)}`);
    }
  }
} catch {}

// PWA: Pastikan user selalu dapat versi terbaru secepatnya tanpa harus menutup app.
if ("serviceWorker" in navigator) {
  let controllerChanged = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controllerChanged) return;
    controllerChanged = true;
    // Jangan reload kalau sedang nonton live — tunggu navigasi berikutnya.
    if (window.location.pathname === "/live") {
      console.log("[SW] New service worker active, will apply on next navigation");
      return;
    }
    window.location.reload();
  });

  // Helper: cek update + paksa SW yang waiting untuk aktif segera.
  const checkForUpdate = () => {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => {
        reg.update().catch(() => {});
        // Jika ada SW baru yang sudah ter-install dan menunggu, suruh aktif sekarang.
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) {
              // Versi baru siap — aktifkan segera.
              next.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      });
    });
  };

  // 1) Cek setiap 60 detik di halaman non-live.
  setInterval(() => {
    if (window.location.pathname === "/live") return;
    checkForUpdate();
  }, 60_000);

  // 2) Cek saat tab kembali fokus / PWA dibuka kembali — momen paling berharga
  //    untuk menarik update karena user baru saja kembali ke app.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && window.location.pathname !== "/live") {
      checkForUpdate();
    }
  });
  window.addEventListener("focus", () => {
    if (window.location.pathname !== "/live") checkForUpdate();
  });
  // 3) Saat koneksi pulih dari offline, langsung cek update.
  window.addEventListener("online", () => {
    if (window.location.pathname !== "/live") checkForUpdate();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
