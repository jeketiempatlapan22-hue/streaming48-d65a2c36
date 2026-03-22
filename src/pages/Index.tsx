import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Play, Radio, Film, MonitorPlay, Shield, Ticket, Menu, Home, Coins, Calendar, Clock, Users, MessageCircle, Crown, User, Settings } from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import CountdownTimer from "@/components/CountdownTimer";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";

type StreamType = "m3u8" | "cloudflare" | "youtube";
type Stream = Tables<"streams">;

interface Show {
  id: string; title: string; price: string; lineup: string;
  schedule_date: string; schedule_time: string;
  background_image_url: string | null; qris_image_url: string | null;
  coin_price: number; category: string; is_order_closed: boolean;
  is_replay: boolean; replay_coin_price: number; access_password?: string;
  is_subscription: boolean;
}

const CATEGORIES: Record<string, { label: string; color: string }> = {
  regular: { label: "🎭 Reguler", color: "bg-primary/20 text-primary" },
  birthday: { label: "🎂 Ulang Tahun", color: "bg-pink-500/20 text-pink-400" },
  special: { label: "⭐ Spesial", color: "bg-yellow-500/20 text-yellow-400" },
  anniversary: { label: "🎉 Anniversary", color: "bg-purple-500/20 text-purple-400" },
  last_show: { label: "👋 Last Show", color: "bg-red-500/20 text-red-400" },
};

const typeIcons: Record<StreamType, React.ReactNode> = {
  m3u8: <Radio className="w-4 h-4" />, cloudflare: <Film className="w-4 h-4" />, youtube: <MonitorPlay className="w-4 h-4" />,
};

const streamTabs: { type: StreamType; label: string; icon: React.ReactNode; placeholder: string }[] = [
  { type: "m3u8", label: "M3U8 / HLS", icon: <Radio className="w-4 h-4" />, placeholder: "https://example.com/stream.m3u8" },
  { type: "cloudflare", label: "Cloudflare", icon: <Film className="w-4 h-4" />, placeholder: "video-id atau URL Cloudflare" },
  { type: "youtube", label: "YouTube", icon: <MonitorPlay className="w-4 h-4" />, placeholder: "ID video YouTube atau URL" },
];

