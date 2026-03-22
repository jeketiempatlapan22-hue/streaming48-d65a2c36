import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import SharedNavbar from "@/components/SharedNavbar";
import { Search, Calendar, Clock, Users, Coins, Play, Copy, Ticket } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Show } from "@/types/show";

const SHOW_CATEGORIES: Record<string, { label: string; color: string }> = {
  regular: { label: "🎭 Reguler", color: "bg-primary/20 text-primary" },
  birthday: { label: "🎂 Ulang Tahun", color: "bg-pink-500/20 text-pink-400" },
  special: { label: "⭐ Spesial", color: "bg-yellow-500/20 text-yellow-400" },
  anniversary: { label: "🎉 Anniversary", color: "bg-purple-500/20 text-purple-400" },
  last_show: { label: "👋 Last Show", color: "bg-red-500/20 text-red-400" },
};

const isShowPast4Hours = (show: Show) => {
  if (!show.schedule_date || !show.schedule_time) return false;
  try {
    const timeStr = show.schedule_time.replace(/\s*WIB\s*/i, "").trim();
    const showDate = new Date(`${show.schedule_date} ${timeStr}`);
    if (isNaN(showDate.getTime())) return false;
    return new Date() > new Date(showDate.getTime() + 4 * 60 * 60 * 1000);
  } catch { return false; }
};

const isShowPastSchedule = (show: Show) => {
  if (!show.schedule_date || !show.schedule_time) return false;
  try {
    const timeStr = show.schedule_time.replace(/\s*WIB\s*/i, "").trim();
    const showDate = new Date(`${show.schedule_date} ${timeStr}`);
    if (isNaN(showDate.getTime())) return false;
    return new Date() > showDate;
  } catch { return false; }
};

