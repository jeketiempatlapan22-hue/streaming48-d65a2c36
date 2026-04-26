import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Wifi } from "lucide-react";

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
    case "hd1440": return "1440p";
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

  // Buffering tracking — drop quality if buffering > 3s
  const bufferingSinceRef = useRef<number | null>(null);
  const qualityIndexRef = useRef<number>(0); // start at top of ladder
  const lastDowngradeRef = useRef<number>(0);

  const id = parseYoutubeId(url);

  // Embed parameters: hide controls + branding + related, request highest quality
  const src = id
    ? `https://www.youtube.com/embed/${id}?enablejsapi=1&controls=0&modestbranding=1&rel=0&showinfo=0&fs=0&iv_load_policy=3&disablekb=1&playsinline=1&vq=hd1080&autoplay=0`
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
    // Throttle: don't downgrade more than once per 5s
    if (now - lastDowngradeRef.current < 5000) return;
    if (qualityIndexRef.current >= QUALITY_LADDER.length - 1) return;
    qualityIndexRef.current += 1;
    lastDowngradeRef.current = now;
    const next = QUALITY_LADDER[qualityIndexRef.current];
    setQuality(next);
  }, [setQuality]);

  // Lazy YT IFrame API for state events (muted/playing/buffering/quality)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      try {
        const data = JSON.parse(e.data);
        if (data.event === "infoDelivery" && data.info) {
          if (typeof data.info.muted === "boolean") setMuted(data.info.muted);

          if (typeof data.info.playerState === "number") {
            const state = data.info.playerState;
            // 1 = playing, 2 = paused, 3 = buffering, 0 = ended
            setPlaying(state === 1);

            if (state === 3) {
              // Buffering started
              if (bufferingSinceRef.current == null) {
                bufferingSinceRef.current = Date.now();
              }
            } else {
              // Not buffering — reset
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

    // Subscribe to state updates and force highest quality
    const sub = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "listening" }),
        "*",
      );
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"] }),
        "*",
      );
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "addEventListener", args: ["onPlaybackQualityChange"] }),
        "*",
      );
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "setPlaybackQuality", args: ["hd1080"] }),
        "*",
      );
    }, 800);

    // Adaptive watcher: every 1s, if buffering >3s and adaptive on, downgrade
    const watcher = setInterval(() => {
      if (!adaptive) return;
      const since = bufferingSinceRef.current;
      if (since && Date.now() - since > 3000) {
        downgradeOneStep();
        // Reset baseline so next downgrade waits another 3s of continuous buffering
        bufferingSinceRef.current = Date.now();
      }
    }, 1000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(sub);
      clearInterval(watcher);
    };
  }, [src, adaptive, downgradeOneStep]);

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
          ref={iframeRef}
          src={src}
          title="Replay"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen={false}
          className="h-full w-full"
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
          {!adaptive && currentQuality !== "hd1080" && (
            <button
              onClick={resetToMaxQuality}
              className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold"
            >
              4K
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
