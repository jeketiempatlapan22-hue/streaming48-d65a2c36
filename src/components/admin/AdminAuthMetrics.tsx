import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Clock, AlertTriangle, XCircle, CheckCircle, TrendingUp, Users, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MetricSummary {
  totalLogins: number;
  successCount: number;
  timeoutCount: number;
  errorCount: number;
  roleCheckFails: number;
  p95LoginMs: number;
  avgLoginMs: number;
  viewerLogins: number;
  adminLogins: number;
  recentEvents: any[];
}

const AdminAuthMetrics = () => {
  const [metrics, setMetrics] = useState<MetricSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"1h" | "24h" | "7d">("24h");

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const hoursMap = { "1h": 1, "24h": 24, "7d": 168 };
      const since = new Date(Date.now() - hoursMap[timeRange] * 3600_000).toISOString();

      const { data: events } = await supabase
        .from("auth_metrics" as any)
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (!events || events.length === 0) {
        setMetrics({
          totalLogins: 0, successCount: 0, timeoutCount: 0, errorCount: 0,
          roleCheckFails: 0, p95LoginMs: 0, avgLoginMs: 0,
          viewerLogins: 0, adminLogins: 0, recentEvents: [],
        });
        setLoading(false);
        return;
      }

      const successEvents = events.filter((e: any) => e.event_type?.includes("_success"));
      const timeoutEvents = events.filter((e: any) => e.event_type?.includes("_timeout"));
      const errorEvents = events.filter((e: any) => e.event_type?.includes("_error"));
      const roleCheckFails = events.filter((e: any) =>
        e.event_type === "role_check_fail" || e.event_type === "role_check_timeout"
      );

      // Calculate p95 from successful login durations
      const loginDurations = successEvents
        .filter((e: any) => e.duration_ms != null && e.event_type?.includes("login"))
        .map((e: any) => e.duration_ms as number)
        .sort((a: number, b: number) => a - b);

      const p95 = loginDurations.length > 0
        ? loginDurations[Math.floor(loginDurations.length * 0.95)] || 0
        : 0;
      const avg = loginDurations.length > 0
        ? Math.round(loginDurations.reduce((a: number, b: number) => a + b, 0) / loginDurations.length)
        : 0;

      setMetrics({
        totalLogins: events.length,
        successCount: successEvents.length,
        timeoutCount: timeoutEvents.length,
        errorCount: errorEvents.length,
        roleCheckFails: roleCheckFails.length,
        p95LoginMs: Math.round(p95),
        avgLoginMs: avg,
        viewerLogins: events.filter((e: any) => e.source === "viewer").length,
        adminLogins: events.filter((e: any) => e.source === "admin").length,
        recentEvents: events.slice(0, 30),
      });
    } catch {
      setMetrics(null);
    }
    setLoading(false);
  }, [timeRange]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  const statusColor = (val: number, warn: number, err: number) =>
    val >= err ? "text-red-500" : val >= warn ? "text-yellow-500" : "text-green-500";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!metrics) {
    return <p className="text-sm text-muted-foreground text-center py-8">Gagal memuat metrik auth.</p>;
  }

  const cards = [
    { label: "Total Events", value: metrics.totalLogins, icon: TrendingUp, color: "text-blue-500" },
    { label: "Sukses", value: metrics.successCount, icon: CheckCircle, color: "text-green-500" },
    { label: "Timeout", value: metrics.timeoutCount, icon: Clock, color: statusColor(metrics.timeoutCount, 5, 20) },
    { label: "Error", value: metrics.errorCount, icon: XCircle, color: statusColor(metrics.errorCount, 3, 10) },
    { label: "Role Check Fail", value: metrics.roleCheckFails, icon: Shield, color: statusColor(metrics.roleCheckFails, 2, 5) },
    { label: "P95 Login (ms)", value: metrics.p95LoginMs, icon: Clock, color: statusColor(metrics.p95LoginMs, 3000, 8000) },
    { label: "Avg Login (ms)", value: metrics.avgLoginMs, icon: Clock, color: "text-muted-foreground" },
    { label: "Viewer / Admin", value: `${metrics.viewerLogins} / ${metrics.adminLogins}` as any, icon: Users, color: "text-muted-foreground" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-foreground">📊 Auth Metrics</h2>
        <div className="flex items-center gap-2">
          {(["1h", "24h", "7d"] as const).map((r) => (
            <Button key={r} variant={timeRange === r ? "default" : "outline"} size="sm" onClick={() => setTimeRange(r)}>
              {r}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={fetchMetrics} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <Icon className={`h-5 w-5 ${c.color}`} />
                <div>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="text-lg font-bold text-foreground">
                    {typeof c.value === "number" ? c.value.toLocaleString("id-ID") : c.value}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Health indicator */}
      {metrics.timeoutCount > 10 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-foreground">⚠️ Banyak Timeout Terdeteksi</p>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics.timeoutCount} timeout dalam {timeRange}. Database kemungkinan overloaded.
              Pertimbangkan untuk mengurangi frekuensi polling bot atau menambah connection pool.
            </p>
          </div>
        </div>
      )}

      {/* Recent events table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Event Terbaru</h3>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {metrics.recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Belum ada event tercatat.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Waktu</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Event</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Source</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Durasi</th>
                </tr>
              </thead>
              <tbody>
                {metrics.recentEvents.map((ev: any) => {
                  const isError = ev.event_type?.includes("error") || ev.event_type?.includes("timeout") || ev.event_type?.includes("fail");
                  return (
                    <tr key={ev.id} className={`border-t border-border ${isError ? "bg-red-500/5" : ""}`}>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(ev.created_at).toLocaleTimeString("id-ID")}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`font-medium ${isError ? "text-red-500" : "text-green-500"}`}>
                          {ev.event_type}
                        </span>
                        {ev.error_message && (
                          <p className="text-muted-foreground mt-0.5 truncate max-w-[200px]" title={ev.error_message}>
                            {ev.error_message}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{ev.source}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {ev.duration_ms != null ? `${ev.duration_ms}ms` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminAuthMetrics;
