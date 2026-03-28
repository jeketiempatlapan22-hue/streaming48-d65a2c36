import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const LiveViewerCount = ({ isLive }: { isLive: boolean }) => {
  const [count, setCount] = useState(0);
  const viewerKeyRef = useRef<string>("");

  useEffect(() => {
    if (!isLive) { setCount(0); return; }

    // Generate a unique viewer key for heartbeat
    if (!viewerKeyRef.current) {
      viewerKeyRef.current = `v_${crypto.randomUUID().slice(0, 12)}`;
    }
    const key = viewerKeyRef.current;

    // Send initial heartbeat
    supabase.rpc("viewer_heartbeat", { _key: key }).then(() => {});

    // Poll viewer count every 15s + send heartbeat every 30s
    let tick = 0;
    const interval = setInterval(async () => {
      tick++;
      // Heartbeat every 30s (every 2nd tick)
      if (tick % 2 === 0) {
        supabase.rpc("viewer_heartbeat", { _key: key }).then(() => {});
      }
      // Count every 15s
      const { data } = await supabase.rpc("get_viewer_count");
      if (typeof data === "number") setCount(data);
    }, 15_000);

    // Initial count fetch
    supabase.rpc("get_viewer_count").then(({ data }) => {
      if (typeof data === "number") setCount(data);
    });

    // Leave on unmount
    return () => {
      clearInterval(interval);
      supabase.rpc("viewer_leave", { _key: key }).then(() => {});
    };
  }, [isLive]);

  // Also leave on page unload
  useEffect(() => {
    if (!isLive) return;
    const handleUnload = () => {
      if (viewerKeyRef.current) {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/viewer_leave`;
        const body = JSON.stringify({ _key: viewerKeyRef.current });
        const headers = {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        };
        // sendBeacon with Blob to include content-type
        const blob = new Blob([body], { type: "application/json" });
        const sent = navigator.sendBeacon?.(url + `?apikey=${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`, blob);
        if (!sent) {
          fetch(url, { method: "POST", headers, body, keepalive: true }).catch(() => {});
        }
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [isLive]);

  if (!isLive || count === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className="inline-flex items-center gap-1.5 rounded-full bg-destructive/15 px-3 py-1.5"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
        </span>
        <Users className="h-3 w-3 text-destructive" />
        <span className="text-xs font-bold text-destructive">{count}</span>
      </motion.div>
    </AnimatePresence>
  );
};

export default LiveViewerCount;
