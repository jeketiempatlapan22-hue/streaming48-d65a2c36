import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Wifi, Loader2 } from "lucide-react";

interface Props {
  url: string; // YouTube URL or ID
  poster?: string | null;
}

// Quality ladder (highest -> lowest) — mulai dari 1080p
const QUALITY_LADDER = ["hd1080", "hd720", "large", "medium", "small"];
const MAX_QUALITY = "hd1080";

// Extract video id from youtube url forms
const parseYoutubeId = (url: string): string => {
  if (!url) return "";
  const m1 = url.match(/[?&]v=([\w-]{6,})/);
  if (m1) return m1[1];
  const m2 = url.match(/youtu\.be\/([\w-]{6,})/);
  if (m2) return m2[1];
  const m3 = url.match(/youtube\.com\/embed\/([\w-]{6,})/);
  if (m3) return m3[1];
  if (/^[\w-]{6,}$/.test(url)) return url;
  return "";
};

const qualityLabel = (q: string): string => {
  switch (q) {
    case "hd1080": return "1080p";
    case "hd720": return "720p";
    case "large": return "480p";
    case "medium": return "360p";
    case "small": return "240p";
    default: return q.toUpperCase();
  }
};

const YoutubeReplayPlayer = ({ url, poster }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentQuality, setCurrentQuality] = useState<string>("hd1080");
  const [adaptive, setAdaptive] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stalled, setStalled] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const switchingTimerRef = useRef<number | null>(null);
  const bufferingSinceRef = useRef<number | null>(null);
  const qualityIndexRef = useRef<number>(0);
  const lastDowngradeRef = useRef<number>(0);
  const readyRef = useRef<boolean>(false);
  const readyTimeoutRef = useRef<number | null>(null);

  const id = parseYoutubeId(url);

  // Build iframe src. `origin` is REQUIRED for the YT IFrame API postMessage
  // bridge to work reliably across browsers.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const src = id
    ? `https://www.youtube.com/embed/${id}?enablejsapi=1&controls=0&modestbranding=1&rel=0&showinfo=0&fs=0&iv_load_policy=3&disablekb=1&playsinline=1&vq=hd1080&autoplay=0&origin=${encodeURIComponent(origin)}&widgetid=1`
    : "";

  const post = useCallback((func: string, args: any[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*",
    );
  }, []);

  const setQuality = useCallback((q: string) => {
    setCurrentQuality(q);
    post("setPlaybackQuality", [q]);
  }, [post]);

  const downgradeOneStep = useCallback(() => {
    const now = Date.now();
    if (now - lastDowngradeRef.current < 5000) return;
    if (qualityIndexRef.current >= QUALITY_LADDER.length - 1) return;
    qualityIndexRef.current += 1;
    lastDowngradeRef.current = now;
    const next = QUALITY_LADDER[qualityIndexRef.current];

    setSwitching(qualityLabel(next));
    setQuality(next);
    setTimeout(() => post("playVideo"), 250);
    if (switchingTimerRef.current) window.clearTimeout(switchingTimerRef.current);
    switchingTimerRef.current = window.setTimeout(() => {
      setSwitching(null);
      bufferingSinceRef.current = null;
    }, 1200);
  }, [setQuality, post]);

  // Reset loading state on reload / src change
  useEffect(() => {
    setLoading(true);
    setStalled(false);
    readyRef.current = false;
  }, [src, reloadKey]);

  // Watchdog: kalau iframe tidak siap dalam 8 detik, anggap stuck dan reload sekali
  useEffect(() => {
    if (readyTimeoutRef.current) window.clearTimeout(readyTimeoutRef.current);
    readyTimeoutRef.current = window.setTimeout(() => {
      if (!readyRef.current) {
        setStalled(true);
        // Soft reload iframe via key bump
        setReloadKey((k) => k + 1);
      }
    }, 8000);
    return () => {
      if (readyTimeoutRef.current) window.clearTimeout(readyTimeoutRef.current);
    };
  }, [src, reloadKey]);

  // YT IFrame API bridge
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Hanya proses pesan dari domain YouTube
      if (typeof e.origin === "string" && !/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) {
        // continue silently — beberapa browser tidak set origin dengan rapi
      }
      if (typeof e.data !== "string") return;
      try {
        const data = JSON.parse(e.data);

        // Tanda iframe API hidup → matikan loading
        if (data.event === "onReady" || data.event === "initialDelivery" || data.event === "infoDelivery") {
          if (!readyRef.current) {
            readyRef.current = true;
            setLoading(false);
            setStalled(false);
          }
        }

        if (data.event === "infoDelivery" && data.info) {
          if (typeof data.info.muted === "boolean") setMuted(data.info.muted);

          if (typeof data.info.playerState === "number") {
            const state = data.info.playerState;
            // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
            setPlaying(state === 1);

            if (state === 3) {
              setLoading(true);
              if (bufferingSinceRef.current == null) {
                bufferingSinceRef.current = Date.now();
              }
            } else {
              setLoading(false);
              bufferingSinceRef.current = null;
            }
          }

          if (typeof data.info.playbackQuality === "string") {
            const q = data.info.playbackQuality;
            if (q && q !== "unknown") {
              setCurrentQuality(q);
              const idx = QUALITY_LADDER.indexOf(q);
              if (idx >= 0) qualityIndexRef.current = idx;
            }
          }
        }
      } catch {
        /* noop */
      }
    };
    window.addEventListener("message", onMessage);

    // Subscribe ke event YT secepat mungkin & polling sampai ready
    let attempts = 0;
    const subscribe = () => {
      const w = iframeRef.current?.contentWindow;
      if (!w) return;
      w.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
      w.postMessage(
        JSON.stringify({ event: "command", func: "addEventListener", args: ["onReady"] }),
        "*",
      );
      w.postMessage(
        JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"] }),
        "*",
      );
      w.postMessage(
        JSON.stringify({ event: "command", func: "addEventListener", args: ["onPlaybackQualityChange"] }),
        "*",
      );
      w.postMessage(
        JSON.stringify({ event: "command", func: "setPlaybackQuality", args: ["hd1080"] }),
        "*",
      );
    };
    const sub = setInterval(() => {
      attempts += 1;
      subscribe();
      if (readyRef.current || attempts > 20) clearInterval(sub);
    }, 500);

    // Adaptive watcher: every 1s, if buffering >3s and adaptive on, downgrade
    const watcher = setInterval(() => {
      if (!adaptive) return;
      if (switchingTimerRef.current) return;
      const since = bufferingSinceRef.current;
      if (since && Date.now() - since > 3000) {
        downgradeOneStep();
      }
    }, 1000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(sub);
      clearInterval(watcher);
      if (switchingTimerRef.current) window.clearTimeout(switchingTimerRef.current);
    };
  }, [src, reloadKey, adaptive, downgradeOneStep]);

  if (!id) {
    return (
      <div className="aspect-video w-full flex items-center justify-center rounded-xl bg-black text-sm text-muted-foreground">
        Link YouTube tidak valid
      </div>
    );
  }

  const togglePlay = () => post(playing ? "pauseVideo" : "playVideo");
  const toggleMute = () => post(muted ? "unMute" : "mute");
  const enterFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };
  const resetToMaxQuality = () => {
    qualityIndexRef.current = 0;
    lastDowngradeRef.current = 0;
    bufferingSinceRef.current = null;
    setQuality("hd1080");
  };

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-xl bg-black">
      <div className="aspect-video w-full">
        <iframe
          key={reloadKey}
          ref={iframeRef}
          src={src}
          title="Replay"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen={false}
          className="h-full w-full"
          onLoad={() => {
            // Iframe document loaded — biarkan watchdog yang verifikasi API ready
          }}
        />
      </div>

      {/* Click-blocking overlay so users cannot click through into youtube.com */}
      <div
        className="absolute inset-0 z-10"
        style={{ background: "transparent" }}
        onClick={togglePlay}
        onContextMenu={(e) => e.preventDefault()}
        aria-hidden
      />

      {/* Loading / connecting overlay */}
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-[16] flex items-center justify-center bg-black/55 backdrop-blur-[1px] animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-black/65 px-5 py-4 text-white">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-[11px] font-semibold tracking-wide">
              {stalled ? "Memulihkan koneksi…" : "Menghubungkan ke YouTube…"}
            </span>
          </div>
        </div>
      )}

      {/* Smooth transition overlay saat menurunkan resolusi */}
      <div
        className={`pointer-events-none absolute inset-0 z-[15] flex items-center justify-center bg-black/55 backdrop-blur-sm transition-opacity duration-500 ${
          switching ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden={!switching}
      >
        <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs font-semibold text-white animate-fade-in">
          <Wifi className="h-3.5 w-3.5 animate-pulse" />
          Menyesuaikan kualitas{switching ? ` → ${switching}` : "..."}
        </div>
      </div>

      {/* Custom controls (z-20) */}
      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 to-transparent p-3 flex items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <span className="text-[10px] uppercase tracking-wide opacity-70">
            YouTube • {qualityLabel(currentQuality)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAdaptive((a) => !a)}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ${
              adaptive ? "bg-primary/30 text-primary-foreground" : "bg-white/10"
            }`}
            title="Adaptive quality (turunkan otomatis saat buffering >3s)"
          >
            <Wifi className="h-3 w-3" /> {adaptive ? "AUTO" : "MAX"}
          </button>
          {!adaptive && currentQuality !== MAX_QUALITY && (
            <button
              onClick={resetToMaxQuality}
              className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold transition hover:bg-white/20"
            >
              1080p
            </button>
          )}
          <button onClick={enterFullscreen} aria-label="Fullscreen">
            <Maximize className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default YoutubeReplayPlayer;
