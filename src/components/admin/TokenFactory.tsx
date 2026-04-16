import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Copy, Trash2, Ban, RefreshCw, Plus, Search, Globe, Lock, ClipboardList, CheckCircle, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const DURATION_TABS = [
  { key: "daily", label: "Harian", emoji: "📅" },
  { key: "weekly", label: "Mingguan", emoji: "📆" },
  { key: "monthly", label: "Bulanan", emoji: "🗓️" },
  { key: "custom", label: "Custom", emoji: "⚙️" },
] as const;

type DurationKey = "daily" | "weekly" | "monthly" | "custom";
type TabKey = DurationKey | "coin";

const TokenFactory = () => {
  const [tokens, setTokens] = useState<any[]>([]);
  const [coinTokens, setCoinTokens] = useState<any[]>([]);
  const [sessions, setSessions] = useState<Record<string, number>>({});
  const [duration, setDuration] = useState<DurationKey>("daily");
  const [customDays, setCustomDays] = useState("3");
  const [maxDevices, setMaxDevices] = useState("1");
  const [bulkCount, setBulkCount] = useState("1");
  const [isPublic, setIsPublic] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<TabKey, Set<string>>>({
    daily: new Set(), weekly: new Set(), monthly: new Set(), custom: new Set(), coin: new Set(),
  });
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "blocked" | "expired">("all");
  const [activeTab, setActiveTab] = useState<TabKey>("daily");
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedTokens, setCopiedTokens] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("rt48_copied_tokens");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [lastCopied, setLastCopied] = useState<string[]>([]);
  const [extendToken, setExtendToken] = useState<any>(null);
  const [extendDays, setExtendDays] = useState("30");
  const { toast } = useToast();

  const fetchTokens = async () => {
    const [manualRes, coinRes] = await Promise.all([
      supabase.from("tokens").select("*").not("code", "like", "COIN-%").order("created_at", { ascending: false }),
      supabase.from("tokens").select("*").like("code", "COIN-%").order("created_at", { ascending: false }),
    ]);
    setTokens(manualRes.data || []);
    setCoinTokens(coinRes.data || []);
    const { data: sessData } = await supabase.from("token_sessions").select("token_id").eq("is_active", true);
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
    let durationLabel: string;
    if (duration === "custom") {
      const days = Math.max(1, Math.min(365, parseInt(customDays) || 3));
      expiresAt = new Date(now.getTime() + days * 86400000);
      durationLabel = `${days} hari`;
    } else if (duration === "daily") {
      expiresAt = new Date(now.getTime() + 86400000);
      durationLabel = "1 hari";
    } else if (duration === "weekly") {
      expiresAt = new Date(now.getTime() + 604800000);
      durationLabel = "7 hari";
    } else {
      expiresAt = new Date(now.getTime() + 2592000000);
      durationLabel = "30 hari";
    }

    const storedDuration = duration;

    const rows = Array.from({ length: count }, () => ({
      code: `rt48_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      max_devices: isPublic ? 9999 : Math.min(9999, Math.max(1, parseInt(maxDevices) || 1)),
      duration_type: storedDuration,
      expires_at: expiresAt.toISOString(),
      is_public: isPublic,
    }));

    const { error } = await supabase.from("tokens").insert(rows);
    if (error) {
      toast({ title: "Gagal membuat token", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${count} token berhasil dibuat! (durasi: ${durationLabel})` });
    }
    await fetchTokens();
    setGenerating(false);
    setActiveTab(storedDuration as TabKey);
  };

  const markAsCopied = (code: string) => {
    setCopiedTokens((prev) => {
      const next = new Set(prev);
      next.add(code);
      localStorage.setItem("rt48_copied_tokens", JSON.stringify([...next]));
      return next;
    });
  };

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(`https://realtime48stream.my.id/live?t=${code}`);
    markAsCopied(code);
    setLastCopied([code]);
    toast({ title: "Link disalin!" });
  };

  const bulkCopyUncopied = (dur: TabKey) => {
    const source = dur === "coin" ? coinTokens : tokens;
    const uncopied = source.filter(
      (t) => (dur === "coin" || t.duration_type === dur) && !copiedTokens.has(t.code) && t.status !== "blocked" && !isExpired(t)
    );
    if (uncopied.length === 0) {
      toast({ title: "Tidak ada token baru untuk disalin" });
      return;
    }
    const links = uncopied.map((t) => `https://realtime48stream.my.id/live?t=${t.code}`).join("\n");
    navigator.clipboard.writeText(links);
    const codes = uncopied.map((t) => t.code);
    codes.forEach((c) => markAsCopied(c));
    setLastCopied(codes);
    toast({ title: `${uncopied.length} link token disalin!` });
  };

  const undoLastCopy = () => {
    if (lastCopied.length === 0) return;
    setCopiedTokens((prev) => {
      const next = new Set(prev);
      lastCopied.forEach((c) => next.delete(c));
      localStorage.setItem("rt48_copied_tokens", JSON.stringify([...next]));
      return next;
    });
    toast({ title: `${lastCopied.length} token dibatalkan tandanya` });
    setLastCopied([]);
  };

  const blockToken = async (id: string) => {
    const token = [...tokens, ...coinTokens].find(t => t.id === id);
    const newStatus = token?.status === "blocked" ? "active" : "blocked";
    await supabase.from("tokens").update({ status: newStatus }).eq("id", id);
    if (newStatus === "blocked") {
      await supabase.from("token_sessions").update({ is_active: false }).eq("token_id", id);
      await supabase.from("admin_notifications").insert({
        title: `🚫 Token Diblokir: ${token?.code}`,
        message: `Token ${token?.code} telah diblokir dari admin panel.`,
        type: "token_block",
      });
      try {
        await supabase.functions.invoke("telegram-poll", {
          body: { notify_token_block: true, token_code: token?.code, action: "block" },
        });
      } catch {}
    }
    await fetchTokens();
    toast({ title: newStatus === "blocked" ? "Token diblokir" : "Token diaktifkan kembali" });
  };

  const resetSessions = async (id: string) => {
    await supabase.from("token_sessions").delete().eq("token_id", id);
    await fetchTokens();
    toast({ title: "Session direset" });
  };

  const extendTokenDuration = async () => {
    if (!extendToken) return;
    const days = Math.max(1, Math.min(3650, parseInt(extendDays) || 30));
    const currentExpiry = extendToken.expires_at ? new Date(extendToken.expires_at) : new Date();
    const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
    const newExpiry = new Date(baseDate.getTime() + days * 86400000);
    const { error } = await supabase.from("tokens").update({ expires_at: newExpiry.toISOString() }).eq("id", extendToken.id);
    if (error) {
      toast({ title: "Gagal memperpanjang", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Token diperpanjang ${days} hari` });
    }
    setExtendToken(null);
    setExtendDays("30");
    await fetchTokens();
  };

  const deleteTokens = async (ids: string[], dur: TabKey) => {
    if (deleting || ids.length === 0) return;
    setDeleting(true);
    try {
      await supabase.from("chat_messages").delete().in("token_id", ids);
      await supabase.from("token_sessions").delete().in("token_id", ids);
      await supabase.from("tokens").delete().in("id", ids);
      setSelected(prev => ({ ...prev, [dur]: new Set() }));
      await fetchTokens();
      toast({ title: `${ids.length} token dihapus` });
    } catch {
      toast({ title: "Gagal menghapus token", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelect = (id: string, dur: TabKey) => {
    setSelected((prev) => {
      const next = new Set(prev[dur]);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...prev, [dur]: next };
    });
  };

  const isExpired = (t: any) => t.expires_at && new Date(t.expires_at) < new Date();

  const getFilteredTokens = (dur: TabKey) => {
    const source = dur === "coin" ? coinTokens : tokens;
    return source.filter((t) => {
      if (dur !== "coin" && t.duration_type !== dur) return false;
      const matchSearch = t.code.toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;
      if (statusFilter === "all") return true;
      if (statusFilter === "blocked") return t.status === "blocked";
      if (statusFilter === "expired") return t.status !== "blocked" && isExpired(t);
      if (statusFilter === "active") return t.status !== "blocked" && !isExpired(t);
      return true;
    });
  };

  const getCountByDuration = (dur: TabKey) => {
    if (dur === "coin") return coinTokens.length;
    return tokens.filter(t => t.duration_type === dur).length;
  };

  const getCountByStatus = (dur: TabKey) => {
    const source = dur === "coin" ? coinTokens : tokens.filter(t => t.duration_type === dur);
    return {
      all: source.length,
      active: source.filter(t => t.status !== "blocked" && !isExpired(t)).length,
      blocked: source.filter(t => t.status === "blocked").length,
      expired: source.filter(t => t.status !== "blocked" && isExpired(t)).length,
    };
  };

  const renderTokenList = (dur: TabKey) => {
    const filtered = getFilteredTokens(dur);
    const sel = selected[dur];
    const counts = getCountByStatus(dur);

    const toggleSelectAll = () => {
      if (sel.size === filtered.length) setSelected(prev => ({ ...prev, [dur]: new Set() }));
      else setSelected(prev => ({ ...prev, [dur]: new Set(filtered.map(t => t.id)) }));
    };

    return (
      <div className="space-y-4">
        {/* Status filter */}
        <div className="flex gap-2 flex-wrap">
          {([
            { key: "all", label: "Semua", icon: null },
            { key: "active", label: "Aktif", icon: "🟢" },
            { key: "blocked", label: "Diblokir", icon: "🔴" },
            { key: "expired", label: "Expired", icon: "🟡" },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => { setStatusFilter(key); setSelected(prev => ({ ...prev, [dur]: new Set() })); }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/50 text-muted-foreground hover:bg-secondary"
              }`}
            >
              {icon && <span>{icon}</span>}
              {label}
              <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                statusFilter === key ? "bg-primary-foreground/20" : "bg-muted"
              }`}>
                {counts[key]}
              </span>
            </button>
          ))}
        </div>

        {/* Search & bulk actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari token..." className="bg-card pl-9" />
          </div>
          {sel.size > 0 && (
            <Button variant="destructive" size="sm" disabled={deleting} onClick={() => deleteTokens(Array.from(sel), dur)}>
              <Trash2 className="mr-1 h-3 w-3" /> Hapus ({sel.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => bulkCopyUncopied(dur)} title="Salin semua token baru">
            <ClipboardList className="mr-1 h-3 w-3" /> Salin Baru
          </Button>
          {lastCopied.length > 0 && (
            <Button variant="secondary" size="sm" onClick={undoLastCopy} title="Batalkan salinan terakhir">
              <RefreshCw className="mr-1 h-3 w-3" /> Batalkan ({lastCopied.length})
            </Button>
          )}
        </div>

        {/* Token list */}
        <div className="space-y-2">
          {filtered.length > 0 && (
            <div className="flex items-center gap-2 px-2">
              <Checkbox checked={sel.size === filtered.length && filtered.length > 0} onCheckedChange={toggleSelectAll} />
              <span className="text-xs text-muted-foreground">Pilih semua</span>
            </div>
          )}

          {filtered.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <Checkbox checked={sel.has(t.id)} onCheckedChange={() => toggleSelect(t.id, dur)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-mono text-sm font-semibold text-foreground truncate">{t.code}</p>
                  {t.is_public && (
                    <span className="flex items-center gap-0.5 rounded-sm bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                      <Globe className="h-2.5 w-2.5" /> PUBLIK
                    </span>
                  )}
                  {copiedTokens.has(t.code) && (
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">✓ tersalin</span>
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
                  {t.duration_type === "custom" && t.expires_at && (
                    <span className="text-[10px] text-muted-foreground">
                      s/d {new Date(t.expires_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                  {(sessions[t.id] || 0) > 0 && (
                    <span className="flex items-center gap-0.5 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                      👤 {sessions[t.id]} aktif
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => copyLink(t.code)}
                  title={copiedTokens.has(t.code) ? "Sudah disalin" : "Copy link"}
                  disabled={copiedTokens.has(t.code)}
                >
                  {copiedTokens.has(t.code) ? <CheckCircle className="h-3 w-3 text-muted-foreground" /> : <Copy className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setExtendToken(t); setExtendDays("30"); }} title="Perpanjang durasi">
                  <Clock className="h-3 w-3 text-primary" />
                </Button>
                {!t.is_public && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => resetSessions(t.id)} title="Reset session">
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => blockToken(t.id)} title={t.status === "blocked" ? "Aktifkan" : "Blokir"}>
                  {t.status === "blocked" ? <CheckCircle className="h-3 w-3 text-[hsl(var(--success))]" /> : <Ban className="h-3 w-3 text-destructive" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled={deleting} onClick={() => deleteTokens([t.id], dur)} title="Hapus">
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Belum ada token</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-foreground">🔑 Token Factory</h2>

      {/* Generate */}
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
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {duration === "custom" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Durasi (hari)</label>
            <Input
              type="number"
              min="1"
              max="365"
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              className="w-24 bg-background"
              placeholder="3"
            />
          </div>
        )}
        {!isPublic && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Max Device</label>
            <Input type="number" min="1" max="9999" value={maxDevices} onChange={(e) => setMaxDevices(e.target.value)} className="w-24 bg-background" />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Jumlah</label>
          <Input type="number" min="1" max="100" value={bulkCount} onChange={(e) => setBulkCount(e.target.value)} className="w-20 bg-background" />
        </div>
        <Button onClick={generateToken} disabled={generating}>
          <Plus className="mr-1 h-4 w-4" /> Generate {parseInt(bulkCount) > 1 ? `${bulkCount} Token` : "Token"}
        </Button>
      </div>

      {isPublic && (
        <p className="text-xs text-muted-foreground">ℹ️ Token publik dapat digunakan oleh banyak user tanpa batas perangkat.</p>
      )}

      {/* Duration Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as TabKey); setStatusFilter("all"); }}>
        <TabsList className="w-full grid grid-cols-5">
          {DURATION_TABS.map(({ key, label, emoji }) => (
            <TabsTrigger key={key} value={key} className="gap-1 text-xs">
              <span>{emoji}</span> {label}
              <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold">{getCountByDuration(key)}</span>
            </TabsTrigger>
          ))}
          <TabsTrigger value="coin" className="gap-1 text-xs">
            <span>🪙</span> Koin
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold">{getCountByDuration("coin")}</span>
          </TabsTrigger>
        </TabsList>
        {DURATION_TABS.map(({ key }) => (
          <TabsContent key={key} value={key} className="mt-4">{renderTokenList(key)}</TabsContent>
        ))}
        <TabsContent value="coin" className="mt-4">{renderTokenList("coin")}</TabsContent>
      </Tabs>
    </div>
  );
};

export default TokenFactory;
