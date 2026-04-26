import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { Megaphone, X } from "lucide-react";

interface Broadcast {
  id: string;
  title: string;
  message: string;
  expires_at: string | null;
}

const isExpired = (b: Broadcast | null) =>
  !!b?.expires_at && new Date(b.expires_at).getTime() <= Date.now();

const ViewerBroadcast = () => {
  const [notification, setNotification] = useState<Broadcast | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let auto: number | undefined;

    const scheduleAutoExpire = (b: Broadcast) => {
      if (auto) { clearTimeout(auto); auto = undefined; }
      if (!b.expires_at) return;
      const ms = new Date(b.expires_at).getTime() - Date.now();
      if (ms <= 0) {
        setNotification(null);
        return;
      }
      auto = window.setTimeout(() => {
        setNotification((curr) => (curr && curr.id === b.id ? null : curr));
      }, Math.min(ms, 2_147_000_000)); // cap to setTimeout max
    };

    // Delay broadcast fetch to reduce initial DB load
    const timer = setTimeout(async () => {
      try {
        const nowIso = new Date().toISOString();
        const { data } = await supabase
          .from("admin_notifications")
          .select("id, title, message, expires_at")
          .eq("type", "broadcast")
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data && !dismissed.has(data.id)) {
          const b = data as Broadcast;
          setNotification(b);
          scheduleAutoExpire(b);
        }
      } catch (e) {
        console.warn("[ViewerBroadcast] fetch failed:", e);
      }
    }, 1000);

    // Listen for new broadcasts AND deletions in real-time
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel("viewer-broadcasts")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_notifications" }, (payload: any) => {
          if (payload.new?.type !== "broadcast") return;
          const b = payload.new as Broadcast;
          if (isExpired(b)) return;
          if (dismissed.has(b.id)) return;
          setNotification(b);
          scheduleAutoExpire(b);
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "admin_notifications" }, (payload: any) => {
          setNotification((curr) => (curr && payload.old?.id === curr.id ? null : curr));
        })
        .subscribe();
    } catch (e) {
      console.warn("[ViewerBroadcast] subscribe failed:", e);
    }

    return () => {
      try { if (ch) supabase.removeChannel(ch); } catch {}
      clearTimeout(timer);
      if (auto) clearTimeout(auto);
    };
  }, [dismissed]);

  const handleDismiss = () => {
    if (notification) {
      setDismissed((prev) => new Set(prev).add(notification.id));
    }
    setNotification(null);
  };

  // Defensive: if somehow the notification has expired between renders, hide it
  if (notification && isExpired(notification)) {
    return null;
  }

  return (
    <AnimatePresence>
      {notification && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed top-14 left-0 right-0 z-50 px-3"
        >
          <div className="mx-auto max-w-xl overflow-hidden rounded-xl border border-primary/30 bg-card/95 shadow-2xl shadow-primary/10 backdrop-blur-md">
            <div className="flex items-start gap-3 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                <Megaphone className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{notification.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground whitespace-pre-line">{notification.message}</p>
              </div>
              <button
                onClick={handleDismiss}
                className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/60 to-transparent" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ViewerBroadcast;
