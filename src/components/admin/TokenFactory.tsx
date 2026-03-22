import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Copy, Trash2, Ban, RefreshCw, Plus, Search, Globe, Lock, CheckCircle } from "lucide-react";

type DurationKey = "daily" | "weekly" | "monthly";

const TokenFactory = () => {
  const [tokens, setTokens] = useState<any[]>([]);
  const [sessions, setSessions] = useState<Record<string, number>>({});
  const [duration, setDuration] = useState<DurationKey>("daily");
  const [maxDevices, setMaxDevices] = useState("1");
  const [bulkCount, setBulkCount] = useState("1");
  const [isPublic, setIsPublic] = useState(false);
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("daily");
  const { toast } = useToast();

  const fetchTokens = async () => {
    const { data } = await supabase.from("tokens").select("*").order("created_at", { ascending: false });
    setTokens(data || []);
    const { data: sessData } = await supabase.from("token_sessions").select("token_id");
    if (sessData) {
      const counts: Record<string, number> = {};
      sessData.forEach((s: any) => { counts[s.token_id] = (counts[s.token_id] || 0) + 1; });
      setSessions(counts);
    }
  };

  useEffect(() => { fetchTokens(); }, []);

  const generateToken = async () => {
    const count = Math.max(1, Math.min(100, parseInt(bulkCount) || 1));
    setGenerating(true);
    const now = new Date();
    let expiresAt: Date;
    if (duration === "daily") expiresAt = new Date(now.getTime() + 86400000);
    else if (duration === "weekly") expiresAt = new Date(now.getTime() + 604800000);
    else expiresAt = new Date(now.getTime() + 2592000000);

    const rows = Array.from({ length: count }, () => ({
      code: `rt48_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      max_devices: isPublic ? 9999 : parseInt(maxDevices),
      duration_type: duration,
      expires_at: expiresAt.toISOString(),
      is_public: isPublic,
    }));

    await supabase.from("tokens").insert(rows);
    await fetchTokens();
    toast({ title: `${count} token berhasil dibuat!` });
    setGenerating(false);
  };

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/live?t=${code}`);
    toast({ title: "Link disalin!" });
  };

  const blockToken = async (id: string) => {
    const token = tokens.find(t => t.id === id);
    const newStatus = token?.status === "blocked" ? "active" : "blocked";
    await supabase.from("tokens").update({ status: newStatus }).eq("id", id);
    await fetchTokens();
    toast({ title: newStatus === "blocked" ? "Token diblokir" : "Token diaktifkan" });
  };

  const resetSessions = async (id: string) => {
    await supabase.from("token_sessions").delete().eq("token_id", id);
    await fetchTokens();
    toast({ title: "Session direset" });
  };

  const deleteToken = async (id: string) => {
    await supabase.from("token_sessions").delete().eq("token_id", id);
    await supabase.from("tokens").delete().eq("id", id);
    await fetchTokens();
    toast({ title: "Token dihapus" });
  };

  const isExpired = (t: any) => t.expires_at && new Date(t.expires_at) < new Date();

  const getFilteredTokens = (dur: string) => {
    return tokens.filter((t) => {
      if (dur !== "all" && t.duration_type !== dur) return false;
      return t.code.toLowerCase().includes(search.toLowerCase());
    });
  };

  const renderTokenList = (dur: string) => {
    const filtered = getFilteredTokens(dur);
    return (
      <div className="space-y-2">
        {filtered.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-mono text-sm font-semibold text-foreground truncate">{t.code}</p>
                {t.is_public && (
                  <span className="flex items-center gap-0.5 rounded-sm bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    <Globe className="h-2.5 w-2.5" /> PUBLIK
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-1">
                <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${
                  t.status === "blocked" ? "bg-destructive/20 text-destructive"
                    : isExpired(t) ? "bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]"
                    : "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
                }`}>
                  {t.status === "blocked" ? "BLOCKED" : isExpired(t) ? "EXPIRED" : "ACTIVE"}
                </span>
                {!t.is_public && <span className="text-[10px] text-muted-foreground">{t.max_devices} device</span>}
                {(sessions[t.id] || 0) > 0 && (
                  <span className="text-[10px] font-bold text-primary">👤 {sessions[t.id]} aktif</span>
                )}
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyLink(t.code)}><Copy className="h-3 w-3" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => resetSessions(t.id)}><RefreshCw className="h-3 w-3" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => blockToken(t.id)}>
                {t.status === "blocked" ? <CheckCircle className="h-3 w-3 text-[hsl(var(--success))]" /> : <Ban className="h-3 w-3 text-destructive" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteToken(t.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Belum ada token</p>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-foreground">🔑 Token Factory</h2>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 md:p-6">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipe</label>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            <span className="text-xs font-medium text-foreground">
              {isPublic ? <span className="flex items-center gap-1"><Globe className="h-3 w-3 text-[hsl(var(--success))]" /> Publik</span>
                : <span className="flex items-center gap-1"><Lock className="h-3 w-3" /> Private</span>}
            </span>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Durasi</label>
          <Select value={duration} onValueChange={(v) => setDuration(v as DurationKey)}>
            <SelectTrigger className="w-32 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">1 Hari</SelectItem>
              <SelectItem value="weekly">7 Hari</SelectItem>
              <SelectItem value="monthly">30 Hari</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!isPublic && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Max Device</label>
            <Select value={maxDevices} onValueChange={setMaxDevices}>
              <SelectTrigger className="w-24 bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Jumlah</label>
          <Input type="number" min="1" max="100" value={bulkCount} onChange={(e) => setBulkCount(e.target.value)} className="w-20 bg-background" />
        </div>
        <Button onClick={generateToken} disabled={generating}>
          <Plus className="mr-1 h-4 w-4" /> Generate
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari token..." className="bg-card pl-9" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="daily">📅 Harian ({tokens.filter(t => t.duration_type === "daily").length})</TabsTrigger>
          <TabsTrigger value="weekly">📆 Mingguan ({tokens.filter(t => t.duration_type === "weekly").length})</TabsTrigger>
          <TabsTrigger value="monthly">🗓️ Bulanan ({tokens.filter(t => t.duration_type === "monthly").length})</TabsTrigger>
        </TabsList>
        <TabsContent value="daily" className="mt-4">{renderTokenList("daily")}</TabsContent>
        <TabsContent value="weekly" className="mt-4">{renderTokenList("weekly")}</TabsContent>
        <TabsContent value="monthly" className="mt-4">{renderTokenList("monthly")}</TabsContent>
      </Tabs>
    </div>
  );
};

export default TokenFactory;
