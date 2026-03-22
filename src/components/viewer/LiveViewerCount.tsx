import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const LiveViewerCount = ({ isLive }: { isLive: boolean }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isLive) { setCount(0); return; }

    // Subscribe to the same "online-users" channel as LiveChat but READ-ONLY
    // Do NOT call channel.track() — we only want to observe live viewers, not add ourselves
    const channel = supabase.channel("online-users");

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setCount(Object.keys(state).length);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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
