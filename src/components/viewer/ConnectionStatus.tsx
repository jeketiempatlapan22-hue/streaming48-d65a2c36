import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";

const ConnectionStatus = () => {
  const [status, setStatus] = useState<"connected" | "reconnecting" | "disconnected">("connected");
  const [visible, setVisible] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const channel = supabase.channel("connection-monitor");
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED") {
        setStatus("connected");
        setVisible(true);
        clearTimeout(hideTimeout.current);
        hideTimeout.current = setTimeout(() => setVisible(false), 2000);
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        setStatus("disconnected");
        setVisible(true);
      } else if (s === "CLOSED") {
        setStatus("disconnected");
        setVisible(true);
      }
    });

    const handleOnline = () => {
      setStatus("reconnecting");
      setVisible(true);
      channel.subscribe((s) => {
        if (s === "SUBSCRIBED") {
          setStatus("connected");
          clearTimeout(hideTimeout.current);
          hideTimeout.current = setTimeout(() => setVisible(false), 2000);
        }
      });
    };
    const handleOffline = () => { setStatus("disconnected"); setVisible(true); };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      clearTimeout(hideTimeout.current);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      supabase.removeChannel(channel);
    };
  }, []);

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
