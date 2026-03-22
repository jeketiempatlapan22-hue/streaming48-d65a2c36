import { useState } from "react";
import { Play, Radio, Film, MonitorPlay } from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";

type StreamType = "m3u8" | "cloudflare" | "youtube";

const streamTabs: { type: StreamType; label: string; icon: React.ReactNode; placeholder: string }[] = [
  { type: "m3u8", label: "M3U8 / HLS", icon: <Radio className="w-4 h-4" />, placeholder: "https://example.com/stream.m3u8" },
  { type: "cloudflare", label: "Cloudflare Stream", icon: <Film className="w-4 h-4" />, placeholder: "video-id atau URL lengkap Cloudflare Stream" },
  { type: "youtube", label: "YouTube", icon: <MonitorPlay className="w-4 h-4" />, placeholder: "ID video YouTube atau URL lengkap" },
];

const Index = () => {
  const [activeType, setActiveType] = useState<StreamType>("m3u8");
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState<{ url: string; type: StreamType } | null>(null);

  const handlePlay = () => {
    if (!url.trim()) return;
    setPlaying({ url: url.trim(), type: activeType });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container max-w-5xl mx-auto px-4 py-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Play className="w-4 h-4 text-primary fill-primary" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">StreamBox</h1>
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

        {/* Empty state */}
        {!playing && (
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
