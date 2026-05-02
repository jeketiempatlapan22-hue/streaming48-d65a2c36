import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollText, RefreshCw, Search, CheckCircle2, XCircle, AlertTriangle, Smartphone, Globe, Eye, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

interface AuditEntry {
  id: string;
  reseller_id: string | null;
  reseller_name: string | null;
  reseller_prefix: string | null;
  source: string;
  show_id: string | null;
  show_title: string | null;
  show_input: string | null;
  token_id: string | null;
  token_code: string | null;
  max_devices: number | null;
  duration_days: number | null;
  status: string;
  rejection_reason: string | null;
  replay_info: any;
  metadata: any;
  created_at: string;
}

const REJECTION_LABELS: Record<string, string> = {
  bundle_show: "Show Bundle (ditolak)",
  show_not_found: "Show tidak ditemukan",
  rate_limit: "Batas pembuatan tercapai",
  invalid_session: "Sesi tidak valid",
  invalid_max_devices: "Max device tidak valid",
  invalid_duration: "Durasi tidak valid",
  reseller_inactive: "Reseller nonaktif",
  parse_error: "Format command salah",
  reseller_not_found: "Pengirim bukan reseller",
};

const ResellerAuditLog = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "rejected" | "error">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "web" | "whatsapp">("all");
  const [resellerFilter, setResellerFilter] = useState<string>("all");
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("reseller_token_audit")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) toast.error("Gagal memuat audit log");
    else setEntries((data || []) as AuditEntry[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEntries();
    const ch = supabase
      .channel("reseller-audit")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reseller_token_audit" }, (p) => {
        setEntries((prev) => [p.new as AuditEntry, ...prev].slice(0, 300));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchEntries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        (e.reseller_name || "").toLowerCase().includes(q) ||
        (e.reseller_prefix || "").toLowerCase().includes(q) ||
        (e.show_title || "").toLowerCase().includes(q) ||
        (e.token_code || "").toLowerCase().includes(q) ||
        (e.show_input || "").toLowerCase().includes(q) ||
        (e.rejection_reason || "").toLowerCase().includes(q)
      );
    });
  }, [entries, search, statusFilter, sourceFilter]);

  const stats = useMemo(() => ({
    total: entries.length,
    success: entries.filter((e) => e.status === "success").length,
    rejected: entries.filter((e) => e.status === "rejected").length,
    error: entries.filter((e) => e.status === "error").length,
  }), [entries]);

  const statusBadge = (s: string) => {
    if (s === "success") return <Badge className="bg-primary/15 text-primary border border-primary/30"><CheckCircle2 className="h-3 w-3 mr-1" />Sukses</Badge>;
    if (s === "rejected") return <Badge className="bg-accent/15 text-accent-foreground border border-accent/30"><AlertTriangle className="h-3 w-3 mr-1" />Ditolak</Badge>;
    return <Badge className="bg-destructive/15 text-destructive border border-destructive/30"><XCircle className="h-3 w-3 mr-1" />Error</Badge>;
  };

  const sourceBadge = (s: string) =>
    s === "whatsapp"
      ? <Badge variant="outline" className="gap-1"><Smartphone className="h-3 w-3" />WhatsApp</Badge>
      : <Badge variant="outline" className="gap-1"><Globe className="h-3 w-3" />Web</Badge>;

  const copyCode = (code: string) => { navigator.clipboard.writeText(code); toast.success("Kode disalin"); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">Audit Log Token Reseller</h2>
        </div>
        <Button onClick={fetchEntries} disabled={loading} size="sm" variant="outline">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total", value: stats.total, color: "text-foreground" },
          { label: "Sukses", value: stats.success, color: "text-primary" },
          { label: "Ditolak", value: stats.rejected, color: "text-accent-foreground" },
          { label: "Error", value: stats.error, color: "text-destructive" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari reseller, show, token..." className="pl-9" />
        </div>
        <div className="flex gap-1">
          {(["all", "success", "rejected", "error"] as const).map((s) => (
            <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
              {s === "all" ? "Semua" : s === "success" ? "Sukses" : s === "rejected" ? "Tolak" : "Error"}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["all", "web", "whatsapp"] as const).map((s) => (
            <Button key={s} size="sm" variant={sourceFilter === s ? "default" : "outline"} onClick={() => setSourceFilter(s)}>
              {s === "all" ? "All" : s === "web" ? "Web" : "WA"}
            </Button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 && !loading && (
          <div className="text-center text-muted-foreground py-12 text-sm">Belum ada audit log.</div>
        )}
        {filtered.map((e) => (
          <div key={e.id} className="rounded-lg border border-border bg-card p-3 hover:bg-secondary/30 transition-colors">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {statusBadge(e.status)}
                  {sourceBadge(e.source)}
                  {e.reseller_prefix && <Badge variant="secondary" className="font-mono">/{e.reseller_prefix.toUpperCase()}token</Badge>}
                  {e.max_devices && e.max_devices > 1 && <Badge className="bg-destructive/15 text-destructive border border-destructive/30">{e.max_devices} device</Badge>}
                </div>
                <div className="mt-2 text-sm">
                  <span className="font-medium">{e.reseller_name || "Unknown"}</span>
                  {e.show_title && <> • <span className="text-muted-foreground">{e.show_title}</span></>}
                  {e.show_input && !e.show_title && <> • <span className="text-muted-foreground italic">"{e.show_input}"</span></>}
                </div>
                {e.token_code && (
                  <div className="mt-1 flex items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{e.token_code}</code>
                    <button onClick={() => copyCode(e.token_code!)} className="text-muted-foreground hover:text-foreground">
                      <Copy className="h-3 w-3" />
                    </button>
                    {e.duration_days && <span className="text-xs text-muted-foreground">• {e.duration_days} hari</span>}
                  </div>
                )}
                {e.rejection_reason && (
                  <div className="mt-1 text-xs text-accent-foreground">
                    🚫 {REJECTION_LABELS[e.rejection_reason] || e.rejection_reason}
                  </div>
                )}
                {e.replay_info?.access_password && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    🔐 Replay password diberikan: <code className="bg-muted px-1 rounded">{e.replay_info.access_password}</code>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(e.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" })}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setDetail(e)}>
                  <Eye className="h-3 w-3 mr-1" />Detail
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Detail Audit Entry</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <Row label="Status">{statusBadge(detail.status)}</Row>
              <Row label="Sumber">{sourceBadge(detail.source)}</Row>
              <Row label="Reseller">{detail.reseller_name || "-"} {detail.reseller_prefix && `(/${detail.reseller_prefix.toUpperCase()})`}</Row>
              <Row label="Show">{detail.show_title || detail.show_input || "-"}</Row>
              {detail.token_code && <Row label="Token"><code className="bg-muted px-2 py-0.5 rounded font-mono">{detail.token_code}</code></Row>}
              {detail.max_devices && <Row label="Max Device">{detail.max_devices}</Row>}
              {detail.duration_days && <Row label="Durasi">{detail.duration_days} hari</Row>}
              {detail.rejection_reason && <Row label="Alasan">{REJECTION_LABELS[detail.rejection_reason] || detail.rejection_reason}</Row>}
              {detail.replay_info && Object.keys(detail.replay_info).length > 0 && (
                <Row label="Info Replay">
                  <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">{JSON.stringify(detail.replay_info, null, 2)}</pre>
                </Row>
              )}
              {detail.metadata && Object.keys(detail.metadata).length > 0 && (
                <Row label="Metadata">
                  <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">{JSON.stringify(detail.metadata, null, 2)}</pre>
                </Row>
              )}
              <Row label="Waktu">{new Date(detail.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</Row>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-3 gap-2 items-start">
    <span className="text-muted-foreground text-xs">{label}</span>
    <div className="col-span-2">{children}</div>
  </div>
);

export default ResellerAuditLog;
