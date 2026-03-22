import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, Database, Server, Zap, Clock, Users, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HealthItem {
  label: string;
  status: "ok" | "warn" | "error" | "loading";
  detail: string;
  icon: React.ElementType;
  ms?: number;
}

const SystemHealthCheck = () => {
  const [checks, setChecks] = useState<HealthItem[]>([]);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [running, setRunning] = useState(false);

  const runChecks = useCallback(async () => {
    setRunning(true);
    const results: HealthItem[] = [];

    // 1. Database
    const dbStart = performance.now();
    try {
      const { error } = await supabase.from("site_settings").select("key").limit(1);
      const ms = Math.round(performance.now() - dbStart);
      results.push({ label: "Database", status: error ? "error" : ms > 2000 ? "warn" : "ok", detail: error ? error.message : `Respons ${ms}ms`, icon: Database, ms });
    } catch (e: any) {
      results.push({ label: "Database", status: "error", detail: e.message, icon: Database });
    }

    // 2. Auth
    const authStart = performance.now();
    try {
      const { error } = await supabase.auth.getSession();
      const ms = Math.round(performance.now() - authStart);
      results.push({ label: "Authentication", status: error ? "error" : ms > 3000 ? "warn" : "ok", detail: error ? error.message : `Respons ${ms}ms`, icon: Shield, ms });
    } catch (e: any) {
      results.push({ label: "Authentication", status: "error", detail: e.message, icon: Shield });
    }

    // 3. Storage
    const stStart = performance.now();
    try {
      const { error } = await supabase.storage.from("show-images").list("", { limit: 1 });
      const ms = Math.round(performance.now() - stStart);
      results.push({ label: "Storage", status: error ? "error" : ms > 3000 ? "warn" : "ok", detail: error ? error.message : `Respons ${ms}ms`, icon: Server, ms });
    } catch (e: any) {
      results.push({ label: "Storage", status: "error", detail: e.message, icon: Server });
    }

    // 4. Pending orders
    try {
      const [coinRes, subRes] = await Promise.all([
        supabase.from("coin_orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("subscription_orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      const total = (coinRes.count ?? 0) + (subRes.count ?? 0);
      results.push({ label: "Order Pending", status: total > 20 ? "warn" : "ok", detail: `${coinRes.count ?? 0} koin, ${subRes.count ?? 0} langganan`, icon: Clock });
    } catch {
      results.push({ label: "Order Pending", status: "error", detail: "Gagal cek", icon: Clock });
    }

    // 5. Users
    try {
      const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true });
      results.push({ label: "User Terdaftar", status: "ok", detail: `${count ?? 0} pengguna`, icon: Users });
    } catch {
      results.push({ label: "User Terdaftar", status: "error", detail: "Gagal cek", icon: Users });
    }

    // 6. Security events (24h)
    try {
      const { count } = await supabase.from("security_events" as any).select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400000).toISOString());
      const c = (count as number) ?? 0;
      results.push({ label: "Insiden Keamanan (24j)", status: c > 50 ? "error" : c > 10 ? "warn" : "ok", detail: `${c} event tercatat`, icon: AlertTriangle });
    } catch {
      results.push({ label: "Insiden Keamanan", status: "ok", detail: "Tidak ada data", icon: AlertTriangle });
    }

    setChecks(results);
    setLastChecked(new Date());
    setRunning(false);
  }, []);

  useEffect(() => {
    runChecks();
    const interval = setInterval(runChecks, 60_000);
    return () => clearInterval(interval);
  }, [runChecks]);

  const overallStatus = checks.some((c) => c.status === "error") ? "error" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  const statusColor = { ok: "text-green-500", warn: "text-yellow-500", error: "text-red-500", loading: "text-muted-foreground" };
  const statusBg = { ok: "bg-green-500/10", warn: "bg-yellow-500/10", error: "bg-red-500/10", loading: "bg-muted/50" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">🏥 System Health</h2>
          {lastChecked && <p className="text-xs text-muted-foreground mt-1">Terakhir cek: {lastChecked.toLocaleTimeString("id-ID")} · Auto-refresh tiap 60 detik</p>}
        </div>
        <Button variant="outline" size="sm" onClick={runChecks} disabled={running} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className={`rounded-xl border border-border p-6 ${statusBg[overallStatus]}`}>
        <div className="flex items-center gap-3">
          {overallStatus === "ok" ? <CheckCircle className="h-8 w-8 text-green-500" /> : overallStatus === "warn" ? <AlertTriangle className="h-8 w-8 text-yellow-500" /> : <XCircle className="h-8 w-8 text-red-500" />}
          <div>
            <p className="text-lg font-bold text-foreground">
              {overallStatus === "ok" ? "Semua Sistem Normal ✅" : overallStatus === "warn" ? "Ada Peringatan ⚠️" : "Ada Masalah ❌"}
            </p>
            <p className="text-sm text-muted-foreground">{checks.filter((c) => c.status === "ok").length}/{checks.length} layanan berjalan normal</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {checks.map((check) => {
          const Icon = check.icon;
          return (
            <div key={check.label} className={`rounded-xl border border-border bg-card p-4 transition-all ${statusBg[check.status]}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 rounded-lg p-2 ${statusBg[check.status]}`}>
                  <Icon className={`h-4 w-4 ${statusColor[check.status]}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{check.label}</p>
                    {check.status === "ok" ? <CheckCircle className="h-4 w-4 shrink-0 text-green-500" /> : check.status === "warn" ? <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" /> : <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                  {check.ms !== undefined && (
                    <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${check.ms < 500 ? "bg-green-500" : check.ms < 2000 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, (check.ms / 5000) * 100)}%` }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h3 className="text-lg font-bold text-foreground">🛠️ Panduan Troubleshooting</h3>
        {[
          { title: "❌ Admin tidak bisa login", solutions: ["Pastikan email dan password benar", "Cek role admin di database", "Clear cache browser"] },
          { title: "📺 Live streaming tidak bisa diakses", solutions: ["Pastikan token valid", "Cek stream aktif (is_live)", "Refresh halaman"] },
          { title: "🤖 Bot Telegram tidak merespon", solutions: ["Kirim /status ke bot", "Pastikan token & chat ID benar", "Cek edge function logs"] },
          { title: "💰 Koin tidak bertambah", solutions: ["Pastikan order pending sebelum konfirmasi", "User perlu refresh halaman"] },
        ].map((item) => (
          <details key={item.title} className="group rounded-lg border border-border bg-background p-3">
            <summary className="cursor-pointer text-sm font-semibold text-foreground hover:text-primary transition-colors">{item.title}</summary>
            <ol className="mt-2 ml-4 space-y-1 list-decimal">
              {item.solutions.map((s, i) => <li key={i} className="text-xs text-muted-foreground">{s}</li>)}
            </ol>
          </details>
        ))}
      </div>
    </div>
  );
};

export default SystemHealthCheck;
