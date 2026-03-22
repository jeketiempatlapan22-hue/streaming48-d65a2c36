import { useState, useEffect } from "react";
import { Play, Radio, Film, MonitorPlay, Settings, Shield } from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type StreamType = "m3u8" | "cloudflare" | "youtube";
type Stream = Tables<"streams">;

const streamTabs: { type: StreamType; label: string; icon: React.ReactNode; placeholder: string }[] = [
  { type: "m3u8", label: "M3U8 / HLS", icon: <Radio className="w-4 h-4" />, placeholder: "https://example.com/stream.m3u8" },
  { type: "cloudflare", label: "Cloudflare Stream", icon: <Film className="w-4 h-4" />, placeholder: "video-id atau URL lengkap Cloudflare Stream" },
  { type: "youtube", label: "YouTube", icon: <MonitorPlay className="w-4 h-4" />, placeholder: "ID video YouTube atau URL lengkap" },
];

const typeIcons: Record<StreamType, React.ReactNode> = {
  m3u8: <Radio className="w-4 h-4" />,
  cloudflare: <Film className="w-4 h-4" />,
  youtube: <MonitorPlay className="w-4 h-4" />,
};

const Index = () => {
  const [activeType, setActiveType] = useState<StreamType>("m3u8");
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState<{ url: string; type: StreamType } | null>(null);
  const [savedStreams, setSavedStreams] = useState<Stream[]>([]);

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight leading-none">RealTime48</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">Secure Streaming</p>
            </div>
          </div>
          <a
            href="/login"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-[0.95]"
            title="Admin"
          >
            <Settings className="w-4 h-4" />
          </a>
        </div>
      </header>

      {/* Main */}
      <main className="container max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Hero text */}
        <section className="text-center space-y-3 opacity-0 animate-fade-in-up" style={{ animationDelay: "0ms" }}>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ lineHeight: "1.1" }}>
            Putar Stream <span className="text-primary">Apapun</span>
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto text-balance">
            Tempel link M3U8, ID Cloudflare Stream, atau URL YouTube — langsung putar di browser.
          </p>
        </section>

        {/* Input Card */}
        <section className="opacity-0 animate-fade-in-up" style={{ animationDelay: "120ms" }}>
          <div className="bg-card border border-border rounded-xl p-6 space-y-5 shadow-xl shadow-black/20">
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
        </section>

        {/* Player */}
        {playing && (
          <section className="opacity-0 animate-fade-in-up" style={{ animationDelay: "0ms" }}>
            <VideoPlayer url={playing.url} type={playing.type} />
          </section>
        )}

        {/* Saved Streams */}
        {savedStreams.length > 0 && (
          <section className="opacity-0 animate-fade-in-up space-y-4" style={{ animationDelay: "240ms" }}>
            <h3 className="text-lg font-semibold tracking-tight">Channel Tersedia</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedStreams.map((stream) => (
                <button
                  key={stream.id}
                  onClick={() => handlePlayStream(stream)}
                  className={`bg-card border rounded-xl p-4 text-left hover:border-primary/40 transition-all active:scale-[0.97] group ${
                    playing?.url === stream.url ? "border-primary shadow-lg shadow-primary/10" : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 group-hover:bg-primary/20 transition-colors">
                      {typeIcons[stream.type as StreamType] || <Radio className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-medium text-sm truncate">{stream.title}</h4>
                      <p className="text-xs text-muted-foreground truncate mt-0.5 uppercase tracking-wider">{stream.type}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {!playing && savedStreams.length === 0 && (
          <section className="opacity-0 animate-fade-in-up py-16 text-center" style={{ animationDelay: "240ms" }}>
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted flex items-center justify-center">
              <Play className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">
              Masukkan URL atau ID lalu tekan <span className="text-primary font-medium">Putar</span>
            </p>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-auto">
        <div className="container max-w-5xl mx-auto px-4 py-4 text-center text-xs text-muted-foreground">
          StreamBox — Putar M3U8, Cloudflare Stream & YouTube
        </div>
      </footer>
    </div>
  );
};

export default Index;
