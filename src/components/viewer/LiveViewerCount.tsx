import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const LiveViewerCount = ({ isLive }: { isLive: boolean }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isLive) { setCount(0); return; }

    const channel = supabase.channel("live-viewers-landing", {
      config: { presence: { key: `viewer-${Math.random().toString(36).slice(2)}` } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setCount(Object.keys(state).length);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

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
