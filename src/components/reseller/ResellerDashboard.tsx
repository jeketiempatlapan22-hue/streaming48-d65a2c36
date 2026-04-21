import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { LogOut, Copy, RefreshCw, Search, MessageCircle, Hash, Ticket } from "lucide-react";
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
  const { toast } = useToast();

  const loadShows = useCallback(async () => {
    const { data } = await supabase.rpc("reseller_get_active_shows", { _session_token: session.session_token });
    const res = data as any;
    if (res?.success) setShows(res.shows || []);
    else if (res?.error) toast({ title: "Gagal memuat show", description: res.error, variant: "destructive" });
  }, [session.session_token, toast]);

  const loadTokens = useCallback(async () => {
    const { data } = await supabase.rpc("reseller_list_my_tokens", { _session_token: session.session_token, _limit: 200 });
    const res = data as any;
    if (res?.success) setTokens(res.tokens || []);
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

  const filteredShows = shows.filter((s) =>
    !search || s.title?.toLowerCase().includes(search.toLowerCase()) || s.short_id?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredTokens = tokens.filter((t) =>
    !search || t.code?.toLowerCase().includes(search.toLowerCase()) || t.show_title?.toLowerCase().includes(search.toLowerCase())
  );

  const isExpired = (t: any) => t.expires_at && new Date(t.expires_at).getTime() < Date.now();

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
          filteredTokens.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Belum ada token. Buat token baru di tab Show.
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
                    <Button size="sm" variant="outline" onClick={() => copyLink(t.code)}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Salin
                    </Button>
                  </div>
                );
              })}
            </div>
          )
        )}

        <div className="mt-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className="h-4 w-4 text-green-400" />
            <h3 className="text-sm font-bold text-foreground">Command WhatsApp Anda</h3>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Anda juga dapat membuat token via WhatsApp dengan mengirim command berikut ke nomor admin bot:
          </p>
          <code className="block bg-background/60 p-2 rounded font-mono text-xs break-all">
            /{session.prefix}token &lt;nama show / #shortid&gt; [hari] [maxdevice]
          </code>
          <p className="text-[10px] text-muted-foreground mt-2">
            Contoh: <code className="font-mono">/{session.prefix}token #abc123 7 1</code>
          </p>
        </div>
      </main>
    </div>
  );
};

export default ResellerDashboard;
