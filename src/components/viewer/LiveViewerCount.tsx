import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";
import { createClientId, safeStorageGet, safeStorageSet } from "@/lib/clientId";

const STORAGE_KEY = "rt48_viewer_key";

const LiveViewerCount = ({ isLive, readOnly = false }: { isLive: boolean; readOnly?: boolean }) => {
  const [count, setCount] = useState(0);
  const viewerKeyRef = useRef<string>("");

  useEffect(() => {
    if (!isLive) { setCount(0); return; }

    // Only send heartbeats if not readOnly (i.e., only on the live page)
    if (!readOnly) {
      // Persist viewer key in sessionStorage to survive page refreshes
      if (!viewerKeyRef.current) {
        const stored = safeStorageGet(typeof window !== "undefined" ? window.sessionStorage : undefined, STORAGE_KEY);
        if (stored) {
          viewerKeyRef.current = stored;
        } else {
          viewerKeyRef.current = createClientId("v");
          safeStorageSet(typeof window !== "undefined" ? window.sessionStorage : undefined, STORAGE_KEY, viewerKeyRef.current);
        }
      }
      const key = viewerKeyRef.current;

      // Send initial heartbeat
      supabase.rpc("viewer_heartbeat", { _key: key }).then(() => {});

      // Poll viewer count every 30s + send heartbeat every 60s
      // Optimized for 1000+ concurrent viewers (reduces DB load by 50%)
      let tick = 0;
      const interval = setInterval(async () => {
        if (typeof document !== "undefined" && document.hidden) return;
        tick++;
        if (tick % 2 === 0) {
          supabase.rpc("viewer_heartbeat", { _key: key }).then(() => {});
        }
        const { data } = await supabase.rpc("get_viewer_count");
        if (typeof data === "number") setCount(data);
      }, 30_000);

      supabase.rpc("get_viewer_count").then(({ data }) => {
        if (typeof data === "number") setCount(data);
      });

      return () => {
        clearInterval(interval);
        supabase.rpc("viewer_leave", { _key: key }).then(() => {});
      };
    }

    // readOnly mode: only poll the count, no heartbeats
    const fetchCount = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const { data } = await supabase.rpc("get_viewer_count");
      if (typeof data === "number") setCount(data);
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, [isLive, readOnly]);

  // Also leave on page unload — use fetch with keepalive + Authorization header
  useEffect(() => {
    if (!isLive || readOnly) return;
    const handleUnload = () => {
      const key = viewerKeyRef.current;
      if (!key) return;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/viewer_leave`;
      const body = JSON.stringify({ _key: key });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      };
      // Primary: fetch with keepalive (supports custom headers)
      try {
        fetch(url, { method: "POST", headers, body, keepalive: true }).catch(() => {});
      } catch {
        // Fallback: sendBeacon with apikey as query param (no custom headers possible)
        try {
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon?.(`${url}?apikey=${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`, blob);
        } catch {}
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [isLive, readOnly]);

  // In readOnly (admin) mode always show; in viewer mode hide when offline or 0
  if (!readOnly && (!isLive || count === 0)) return null;

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${isLive ? "bg-destructive/15" : "bg-muted"}`}>
      {isLive && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
        </span>
      )}
      <Users className={`h-3 w-3 ${isLive ? "text-destructive" : "text-muted-foreground"}`} />
      <span className={`text-xs font-bold ${isLive ? "text-destructive" : "text-muted-foreground"}`}>{count}</span>
    </div>
  );
};

export default LiveViewerCount;
