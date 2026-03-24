import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Security guard - only in production
if (import.meta.env.PROD) {
  import("./lib/security").then(({ initSecurityGuard }) => {
    initSecurityGuard();
  });
}

// PWA: Listen for service worker updates and reload automatically
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // New service worker took control — reload for latest version
    window.location.reload();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
