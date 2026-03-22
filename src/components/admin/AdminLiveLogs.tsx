import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  RefreshCw, Activity, AlertTriangle, CheckCircle, XCircle,
  Coins, CreditCard, Key, Wifi, WifiOff, Filter
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LogEntry {
  timestamp: string;
  source: string;
  level: "info" | "warn" | "error";
  message: string;
}

interface LiveLogData {
  telegram: { healthy: boolean; lastPoll: string | null; ageSeconds: number | null; offset: number; unprocessedCount: number };
  orders: { coinPending: number; subPending: number };
  logs: LogEntry[];
}

const SOURCE_COLORS: Record<string, string> = {
  "telegram-poll": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "notify-coin-order": "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  "notify-subscription-order": "bg-purple-500/15 text-purple-400 border-purple-500/30",
  "security": "bg-red-500/15 text-red-400 border-red-500/30",
  "coin-redeem": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "system": "bg-muted text-muted-foreground border-border",
};

const LEVEL_ICONS: Record<string, React.ElementType> = { info: CheckCircle, warn: AlertTriangle, error: XCircle };
const LEVEL_COLORS: Record<string, string> = { info: "text-emerald-400", warn: "text-yellow-400", error: "text-red-400" };

const AdminLiveLogs = () => {
  const [data, setData] = useState<LiveLogData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/admin-live-logs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errBody}`);
      }

      const result = await response.json();
      if (result.error) throw new Error(result.error);
      setData(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (autoRefresh) intervalRef.current = setInterval(fetchLogs, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchLogs]);

  const filteredLogs = data?.logs?.filter((l) => filter === "all" || l.source === filter || l.level === filter) || [];
  const sources = [...new Set(data?.logs?.map((l) => l.source) || [])];

  const formatTime = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "short" });
  const formatAge = (seconds: number | null) => {
    if (seconds === null) return "N/A";
    if (seconds < 60) return `${seconds}s lalu`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m lalu`;
    return `${Math.floor(seconds / 3600)}h lalu`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Live System Logs</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={autoRefresh ? "default" : "outline"} size="sm" onClick={() => setAutoRefresh(!autoRefresh)} className="text-xs">
            {autoRefresh ? "Auto ⚡" : "Manual"}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading} className="text-xs">
            <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {data?.telegram?.healthy ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-red-400" />}
            Telegram Bot
          </div>
          <div className={`mt-1 text-sm font-bold ${data?.telegram?.healthy ? "text-emerald-400" : "text-red-400"}`}>
            {data?.telegram?.healthy ? "Online" : "Offline"}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {data?.telegram?.lastPoll ? formatAge(data.telegram.ageSeconds) : "Belum polling"}
            {data?.telegram?.unprocessedCount ? ` • ${data.telegram.unprocessedCount} unprocessed` : ""}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Coins className="h-3.5 w-3.5 text-yellow-400" /> Order Koin</div>
          <div className="mt-1 text-sm font-bold text-foreground">{data?.orders?.coinPending ?? "—"} <span className="text-xs font-normal text-muted-foreground">pending</span></div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CreditCard className="h-3.5 w-3.5 text-purple-400" /> Subscription</div>
          <div className="mt-1 text-sm font-bold text-foreground">{data?.orders?.subPending ?? "—"} <span className="text-xs font-normal text-muted-foreground">pending</span></div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <button onClick={() => setFilter("all")} className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${filter === "all" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}>Semua</button>
        {sources.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${filter === s ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}>{s}</button>
        ))}
        <span className="mx-1 text-[10px] text-muted-foreground">|</span>
        {["warn", "error"].map((lvl) => (
          <button key={lvl} onClick={() => setFilter(lvl)} className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${filter === lvl ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
            {lvl === "warn" ? "⚠️ Warning" : "❌ Error"}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

      {/* Log entries */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-2.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Log Entries ({filteredLogs.length})</span>
        </div>
        <ScrollArea className="h-[400px] md:h-[500px]">
          <div className="divide-y divide-border">
            {filteredLogs.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">{loading ? "Memuat..." : "Tidak ada log"}</div>
            ) : (
              filteredLogs.map((log, i) => {
                const LevelIcon = LEVEL_ICONS[log.level] || CheckCircle;
                return (
                  <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                    <LevelIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${LEVEL_COLORS[log.level] || ""}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_COLORS[log.source] || SOURCE_COLORS.system}`}>{log.source}</span>
                        <span className="text-[10px] text-muted-foreground">{formatTime(log.timestamp)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-foreground/90 break-all leading-relaxed">{log.message}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};

export default AdminLiveLogs;
