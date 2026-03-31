import { useState, useEffect, useRef, useCallback } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";

/**
 * Lightweight connection status indicator.
 * Uses navigator.onLine + periodic fetch pings instead of a dedicated
 * Supabase realtime channel (which itself can cause connection churn).
 */
const ConnectionStatus = () => {
  const [status, setStatus] = useState<"connected" | "reconnecting" | "disconnected">("connected");
  const [visible, setVisible] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>();
  const pingInterval = useRef<ReturnType<typeof setInterval>>();

  const showConnected = useCallback(() => {
    setStatus("connected");
    setVisible(true);
    clearTimeout(hideTimeout.current);
    hideTimeout.current = setTimeout(() => setVisible(false), 2500);
  }, []);

  const showDisconnected = useCallback(() => {
    setStatus("disconnected");
    setVisible(true);
  }, []);

  useEffect(() => {
    // Only show status changes, not initial state
    let wasOffline = !navigator.onLine;

    const handleOnline = () => {
      if (wasOffline) {
        setStatus("reconnecting");
        setVisible(true);
        // Brief delay then confirm connected
        setTimeout(showConnected, 1500);
      }
      wasOffline = false;
    };

    const handleOffline = () => {
      wasOffline = true;
      showDisconnected();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Periodic lightweight connectivity check (every 30s)
    // Only activates status bar when there's an actual problem
    pingInterval.current = setInterval(async () => {
      if (!navigator.onLine) {
        showDisconnected();
        return;
      }
      // If we were disconnected, try a lightweight ping
      if (status === "disconnected") {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/`, {
            method: "HEAD",
            signal: controller.signal,
            headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          });
          clearTimeout(timeout);
          showConnected();
        } catch {
          // Still disconnected, stay in that state
        }
      }
    }, 30000);

    return () => {
      clearTimeout(hideTimeout.current);
      clearInterval(pingInterval.current);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [showConnected, showDisconnected, status]);

  if (!visible) return null;

  const config = {
    connected: { icon: <Wifi className="h-3 w-3" />, text: "Terhubung", bg: "bg-[hsl(var(--success))]/90", textColor: "text-primary-foreground" },
    reconnecting: { icon: <RefreshCw className="h-3 w-3 animate-spin" />, text: "Menghubungkan ulang...", bg: "bg-[hsl(var(--warning))]/90", textColor: "text-primary-foreground" },
    disconnected: { icon: <WifiOff className="h-3 w-3" />, text: "Koneksi terputus", bg: "bg-destructive/90", textColor: "text-destructive-foreground" },
  }[status];

  return (
    <div className={`fixed top-0 left-0 right-0 z-[100] flex items-center justify-center py-1 ${config.bg} ${config.textColor} text-[11px] font-medium backdrop-blur-sm transition-all duration-300`}>
      <div className="flex items-center gap-1.5">{config.icon}{config.text}</div>
    </div>
  );
};

export default ConnectionStatus;
