import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { Megaphone, X } from "lucide-react";

const ViewerBroadcast = () => {
  const [notification, setNotification] = useState<{ id: string; title: string; message: string } | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Fetch latest unread broadcast
    const fetchLatest = async () => {
      const { data } = await supabase
        .from("admin_notifications")
        .select("*")
        .eq("type", "broadcast")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && !dismissed.has(data.id)) {
        setNotification(data);
      }
    };
    fetchLatest();

    // Listen for new broadcasts in real-time
    const ch = supabase
      .channel("viewer-broadcasts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_notifications" }, (payload: any) => {
        if (payload.new?.type === "broadcast" && !dismissed.has(payload.new.id)) {
          setNotification(payload.new);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [dismissed]);

  const handleDismiss = () => {
    if (notification) {
      setDismissed((prev) => new Set(prev).add(notification.id));
    }
    setNotification(null);
  };

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
