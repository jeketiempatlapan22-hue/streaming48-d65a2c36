import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Check, Coins } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

const AdminNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const fetchNotifications = async () => {
    const { data } = await (supabase.from as any)("admin_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    setNotifications(data || []);
  };

  useEffect(() => {
    fetchNotifications();
    const channel = supabase
      .channel("admin-notifs-bell")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_notifications" }, (payload: any) => {
        setNotifications((prev) => [payload.new as Notification, ...prev].slice(0, 30));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await (supabase.from as any)("admin_notifications")
      .update({ is_read: true })
      .in("id", unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const typeIcon = (type: string) => {
    if (type === "coin_redeem" || type === "coin_order") return <Coins className="h-4 w-4 text-yellow-500" />;
    return <Bell className="h-4 w-4 text-primary" />;
  };

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) markAllRead(); }}
        className="relative rounded-lg bg-secondary p-2 text-secondary-foreground transition hover:bg-secondary/80"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full z-50 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h4 className="text-sm font-semibold text-foreground">🔔 Notifikasi</h4>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                    <Check className="h-3 w-3" /> Tandai dibaca
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">Belum ada notifikasi</p>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map((n) => (
                    <div key={n.id} className={`flex items-start gap-3 px-4 py-3 ${!n.is_read ? "bg-primary/5" : ""}`}>
                      <div className="mt-0.5 shrink-0">{typeIcon(n.type)}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-foreground">{n.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{n.message}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {new Date(n.created_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminNotifications;