const Index = () => {
  const [activeType, setActiveType] = useState<StreamType>("m3u8");
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState<{ url: string; type: StreamType } | null>(null);
  const [savedStreams, setSavedStreams] = useState<Stream[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [coinUser, setCoinUser] = useState<any>(null);
  const [coinBalance, setCoinBalance] = useState(0);
  const [coinUsername, setCoinUsername] = useState("");
  const [settings, setSettings] = useState<Record<string, string>>({});

  // Selected show for purchase
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [email, setEmail] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      const [streamRes, showRes, settingsRes] = await Promise.all([
        supabase.from("streams").select("*").eq("is_active", true).order("created_at", { ascending: false }),
        supabase.rpc("get_public_shows"),
        supabase.from("site_settings").select("*"),
      ]);
      if (streamRes.data) setSavedStreams(streamRes.data);
      if (showRes.data) setShows(showRes.data as Show[]);
      if (settingsRes.data) {
        const s: Record<string, string> = {};
        settingsRes.data.forEach((row: any) => { s[row.key] = row.value; });
        setSettings(s);
      }
    };
    fetchData();

    // Check auth
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setCoinUser(session.user);
        const [balRes, profileRes] = await Promise.all([
          supabase.from("coin_balances").select("balance").eq("user_id", session.user.id).maybeSingle(),
          supabase.from("profiles").select("username").eq("id", session.user.id).maybeSingle(),
        ]);
        setCoinBalance(balRes.data?.balance || 0);
        setCoinUsername(profileRes.data?.username || "");
      }
    };
    checkAuth();

    // Realtime
    const showCh = supabase.channel("idx-shows").on("postgres_changes", { event: "*", schema: "public", table: "shows" }, () => {
      supabase.rpc("get_public_shows").then(({ data }) => { if (data) setShows(data as Show[]); });
    }).subscribe();

    return () => { supabase.removeChannel(showCh); };
  }, []);

  const handlePlay = () => { if (!url.trim()) return; setPlaying({ url: url.trim(), type: activeType }); };
  const handlePlayStream = (stream: Stream) => { setPlaying({ url: stream.url, type: stream.type as StreamType }); };

  const handleCoinBuy = async (show: Show) => {
    if (!coinUser) { toast.error("Login terlebih dahulu"); return; }
    const { data, error } = await supabase.rpc("redeem_coins_for_token", { _show_id: show.id });
    const result = data as any;
    if (error || !result?.success) {
      toast.error(result?.error || error?.message || "Gagal menukar koin");
      return;
    }
    toast.success(`Token: ${result.token_code}. Sisa koin: ${result.remaining_balance}`);
    setCoinBalance(result.remaining_balance);
  };

  const handleWhatsAppBuy = (show: Show) => {
    if (!settings.whatsapp_number) { toast.error("Nomor WhatsApp admin belum diset"); return; }
    const msg = encodeURIComponent(
      `🎬 *PESANAN TIKET BARU*\n\n🎭 Show: ${show.title}\n💰 Harga: ${show.price}\n${show.schedule_date ? `📅 Jadwal: ${show.schedule_date} ${show.schedule_time}\n` : ""}📧 Email: ${email}\n\n_Dikirim dari RealTime48_ ✨`
    );
    window.open(`https://wa.me/${settings.whatsapp_number}?text=${msg}`, "_blank");
    setSelectedShow(null);
  };

  const regularShows = shows.filter(s => !s.is_subscription && !s.is_replay);

  const menuItems = [
    { icon: <Home className="h-5 w-5 text-primary" />, label: "Beranda", description: "Halaman utama", href: "/" },
    { icon: <Calendar className="h-5 w-5 text-primary" />, label: "Jadwal Show", description: "Lihat jadwal & countdown", href: "/schedule" },
    { icon: <Coins className="h-5 w-5 text-[hsl(var(--warning))]" />, label: "Coin Shop", description: "Beli koin untuk akses show", href: "/coins" },
    { icon: <Film className="h-5 w-5 text-primary" />, label: "Replay Show", description: "Tonton ulang show lalu", href: "/schedule" },
    ...(coinUser ? [{ icon: <User className="h-5 w-5 text-primary" />, label: "Profil Saya", description: "Token, koin & pengaturan", href: "/profile" }] : []),
    { icon: <Settings className="h-5 w-5 text-muted-foreground" />, label: "Admin", description: "Panel admin", href: "/admin" },
  ];

  return (
    <div className="relative min-h-screen bg-background">
      {/* Particles */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {Array.from({ length: 20 }).map((_, i) => (
          <motion.div key={i} className="absolute h-1 w-1 rounded-full bg-primary/30"
            style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
            animate={{ y: [0, -30, 0], opacity: [0.15, 0.6, 0.15] }}
            transition={{ duration: 3 + Math.random() * 4, repeat: Infinity, delay: Math.random() * 3 }} />
        ))}
      </div>

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shadow-[0_0_8px_hsl(var(--primary)/0.3)]">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-bold">Real<span className="text-primary">Time48</span></span>
          </a>
          <div className="flex items-center gap-2">
            {coinUser && (
              <div className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5">
                <Coins className="h-4 w-4 text-[hsl(var(--warning))]" />
                <span className="text-sm font-bold text-[hsl(var(--warning))]">{coinBalance}</span>
              </div>
            )}
            {!sheetOpen && (
              <a href="/coins" className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5 text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))]/20 transition">
                <Coins className="h-4 w-4" />
                <span className="text-xs font-semibold">Beli Koin</span>
              </a>
            )}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <button className="rounded-lg bg-secondary p-2 text-secondary-foreground transition hover:bg-secondary/80 active:scale-[0.95]">
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 border-border bg-card">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-foreground">
                    <div className="h-6 w-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                      <Shield className="h-3 w-3 text-primary" />
                    </div>
                    RealTime48
                  </SheetTitle>
                </SheetHeader>

                {coinUser ? (
                  <div className="mt-4 rounded-xl border border-border bg-background p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{coinUsername || "User"}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Coins className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />
                          <span className="text-xs font-bold text-[hsl(var(--warning))]">{coinBalance} Koin</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <a href="/coins" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-2 text-xs font-semibold text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))]/20 transition">
                        <Coins className="h-3.5 w-3.5" /> Coin Shop
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-border bg-background p-4">
                    <a href="/auth" className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition">
                      <User className="h-4 w-4" /> Login / Daftar
                    </a>
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  {menuItems.map((item, i) => (
                    <a key={i} href={item.href}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-background p-4 text-left transition hover:border-primary/30 hover:bg-primary/5">
                      <div className="mt-0.5 shrink-0">{item.icon}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{item.label}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative flex min-h-[70vh] items-center justify-center overflow-hidden pt-16">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-background to-background" />
        <div className="relative z-10 text-center px-4">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
            <div className="mx-auto mb-6 h-20 w-20 md:h-28 md:w-28 rounded-full bg-primary/15 border-2 border-primary/50 flex items-center justify-center shadow-[0_0_20px_hsl(var(--primary)/0.4)] animate-float">
              <Shield className="h-10 w-10 md:h-14 md:w-14 text-primary" />
            </div>
          </motion.div>
          <motion.h1 className="mb-3 text-4xl font-extrabold tracking-tight text-foreground md:text-6xl" style={{ lineHeight: "1.05" }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2 }}>
            Real<span className="text-primary">Time48</span>
          </motion.h1>
          <motion.p className="mx-auto mb-6 max-w-md text-muted-foreground md:text-lg"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.4 }}>
            {settings.site_title || "Secure Streaming Platform"}
          </motion.p>
          <motion.div className="flex flex-wrap justify-center gap-3"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.6 }}>
            <a href="#shows" className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 active:scale-[0.97] transition-all">
              <Ticket className="h-5 w-5" /> Lihat Show
            </a>
            <a href="#player" className="inline-flex items-center gap-2 rounded-full bg-secondary px-8 py-3 font-semibold text-secondary-foreground hover:bg-secondary/80 active:scale-[0.97] transition-all">
              <Play className="h-5 w-5" /> Putar Manual
            </a>
          </motion.div>
        </div>
      </section>

      {/* Announcement */}
      {settings.announcement_enabled === "true" && settings.announcement_text && (
        <section className="px-4 py-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-4xl rounded-2xl border border-[hsl(var(--warning))]/30 bg-gradient-to-r from-[hsl(var(--warning))]/10 via-[hsl(var(--warning))]/5 to-primary/10 p-5">
            <h3 className="mb-1.5 text-sm font-bold text-foreground">📢 Pengumuman</h3>
            <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-line">{settings.announcement_text}</p>
          </motion.div>
        </section>
      )}

      {/* Shows */}
      {regularShows.length > 0 && (
        <section id="shows" className="relative z-10 px-4 py-10">
          <div className="mx-auto max-w-6xl">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="mb-8 text-center">
              <p className="mb-2 text-sm font-bold uppercase tracking-widest text-primary">Tiket Show</p>
              <h2 className="text-3xl font-extrabold text-foreground md:text-4xl">
                Beli <span className="text-primary">Tiket</span> Sekarang
              </h2>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {regularShows.map((show, i) => (
                <motion.div key={show.id}
                  initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5">
                  {/* Image */}
                  <div className="relative h-48 overflow-hidden">
                    {show.background_image_url ? (
                      <img src={show.background_image_url} alt={show.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/20 to-accent/10">
                        <Ticket className="h-16 w-16 text-primary/30" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />
                    {show.category && show.category !== "regular" && (
                      <span className={`absolute top-3 left-3 rounded-full px-3 py-1 text-[10px] font-bold backdrop-blur-sm ${CATEGORIES[show.category]?.color || ""}`}>
                        {CATEGORIES[show.category]?.label}
                      </span>
                    )}
                    <div className="absolute bottom-3 left-4 right-4">
                      <h3 className="text-xl font-bold text-foreground">{show.title}</h3>
                    </div>
                  </div>

                  <div className="space-y-3 p-4">
                    {show.coin_price > 0 && (
                      <div className="flex items-center gap-1.5 text-sm text-[hsl(var(--warning))]">
                        <Coins className="h-4 w-4" />
                        <span className="font-semibold">{show.coin_price} Koin</span>
                      </div>
                    )}
                    <span className="rounded-full bg-muted px-3 py-1 text-sm font-bold text-muted-foreground">{show.price}</span>
                    {show.schedule_date && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4 text-primary" />{show.schedule_date}
                      </div>
                    )}
                    {show.schedule_time && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4 text-primary" />{show.schedule_time}
                      </div>
                    )}
                    {show.lineup && (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Users className="mt-0.5 h-4 w-4 text-primary" />
                        <span className="line-clamp-2">{show.lineup}</span>
                      </div>
                    )}

                    <div className="mt-2 flex flex-col gap-2">
                      {show.coin_price > 0 && (
                        <button onClick={() => handleCoinBuy(show)}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--warning))] py-3 font-semibold text-primary-foreground hover:bg-[hsl(var(--warning))]/90 hover:shadow-lg active:scale-[0.97] transition-all">
                          <Coins className="h-4 w-4" /> Beli dengan {show.coin_price} Koin
                        </button>
                      )}
                      <button onClick={() => setSelectedShow(show)}
                        className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 font-semibold transition-all active:scale-[0.97] ${
                          show.coin_price > 0
                            ? "bg-muted text-muted-foreground hover:bg-muted/80"
                            : "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25"
                        }`}>
                        <MessageCircle className="h-4 w-4" /> {show.coin_price > 0 ? "Beli via QRIS" : "Beli Tiket"}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Purchase Modal */}
      {selectedShow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6">
            <h3 className="mb-1 text-lg font-bold">{selectedShow.title}</h3>
            <p className="mb-4 text-sm text-muted-foreground">{selectedShow.price}</p>

            {selectedShow.qris_image_url ? (
              <img src={selectedShow.qris_image_url} alt="QRIS" className="mx-auto w-full max-w-sm rounded-lg mb-4" />
            ) : (
              <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground mb-4">QRIS belum tersedia</div>
            )}

            <div className="space-y-3 mb-4">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email Anda"
                className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50" />
            </div>

            <button onClick={() => handleWhatsAppBuy(selectedShow)} disabled={!email.trim()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--success))] py-3 font-semibold text-primary-foreground hover:bg-[hsl(var(--success))]/90 active:scale-[0.97] transition-all disabled:opacity-40">
              <MessageCircle className="h-4 w-4" /> Kirim Pesanan via WhatsApp
            </button>
            <p className="text-[10px] text-center text-muted-foreground mt-2">
              * Anda akan diarahkan ke WhatsApp untuk mengirim pesanan ke admin
            </p>

            <button onClick={() => setSelectedShow(null)}
              className="mt-3 w-full rounded-xl bg-secondary py-3 text-sm font-medium text-secondary-foreground hover:bg-secondary/80">
              Tutup
            </button>
          </motion.div>
        </div>
      )}

      {/* Player Section */}
      <section id="player" className="relative z-10 px-4 py-10">
        <div className="mx-auto max-w-4xl">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 0.6 }}>
            <div className="bg-card border border-border rounded-2xl p-6 space-y-5 shadow-xl shadow-black/20">
              <div className="flex gap-1 bg-muted rounded-lg p-1">
                {streamTabs.map((tab) => (
                  <button key={tab.type} onClick={() => { setActiveType(tab.type); setPlaying(null); }}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200 active:scale-[0.97] ${
                      activeType === tab.type ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground"}`}>
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePlay()}
                  placeholder={streamTabs.find((t) => t.type === activeType)?.placeholder}
                  className="flex-1 bg-muted border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow" />
                <button onClick={handlePlay} disabled={!url.trim()}
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:brightness-110 active:scale-[0.96] transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2 shadow-lg shadow-primary/20">
                  <Play className="w-4 h-4 fill-current" /> Putar
                </button>
              </div>
            </div>
          </motion.div>

          {playing && (
            <motion.div className="mt-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <VideoPlayer url={playing.url} type={playing.type} />
            </motion.div>
          )}
        </div>
      </section>

      {/* Channels */}
      {savedStreams.length > 0 && (
        <section id="channels" className="relative z-10 px-4 py-10">
          <div className="mx-auto max-w-6xl">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-8 text-center">
              <p className="mb-2 text-sm font-bold uppercase tracking-widest text-primary">Channel Tersedia</p>
              <h2 className="text-3xl font-extrabold text-foreground md:text-4xl">Pilih <span className="text-primary">Channel</span></h2>
            </motion.div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedStreams.map((stream, i) => (
                <motion.button key={stream.id} onClick={() => handlePlayStream(stream)}
                  initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className={`group relative overflow-hidden rounded-2xl border bg-card text-left transition-all hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 active:scale-[0.97] ${
                    playing?.url === stream.url ? "border-primary shadow-lg shadow-primary/10" : "border-border"}`}>
                  <div className="relative h-32 overflow-hidden">
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/20 to-accent/10">
                      {stream.type === "m3u8" && <Radio className="h-12 w-12 text-primary/30" />}
                      {stream.type === "cloudflare" && <Film className="h-12 w-12 text-primary/30" />}
                      {stream.type === "youtube" && <MonitorPlay className="h-12 w-12 text-primary/30" />}
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />
                    <span className="absolute top-3 left-3 rounded-full bg-primary/20 backdrop-blur-sm px-3 py-1 text-[10px] font-bold text-primary uppercase tracking-wider">{stream.type}</span>
                    {playing?.url === stream.url && (
                      <span className="absolute top-3 right-3 rounded-full bg-[hsl(var(--success))] px-2.5 py-1 text-[10px] font-bold text-primary-foreground animate-pulse">LIVE</span>
                    )}
                    <div className="absolute bottom-3 left-4"><h3 className="text-lg font-bold text-foreground">{stream.title}</h3></div>
                  </div>
                  <div className="p-4 pt-2">
                    <p className="text-xs text-muted-foreground truncate">{stream.url}</p>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="relative z-10 border-t border-border mt-auto">
        <div className="mx-auto max-w-6xl px-4 py-4 text-center text-xs text-muted-foreground">
          RealTime48 — Secure Streaming Platform
        </div>
      </footer>
    </div>
  );
};

export default Index;
