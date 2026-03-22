import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Play, Radio, Film, MonitorPlay, Settings, Shield, Ticket, Menu, Home, User, Coins, Crown } from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type StreamType = "m3u8" | "cloudflare" | "youtube";
type Stream = Tables<"streams">;

const typeIcons: Record<StreamType, React.ReactNode> = {
  m3u8: <Radio className="w-4 h-4" />,
  cloudflare: <Film className="w-4 h-4" />,
  youtube: <MonitorPlay className="w-4 h-4" />,
};

const streamTabs: { type: StreamType; label: string; icon: React.ReactNode; placeholder: string }[] = [
  { type: "m3u8", label: "M3U8 / HLS", icon: <Radio className="w-4 h-4" />, placeholder: "https://example.com/stream.m3u8" },
  { type: "cloudflare", label: "Cloudflare", icon: <Film className="w-4 h-4" />, placeholder: "video-id atau URL lengkap Cloudflare Stream" },
  { type: "youtube", label: "YouTube", icon: <MonitorPlay className="w-4 h-4" />, placeholder: "ID video YouTube atau URL lengkap" },
];

const Index = () => {
  const [activeType, setActiveType] = useState<StreamType>("m3u8");
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState<{ url: string; type: StreamType } | null>(null);
  const [savedStreams, setSavedStreams] = useState<Stream[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const fetchStreams = async () => {
      const { data } = await supabase
        .from("streams")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (data) setSavedStreams(data);
    };
    fetchStreams();
  }, []);

  const handlePlay = () => {
    if (!url.trim()) return;
    setPlaying({ url: url.trim(), type: activeType });
  };

  const handlePlayStream = (stream: Stream) => {
    setPlaying({ url: stream.url, type: stream.type as StreamType });
  };

  const menuItems = [
    { icon: <Home className="h-5 w-5 text-primary" />, label: "Beranda", description: "Halaman utama", href: "/" },
    { icon: <Ticket className="h-5 w-5 text-primary" />, label: "Channel Tersedia", description: `${savedStreams.length} channel aktif`, href: "#channels" },
    { icon: <Settings className="h-5 w-5 text-muted-foreground" />, label: "Admin Panel", description: "Kelola stream & channel", href: "/login" },
  ];

  return (
    <div className="relative min-h-screen bg-background">
      {/* Floating particles */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {Array.from({ length: 20 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute h-1 w-1 rounded-full bg-primary/30"
            style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
            animate={{ y: [0, -30, 0], opacity: [0.15, 0.6, 0.15] }}
            transition={{ duration: 3 + Math.random() * 4, repeat: Infinity, delay: Math.random() * 3 }}
          />
        ))}
      </div>

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shadow-[0_0_8px_hsl(var(--primary)/0.3)]">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-bold text-foreground">Real<span className="text-primary">Time48</span></span>
          </a>
          <div className="flex items-center gap-2">
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
                <div className="mt-4 space-y-2">
                  {menuItems.map((item, i) => (
                    <a
                      key={i}
                      href={item.href}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-background p-4 text-left transition hover:border-primary/30 hover:bg-primary/5"
                    >
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

      {/* Hero Section */}
      <section className="relative flex min-h-[70vh] items-center justify-center overflow-hidden pt-16">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-background to-background" />

        <div className="relative z-10 text-center px-4">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
            <div className="mx-auto mb-6 h-20 w-20 md:h-28 md:w-28 rounded-full bg-primary/15 border-2 border-primary/50 flex items-center justify-center shadow-[0_0_20px_hsl(var(--primary)/0.4)]">
              <Shield className="h-10 w-10 md:h-14 md:w-14 text-primary" />
            </div>
          </motion.div>
          <motion.h1
            className="mb-3 text-4xl font-extrabold tracking-tight text-foreground md:text-6xl"
            style={{ lineHeight: "1.05" }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2 }}
          >
            Real<span className="text-primary">Time48</span>
          </motion.h1>
          <motion.p
            className="mx-auto mb-6 max-w-md text-muted-foreground md:text-lg"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.4 }}
          >
            Secure Streaming Platform — Putar M3U8, Cloudflare Stream & YouTube secara aman.
          </motion.p>
          <motion.div
            className="flex flex-wrap justify-center gap-3"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.6 }}
          >
            <a
              href="#player"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 active:scale-[0.97]"
            >
              <Play className="h-5 w-5 fill-current" /> Mulai Putar
            </a>
            {savedStreams.length > 0 && (
              <a
                href="#channels"
                className="inline-flex items-center gap-2 rounded-full bg-secondary px-8 py-3 font-semibold text-secondary-foreground transition-all hover:bg-secondary/80 active:scale-[0.97]"
              >
                <Ticket className="h-5 w-5" /> Lihat Channel
              </a>
            )}
          </motion.div>
        </div>
      </section>

      {/* Player Section */}
      <section id="player" className="relative z-10 px-4 py-10">
        <div className="mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.6 }}
          >
            <div className="bg-card border border-border rounded-2xl p-6 space-y-5 shadow-xl shadow-black/20">
              {/* Tabs */}
              <div className="flex gap-1 bg-muted rounded-lg p-1">
                {streamTabs.map((tab) => (
                  <button
                    key={tab.type}
                    onClick={() => { setActiveType(tab.type); setPlaying(null); }}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200 active:scale-[0.97] ${
                      activeType === tab.type
                        ? "bg-primary text-primary-foreground shadow-md"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Input */}
              <div className="flex gap-3">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handlePlay()}
                  placeholder={streamTabs.find((t) => t.type === activeType)?.placeholder}
                  className="flex-1 bg-muted border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 transition-shadow"
                />
                <button
                  onClick={handlePlay}
                  disabled={!url.trim()}
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:brightness-110 active:scale-[0.96] transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2 shadow-lg shadow-primary/20"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Putar
                </button>
              </div>
            </div>
          </motion.div>

          {/* Video Player */}
          {playing && (
            <motion.div
              className="mt-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <VideoPlayer url={playing.url} type={playing.type} />
            </motion.div>
          )}
        </div>
      </section>

      {/* Saved Channels */}
      {savedStreams.length > 0 && (
        <section id="channels" className="relative z-10 px-4 py-10">
          <div className="mx-auto max-w-6xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="mb-8 text-center"
            >
              <p className="mb-2 text-sm font-bold uppercase tracking-widest text-primary">Channel Tersedia</p>
              <h2 className="text-3xl font-extrabold text-foreground md:text-4xl">
                Pilih <span className="text-primary">Channel</span> Favoritmu
              </h2>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedStreams.map((stream, i) => (
                <motion.button
                  key={stream.id}
                  onClick={() => handlePlayStream(stream)}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className={`group relative overflow-hidden rounded-2xl border bg-card text-left transition-all hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 active:scale-[0.97] ${
                    playing?.url === stream.url ? "border-primary shadow-lg shadow-primary/10" : "border-border"
                  }`}
                >
                  {/* Card header with gradient */}
                  <div className="relative h-32 overflow-hidden">
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/20 to-accent/10">
                      <div className="text-primary/30">
                        {typeIcons[stream.type as StreamType] ? (
                          <div className="h-12 w-12 flex items-center justify-center">
                            {stream.type === "m3u8" && <Radio className="h-12 w-12" />}
                            {stream.type === "cloudflare" && <Film className="h-12 w-12" />}
                            {stream.type === "youtube" && <MonitorPlay className="h-12 w-12" />}
                          </div>
                        ) : (
                          <Ticket className="h-12 w-12" />
                        )}
                      </div>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />

                    {/* Type badge */}
                    <span className="absolute top-3 left-3 rounded-full bg-primary/20 backdrop-blur-sm px-3 py-1 text-[10px] font-bold text-primary uppercase tracking-wider">
                      {stream.type}
                    </span>

                    {/* Playing indicator */}
                    {playing?.url === stream.url && (
                      <span className="absolute top-3 right-3 rounded-full bg-[hsl(var(--success))] px-2.5 py-1 text-[10px] font-bold text-primary-foreground animate-pulse">
                        LIVE
                      </span>
                    )}

                    <div className="absolute bottom-3 left-4 right-4">
                      <h3 className="text-lg font-bold text-foreground">{stream.title}</h3>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="p-4 pt-2">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 group-hover:bg-primary/20 transition-colors">
                        {typeIcons[stream.type as StreamType] || <Radio className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground truncate">{stream.url}</p>
                      </div>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Empty state */}
      {!playing && savedStreams.length === 0 && (
        <section className="relative z-10 py-16 text-center px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted flex items-center justify-center">
              <Play className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">
              Masukkan URL atau ID lalu tekan <span className="text-primary font-medium">Putar</span>
            </p>
          </motion.div>
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