const ReplayPage = () => {
  const { toast } = useToast();
  const [shows, setShows] = useState<Show[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [coinUser, setCoinUser] = useState<any>(null);
  const [coinBalance, setCoinBalance] = useState(0);
  const [replayTarget, setReplayTarget] = useState<Show | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [replayPasswords, setReplayPasswords] = useState<Record<string, string>>({});
  const [replayResult, setReplayResult] = useState<{ replay_password: string; remaining_balance: number } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const [showsRes, streamRes] = await Promise.all([
        supabase.rpc("get_public_shows"),
        supabase.from("streams").select("is_live").limit(1).single(),
      ]);
      const streamLive = streamRes.data?.is_live ?? true;
      if (showsRes.data) {
        const pastShows = (showsRes.data as any[]).filter((s) => {
          if (s.is_subscription || s.replay_coin_price <= 0) return false;
          if (s.is_replay) return true;
          if (isShowPast4Hours(s)) return true;
          if (!streamLive && isShowPastSchedule(s)) return true;
          return false;
        });
        pastShows.sort((a, b) => {
          const dateA = a.schedule_date ? new Date(a.schedule_date).getTime() : 0;
          const dateB = b.schedule_date ? new Date(b.schedule_date).getTime() : 0;
          return dateB - dateA;
        });
        setShows(pastShows as Show[]);
      }
    };
    fetchData();

    const fetchUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setCoinUser(session.user);
        const { data: bal } = await supabase.from("coin_balances").select("balance").eq("user_id", session.user.id).maybeSingle();
        setCoinBalance(bal?.balance || 0);
        try { setReplayPasswords(JSON.parse(localStorage.getItem(`replay_passwords_${session.user.id}`) || "{}")); } catch {}
      }
    };
    fetchUser();

    const showCh = supabase.channel("replay-shows").on("postgres_changes", { event: "*", schema: "public", table: "shows" }, () => fetchData()).subscribe();
    return () => { supabase.removeChannel(showCh); };
  }, []);

  const handleReplayRedeem = async () => {
    if (!replayTarget || !coinUser) return;
    setRedeeming(true);
    const { data, error } = await supabase.rpc("redeem_coins_for_token", { _show_id: replayTarget.id });
    setRedeeming(false);
    const result = data as any;
    if (error || !result?.success) {
      toast({ title: "Gagal menukar koin", description: result?.error || error?.message, variant: "destructive" });
      return;
    }
    const pw = result.access_password || "";
    setReplayResult({ replay_password: pw, remaining_balance: result.remaining_balance });
    setCoinBalance(result.remaining_balance);
    const stored = JSON.parse(localStorage.getItem(`replay_passwords_${coinUser.id}`) || "{}");
    stored[replayTarget.id] = pw;
    localStorage.setItem(`replay_passwords_${coinUser.id}`, JSON.stringify(stored));
    setReplayPasswords(prev => ({ ...prev, [replayTarget.id]: pw }));
  };

  const filteredShows = shows.filter((s) => {
    const q = searchQuery.toLowerCase();
    return s.title.toLowerCase().includes(q) || (s.schedule_date || "").toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <div className="mx-auto max-w-6xl px-4 pt-20 pb-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold text-foreground">🎬 Replay Show</h1>
          <p className="mt-2 text-sm text-muted-foreground">Tonton ulang show yang sudah berlangsung</p>
        </motion.div>

        <div className="relative mx-auto mb-8 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari nama show atau tanggal..." className="bg-card pl-10" />
        </div>

        {coinUser && (
          <div className="mx-auto mb-6 flex max-w-md items-center justify-between rounded-xl border border-border bg-card p-3">
            <span className="text-sm text-muted-foreground">Saldo Koin</span>
            <span className="flex items-center gap-1.5 font-bold text-primary"><Coins className="h-4 w-4" /> {coinBalance} Koin</span>
          </div>
        )}

        {filteredShows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-12 text-center">
            <Ticket className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium text-foreground">Belum ada replay tersedia</p>
            <p className="mt-2 text-sm text-muted-foreground">Show yang sudah selesai akan muncul di sini</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredShows.map((show, i) => {
              const hasPassword = !!replayPasswords[show.id];
              return (
                <motion.div key={show.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5">
                  <div className="relative h-44 overflow-hidden">
                    {show.background_image_url ? (
                      <img src={show.background_image_url} alt={show.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/20 to-accent/10"><Play className="h-16 w-16 text-primary/30" /></div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />
                    {show.category && show.category !== "regular" && (() => {
                      const cat = SHOW_CATEGORIES[show.category] || SHOW_CATEGORIES.regular;
                      return <span className={`absolute top-3 left-3 rounded-full px-3 py-1 text-[10px] font-bold backdrop-blur-sm ${cat.color}`}>{cat.label}</span>;
                    })()}
                    <span className="absolute top-3 right-3 rounded-full bg-accent/80 px-2.5 py-1 text-[10px] font-bold text-accent-foreground backdrop-blur-sm">REPLAY</span>
                    <div className="absolute bottom-3 left-4 right-4"><h3 className="text-lg font-bold text-foreground">{show.title}</h3></div>
                  </div>
                  <div className="space-y-2.5 p-4">
                    {show.schedule_date && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 text-primary" />{show.schedule_date}
                        {show.schedule_time && <><Clock className="ml-2 h-3.5 w-3.5 text-primary" />{show.schedule_time}</>}
                      </div>
                    )}
                    {show.lineup && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Users className="mt-0.5 h-3.5 w-3.5 text-primary" /><span className="line-clamp-2">{show.lineup}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-sm text-primary"><Coins className="h-4 w-4" /><span className="font-semibold">{show.replay_coin_price} Koin</span></div>
                    {hasPassword ? (
                      <div className="space-y-2">
                        <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-center">
                          <p className="text-[10px] font-medium text-muted-foreground mb-1">🔐 Sandi Replay</p>
                          <p className="font-mono text-lg font-bold text-primary">{replayPasswords[show.id]}</p>
                        </div>
                        <button onClick={() => { navigator.clipboard.writeText(replayPasswords[show.id]); toast({ title: "Sandi disalin!" }); }}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-accent-foreground transition-all hover:bg-accent/90">
                          <Copy className="h-4 w-4" /> Salin Sandi Replay
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => { if (!coinUser) { toast({ title: "Login terlebih dahulu", variant: "destructive" }); return; } setReplayTarget(show); setReplayResult(null); }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition-all hover:bg-primary/90">
                        <Coins className="h-4 w-4" /> Beli Replay {show.replay_coin_price} Koin
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!replayTarget} onOpenChange={() => { setReplayTarget(null); setReplayResult(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>🎬 Beli Replay</DialogTitle>
            <DialogDescription>{replayTarget?.title}</DialogDescription>
          </DialogHeader>
          {!replayResult ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Harga</span><span className="font-bold text-primary">{replayTarget?.replay_coin_price} Koin</span></div>
                <div className="flex items-center justify-between text-sm border-t border-border pt-2"><span className="text-muted-foreground">Saldo</span><span className={`font-bold ${coinBalance >= (replayTarget?.replay_coin_price || 0) ? "text-[hsl(var(--success))]" : "text-destructive"}`}>{coinBalance} Koin</span></div>
              </div>
              {coinBalance < (replayTarget?.replay_coin_price || 0) ? (
                <div className="space-y-3">
                  <p className="text-center text-sm text-destructive">Koin tidak cukup.</p>
                  <Button onClick={() => { setReplayTarget(null); window.location.href = "/coins"; }} className="w-full">Beli Koin</Button>
                </div>
              ) : (
                <Button className="w-full gap-2" onClick={handleReplayRedeem} disabled={redeeming}><Coins className="h-4 w-4" />{redeeming ? "Memproses..." : "Tukar Koin"}</Button>
              )}
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
                <p className="text-xs text-muted-foreground mb-1">🔐 Sandi Replay</p>
                <p className="font-mono text-2xl font-bold text-primary">{replayResult.replay_password || "—"}</p>
              </div>
              <p className="text-sm text-muted-foreground">Sisa saldo: {replayResult.remaining_balance} Koin</p>
              <Button variant="outline" className="w-full" onClick={() => { navigator.clipboard.writeText(replayResult.replay_password); toast({ title: "Sandi disalin!" }); }}>
                <Copy className="mr-2 h-4 w-4" /> Salin Sandi
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReplayPage;
