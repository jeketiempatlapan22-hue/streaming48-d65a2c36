import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Copy, RefreshCw, Search, MessageCircle, Hash, Ticket, Zap, BarChart3 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ResellerShowCard from "./ResellerShowCard";
import type { ResellerSession } from "@/pages/ResellerPage";

interface Props {
  session: ResellerSession;
  onLogout: () => void;
}

const LIVE_BASE = "https://realtime48stream.my.id/live";

const ResellerDashboard = ({ session, onLogout }: Props) => {
  const [shows, setShows] = useState<any[]>([]);
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"shows" | "tokens">("shows");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired" | "blocked">("all");
  const [resetTarget, setResetTarget] = useState<any | null>(null);
  const [resetting, setResetting] = useState(false);
  const { toast } = useToast();

  const loadShows = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("reseller_get_active_shows", { _session_token: session.session_token });
      if (error) {
        toast({ title: "Gagal memuat show", description: error.message, variant: "destructive" });
        return;
      }
      const res = data as any;
      if (res?.success) setShows(res.shows || []);
      else if (res?.error) toast({ title: "Gagal memuat show", description: res.error, variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Gagal memuat show", description: e?.message || "Network error", variant: "destructive" });
    }
  }, [session.session_token, toast]);

  const loadTokens = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("reseller_list_my_tokens", { _session_token: session.session_token, _limit: 200 });
      if (error) return;
      const res = data as any;
      if (res?.success) setTokens(res.tokens || []);
    } catch { /* noop */ }
  }, [session.session_token]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadShows(), loadTokens()]);
    setLoading(false);
  }, [loadShows, loadTokens]);

  useEffect(() => {
    refresh();
    // Realtime: if admin deletes any token I own, refresh list
    const channel = supabase
      .channel("reseller-tokens-" + session.reseller_id)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tokens", filter: `reseller_id=eq.${session.reseller_id}` },
        () => { loadTokens(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh, loadTokens, session.reseller_id]);

  const handleLogout = async () => {
    try { await supabase.rpc("reseller_logout", { _session_token: session.session_token }); } catch { /* noop */ }
    onLogout();
  };

  const copyLink = async (code: string) => {
    try {
      await navigator.clipboard.writeText(`${LIVE_BASE}?t=${code}`);
      toast({ title: "Tersalin!", description: code });
    } catch {
      toast({ title: "Gagal menyalin", variant: "destructive" });
    }
  };

  const handleConfirmReset = async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const { data, error } = await supabase.rpc("reseller_reset_token_sessions", {
        _session_token: session.session_token,
        _input: resetTarget.code,
      });
      if (error) {
        toast({ title: "Gagal reset", description: error.message, variant: "destructive" });
        return;
      }
      const res = data as any;
      if (!res?.success) {
        const msg = res?.error || "Tidak diketahui";
        const isNotFound = /tidak ditemukan|bukan milik/i.test(msg);
        toast({
          title: isNotFound ? "Token tidak ditemukan" : "Gagal reset",
          description: msg,
          variant: "destructive",
        });
        return;
      }
      // Broadcast force-logout to active devices on this token (wait for SUBSCRIBED before send)
      try {
        const ch = supabase.channel(`token-reset-${resetTarget.id}`, {
          config: { broadcast: { ack: false, self: false } },
        });
        await new Promise<void>((resolve) => {
          let done = false;
          const timer = setTimeout(() => { if (!done) { done = true; resolve(); } }, 2500);
          ch.subscribe((status) => {
            if (status === "SUBSCRIBED" && !done) {
              done = true;
              clearTimeout(timer);
              resolve();
            }
          });
        });
        await ch.send({ type: "broadcast", event: "force_logout", payload: { token_id: resetTarget.id } });
        supabase.removeChannel(ch);
      } catch { /* noop */ }
      const deleted = res.deleted_count || 0;
      toast({
        title: deleted > 0 ? `✅ ${deleted} sesi berhasil dihapus` : "Tidak ada sesi aktif",
        description: deleted > 0
          ? `Token ${res.token_code} — perangkat aktif telah dikeluarkan paksa.`
          : `Token ${res.token_code} tidak memiliki sesi aktif untuk dihapus.`,
      });
      setResetTarget(null);
      // Refresh token list to reflect any state change
      loadTokens();
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Gagal reset sesi", variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  // Reseller tidak boleh membuat token untuk show bundle
  const filteredShows = shows
    .filter((s) => !s.is_bundle)
    .filter((s) =>
      !search || s.title?.toLowerCase().includes(search.toLowerCase()) || s.short_id?.toLowerCase().includes(search.toLowerCase())
    );
  const isExpired = (t: any) => t.expires_at && new Date(t.expires_at).getTime() < Date.now();

  const filteredTokens = tokens
    .filter((t) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "expired") return isExpired(t);
      if (statusFilter === "blocked") return t.status === "blocked";
      // active
      return t.status === "active" && !isExpired(t);
    })
    .filter((t) =>
      !search || t.code?.toLowerCase().includes(search.toLowerCase()) || t.show_title?.toLowerCase().includes(search.toLowerCase())
    );

  const tokenCounts = useMemo(() => {
    let active = 0, expired = 0, blocked = 0;
    for (const t of tokens) {
      if (t.status === "blocked") blocked++;
      else if (isExpired(t)) expired++;
      else if (t.status === "active") active++;
    }
    return { all: tokens.length, active, expired, blocked };
  }, [tokens]);

  // Aggregate per-show stats from local tokens (no extra request)
  const perShowStats = useMemo(() => {
    const map = new Map<string, { show_id: string | null; show_title: string; total: number; active: number }>();
    for (const t of tokens) {
      const key = t.show_id || "_none";
      const cur = map.get(key) || { show_id: t.show_id || null, show_title: t.show_title || "—", total: 0, active: 0 };
      cur.total += 1;
      if (t.status === "active" && !isExpired(t)) cur.active += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [tokens]);

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-black font-heading text-foreground truncate">
              Reseller <span className="neon-text">Panel</span>
            </h1>
            <p className="text-[10px] text-muted-foreground truncate">
              {session.name} • {session.phone} • Prefix: <span className="font-mono text-primary">/{session.prefix}token</span>
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={refresh} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Keluar">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-w-5xl mx-auto px-3 sm:px-4 pb-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border bg-background/50 p-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">Total Token</p>
            <p className="text-lg font-bold text-foreground">{tokens.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-background/50 p-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">Aktif</p>
            <p className="text-lg font-bold text-green-400">{tokens.filter((t) => t.status === "active" && !isExpired(t)).length}</p>
          </div>
          <div className="rounded-lg border border-border bg-background/50 p-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">Show Aktif</p>
            <p className="text-lg font-bold text-cyan-400">{shows.length}</p>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-3 sm:px-4 pb-3 flex gap-2">
          <Button size="sm" variant={tab === "shows" ? "default" : "outline"} onClick={() => setTab("shows")} className="flex-1">
            <Hash className="h-3.5 w-3.5 mr-1" /> Show ({shows.length})
          </Button>
          <Button size="sm" variant={tab === "tokens" ? "default" : "outline"} onClick={() => setTab("tokens")} className="flex-1">
            <Ticket className="h-3.5 w-3.5 mr-1" /> Token ({tokens.length})
          </Button>
        </div>
        <div className="max-w-5xl mx-auto px-3 sm:px-4 pb-3 relative">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={tab === "shows" ? "Cari show..." : "Cari token..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-card animate-pulse border border-border" />
            ))}
          </div>
        ) : tab === "shows" ? (
          filteredShows.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Tidak ada show aktif.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {filteredShows.map((show) => (
                <ResellerShowCard
                  key={show.id}
                  show={show}
                  sessionToken={session.session_token}
                  onTokenCreated={loadTokens}
                />
              ))}
            </div>
          )
        ) : (
          <>
            {/* Per-show stats panel */}
            {perShowStats.length > 0 && (
              <div className="mb-4 rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-xs font-bold text-foreground uppercase">Statistik Per Show</h3>
                </div>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {perShowStats.map((s) => (
                    <div key={s.show_id || "none"} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-background/50 text-xs">
                      <span className="truncate text-foreground">{s.show_title}</span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        <span className="text-foreground font-bold">{s.total}</span> token
                        {" · "}
                        <span className="text-green-400 font-bold">{s.active}</span> aktif
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Filter chips status token */}
            <div className="mb-3 flex gap-1.5 flex-wrap">
              {([
                { key: "all", label: "Semua", count: tokenCounts.all },
                { key: "active", label: "Aktif", count: tokenCounts.active },
                { key: "expired", label: "Expired", count: tokenCounts.expired },
                { key: "blocked", label: "Blokir", count: tokenCounts.blocked },
              ] as const).map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={statusFilter === f.key ? "default" : "outline"}
                  className="h-7 px-2.5 text-[11px]"
                  onClick={() => setStatusFilter(f.key)}
                >
                  {f.label} <span className="ml-1 opacity-70">({f.count})</span>
                </Button>
              ))}
            </div>

            {filteredTokens.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {tokens.length === 0
                  ? "Belum ada token. Buat token baru di tab Show."
                  : search
                    ? `Tidak ada token cocok dengan "${search}".`
                    : "Tidak ada token pada filter ini."}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTokens.map((t) => {
                  const expired = isExpired(t);
                  const blocked = t.status === "blocked";
                  return (
                    <div key={t.id} className="rounded-lg border border-border bg-card p-3 flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="font-mono text-xs bg-background/60 px-2 py-1 rounded">{t.code}</code>
                          {expired ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">Expired</span>
                          ) : blocked ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">Blokir</span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">Aktif</span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {t.show_title || "—"} • {t.max_devices} device • exp: {t.expires_at ? new Date(t.expires_at).toLocaleString("id-ID") : "—"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => copyLink(t.code)}>
                          <Copy className="h-3.5 w-3.5 mr-1" /> Salin
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setResetTarget(t)}
                          title="Reset semua sesi aktif token ini"
                        >
                          <Zap className="h-3.5 w-3.5 mr-1" /> Reset
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        <div className="mt-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className="h-4 w-4 text-green-400" />
            <h3 className="text-sm font-bold text-foreground">Command WhatsApp Anda</h3>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Anda juga dapat membuat & mengelola token via WhatsApp dengan command berikut:
          </p>
          <div className="space-y-1.5">
            <code className="block bg-background/60 p-2 rounded font-mono text-xs break-all">
              /{session.prefix}token &lt;nama show / #shortid&gt; [hari] [maxdevice]
            </code>
            <code className="block bg-background/60 p-2 rounded font-mono text-xs break-all">
              /{session.prefix}reset &lt;4digit token&gt;
            </code>
            <code className="block bg-background/60 p-2 rounded font-mono text-xs break-all">
              /{session.prefix}stats
            </code>
            <code className="block bg-background/60 p-2 rounded font-mono text-xs break-all">
              /{session.prefix}mytokens
            </code>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Contoh reset: <code className="font-mono">/{session.prefix}reset AB12</code>
          </p>
        </div>
      </main>

      {/* Reset confirmation dialog */}
      <AlertDialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset sesi token?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua perangkat aktif yang sedang menggunakan token{" "}
              <code className="font-mono">{resetTarget?.code}</code> akan dikeluarkan paksa.
              Pengguna harus login ulang untuk menonton.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmReset} disabled={resetting}>
              {resetting ? "Mereset..." : "Reset Sekarang"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ResellerDashboard;
