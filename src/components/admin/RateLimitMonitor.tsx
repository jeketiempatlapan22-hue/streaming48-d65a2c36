import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, ShieldOff, RefreshCw, Ban, Search, Clock, Timer } from "lucide-react";
import { toast } from "sonner";

interface BlockedIP {
  id: string;
  ip_address: string;
  reason: string;
  violation_count: number;
  is_active: boolean;
  auto_blocked: boolean;
  blocked_at: string;
  unblocked_at: string | null;
}

interface Violation {
  id: string;
  ip_address: string;
  endpoint: string;
  violation_key: string;
  created_at: string;
}

const RateLimitMonitor = () => {
  const [blockedIPs, setBlockedIPs] = useState<BlockedIP[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [manualIP, setManualIP] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [tab, setTab] = useState<"blocked" | "violations">("blocked");

  const fetchData = useCallback(async () => {
    try {
      const [blockedRes, violationsRes] = await Promise.all([
        supabase.from("blocked_ips").select("*").order("blocked_at", { ascending: false }),
        supabase.from("rate_limit_violations").select("*").order("created_at", { ascending: false }).limit(100),
      ]);
      if (blockedRes.data) setBlockedIPs(blockedRes.data as BlockedIP[]);
      if (violationsRes.data) setViolations(violationsRes.data as Violation[]);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleBlock = async () => {
    const ip = manualIP.trim();
    if (!ip) return;
    const { error } = await supabase.from("blocked_ips").upsert({
      ip_address: ip,
      reason: manualReason || "Manual block by admin",
      is_active: true,
      auto_blocked: false,
      violation_count: 0,
      blocked_at: new Date().toISOString(),
    } as any, { onConflict: "ip_address" });
    if (error) { toast.error("Gagal blokir IP"); return; }
    toast.success(`IP ${ip} diblokir`);
    setManualIP(""); setManualReason("");
    fetchData();
  };

  const toggleBlock = async (ip: BlockedIP) => {
    const newActive = !ip.is_active;
    const { error } = await supabase.from("blocked_ips").update({
      is_active: newActive,
      ...(newActive ? {} : { unblocked_at: new Date().toISOString(), unblocked_by: "admin" }),
    }).eq("id", ip.id);
    if (error) { toast.error("Gagal update"); return; }
    toast.success(newActive ? `IP ${ip.ip_address} diblokir kembali` : `IP ${ip.ip_address} di-unblock`);
    fetchData();
  };

  const deleteBlock = async (id: string) => {
    await supabase.from("blocked_ips").delete().eq("id", id);
    toast.success("IP dihapus dari daftar");
    fetchData();
  };

  const filteredBlocked = blockedIPs.filter(b =>
    b.ip_address.includes(search) || b.reason.toLowerCase().includes(search.toLowerCase())
  );

  const violationsByIP = violations.reduce<Record<string, number>>((acc, v) => {
    acc[v.ip_address] = (acc[v.ip_address] || 0) + 1;
    return acc;
  }, {});

  const topViolators = Object.entries(violationsByIP)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">🛡️ Rate Limit Monitor</h2>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <Ban className="mx-auto mb-1 h-5 w-5 text-destructive" />
            <p className="text-2xl font-bold text-foreground">{blockedIPs.filter(b => b.is_active).length}</p>
            <p className="text-xs text-muted-foreground">IP Terblokir</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <Shield className="mx-auto mb-1 h-5 w-5 text-primary" />
            <p className="text-2xl font-bold text-foreground">{blockedIPs.filter(b => b.auto_blocked && b.is_active).length}</p>
            <p className="text-xs text-muted-foreground">Auto-blocked</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <Clock className="mx-auto mb-1 h-5 w-5 text-[hsl(var(--warning))]" />
            <p className="text-2xl font-bold text-foreground">{violations.length}</p>
            <p className="text-xs text-muted-foreground">Violations (100)</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <ShieldOff className="mx-auto mb-1 h-5 w-5 text-muted-foreground" />
            <p className="text-2xl font-bold text-foreground">{topViolators.length}</p>
            <p className="text-xs text-muted-foreground">IP Unik</p>
          </CardContent>
        </Card>
      </div>

      {/* Manual block */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-foreground">Blokir IP Manual</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="IP Address" value={manualIP} onChange={e => setManualIP(e.target.value)} className="flex-1" />
          <Input placeholder="Alasan (opsional)" value={manualReason} onChange={e => setManualReason(e.target.value)} className="flex-1" />
          <Button onClick={handleBlock} disabled={!manualIP.trim()} size="sm">
            <Ban className="mr-1 h-3 w-3" /> Blokir
          </Button>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex gap-2">
        <Button variant={tab === "blocked" ? "default" : "outline"} size="sm" onClick={() => setTab("blocked")}>
          IP Terblokir ({blockedIPs.length})
        </Button>
        <Button variant={tab === "violations" ? "default" : "outline"} size="sm" onClick={() => setTab("violations")}>
          Top Violators ({topViolators.length})
        </Button>
      </div>

      {tab === "blocked" && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input placeholder="Cari IP atau alasan..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-xs" />
            </div>
          </CardHeader>
          <CardContent>
            {filteredBlocked.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada IP terblokir.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredBlocked.map(ip => (
                  <div key={ip.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium text-foreground">{ip.ip_address}</span>
                        {ip.auto_blocked && <Badge variant="destructive" className="text-[10px]">auto</Badge>}
                        <Badge variant={ip.is_active ? "destructive" : "outline"} className="text-[10px]">
                          {ip.is_active ? "blocked" : "unblocked"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{ip.reason}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(ip.blocked_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                        {" · "}{ip.violation_count} violations
                      </p>
                    </div>
                    <div className="flex gap-1 ml-2 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggleBlock(ip)}>
                        {ip.is_active ? "Unblock" : "Block"}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => deleteBlock(ip.id)}>
                        Hapus
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "violations" && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">Top Violators (berdasarkan frekuensi)</CardTitle>
          </CardHeader>
          <CardContent>
            {topViolators.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada pelanggaran rate limit.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {topViolators.map(([ip, count]) => {
                  const isBlocked = blockedIPs.some(b => b.ip_address === ip && b.is_active);
                  return (
                    <div key={ip} className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-foreground">{ip}</span>
                        <Badge variant="outline" className="text-[10px]">{count}x</Badge>
                        {isBlocked && <Badge variant="destructive" className="text-[10px]">blocked</Badge>}
                      </div>
                      {!isBlocked && (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setManualIP(ip); setTab("blocked"); }}>
                          Blokir
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default RateLimitMonitor;
