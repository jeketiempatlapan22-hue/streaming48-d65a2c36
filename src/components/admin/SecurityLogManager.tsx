import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, AlertTriangle, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface SecurityEvent {
  id: string;
  event_type: string;
  description: string;
  ip_address: string | null;
  severity: string;
  created_at: string;
}

const SecurityLogManager = () => {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");

  const fetchEvents = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("security_events" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setEvents((data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchEvents();
    // Poll every 30s instead of realtime (security_events removed from publication for security)
    const interval = setInterval(fetchEvents, 30_000);
    return () => clearInterval(interval);
  }, []);

  const severityColor = (s: string) => {
    switch (s) {
      case "critical": case "high": return "destructive";
      case "medium": return "secondary";
      default: return "outline";
    }
  };

  const filtered = events.filter((e) => {
    if (filterSeverity !== "all" && e.severity !== filterSeverity) return false;
    if (search && !e.description.toLowerCase().includes(search.toLowerCase()) && !e.event_type.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Security Log</h2>
          <Badge variant="outline" className="text-xs">{events.length} events</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={fetchEvents} disabled={loading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Cari event..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {["all", "critical", "high", "medium", "low"].map((s) => (
          <Button key={s} variant={filterSeverity === s ? "default" : "outline"} size="sm" onClick={() => setFilterSeverity(s)} className="text-xs capitalize">
            {s === "all" ? "Semua" : s}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card p-12 text-center">
          <Shield className="mb-3 h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {events.length === 0 ? "Belum ada event keamanan terdeteksi" : "Tidak ada event yang cocok filter"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <div key={e.id} className={`rounded-lg border p-3 transition-colors ${
              e.severity === "critical" ? "border-destructive/40 bg-destructive/5"
                : e.severity === "high" ? "border-orange-500/40 bg-orange-500/5"
                : "border-border bg-card"
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  {(e.severity === "critical" || e.severity === "high") ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-destructive shrink-0" /> : <Shield className="mt-0.5 h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={severityColor(e.severity) as any} className="text-[10px] uppercase">{e.severity}</Badge>
                      <span className="text-xs font-mono text-muted-foreground">{e.event_type}</span>
                    </div>
                    <p className="mt-1 text-sm text-foreground break-words">{e.description}</p>
                    {e.ip_address && <p className="mt-0.5 text-xs text-muted-foreground">IP: {e.ip_address}</p>}
                  </div>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap">
                  {new Date(e.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SecurityLogManager;
