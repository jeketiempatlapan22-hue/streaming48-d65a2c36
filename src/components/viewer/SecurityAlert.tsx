import { useState, useEffect, forwardRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldAlert, X } from "lucide-react";

const SecurityAlert = forwardRef<HTMLDivElement>((_, ref) => {
  const [alert, setAlert] = useState<{ description: string; severity: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel("security-alerts")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "security_events" }, (payload: any) => {
          const evt = payload.new;
          if (evt && (evt.severity === "critical" || evt.severity === "high")) {
            setAlert({ description: evt.description, severity: evt.severity });
            setDismissed(false);
          }
        })
        .subscribe();
    } catch (e) {
      console.warn("[SecurityAlert] subscribe failed:", e);
    }
    return () => {
      try { if (channel) supabase.removeChannel(channel); } catch {}
    };
  }, []);

  if (!alert || dismissed) return null;
  const isCritical = alert.severity === "critical";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className={`relative mx-4 max-w-md w-full rounded-2xl border p-6 shadow-2xl ${isCritical ? "bg-destructive/95 border-destructive text-destructive-foreground" : "bg-yellow-600/95 border-yellow-500 text-white"}`}>
        <button onClick={() => setDismissed(true)} className="absolute top-3 right-3 opacity-70 hover:opacity-100 transition"><X className="h-5 w-5" /></button>
        <div className="flex flex-col items-center text-center gap-3">
          <div className="p-3 rounded-full bg-white/20"><ShieldAlert className="h-8 w-8" /></div>
          <h3 className="text-lg font-bold">{isCritical ? "⚠️ Serangan Terdeteksi!" : "🛡️ Peringatan Keamanan"}</h3>
          <p className="text-sm opacity-90">{alert.description}</p>
          <p className="text-xs opacity-70 mt-1">Sistem keamanan sedang menangani ancaman ini secara otomatis.</p>
        </div>
      </div>
    </div>
  );
});

SecurityAlert.displayName = "SecurityAlert";
export default SecurityAlert;
