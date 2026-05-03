import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";
import { createClientId, safeStorageGet, safeStorageSet } from "@/lib/clientId";
import { useViewerCount } from "@/hooks/useViewerCount";

const STORAGE_KEY = "rt48_viewer_key";

const LiveViewerCount = ({ isLive, readOnly = false }: { isLive: boolean; readOnly?: boolean }) => {
  const count = useViewerCount();
  const viewerKeyRef = useRef<string>("");

  // Heartbeat/leave only on the live page (not in admin or read-only contexts)
  useEffect(() => {
    if (!isLive || readOnly) return;

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

    // Initial heartbeat
    supabase.rpc("viewer_heartbeat", { _key: key }).then(() => {});

    // Heartbeat every 60s when tab is visible
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const isHidden = () => typeof document !== "undefined" && document.hidden;
    const beat = () => {
      if (isHidden()) return;
      supabase.rpc("viewer_heartbeat", { _key: key }).then(() => {});
    };
    const start = () => { if (intervalId == null) intervalId = setInterval(beat, 60_000); };
    const stop = () => { if (intervalId != null) { clearInterval(intervalId); intervalId = null; } };
    const onVis = () => { if (isHidden()) stop(); else { beat(); start(); } };

    if (!isHidden()) start();
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      supabase.rpc("viewer_leave", { _key: key }).then(() => {});
    };
  }, [isLive, readOnly]);

  // Leave on page unload — fetch with keepalive + sendBeacon fallback
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
      try {
        fetch(url, { method: "POST", headers, body, keepalive: true }).catch(() => {});
      } catch {
        try {
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon?.(`${url}?apikey=${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`, blob);
        } catch {}
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [isLive, readOnly]);

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
