import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Wifi, Loader2, RotateCcw, RotateCw } from "lucide-react";
import { parseYoutubeId as parseYoutubeIdShared } from "@/lib/youtubeUrl";

interface Props {
  url: string; // YouTube URL or 11-char ID
  poster?: string | null;
}

// Quality ladder (highest -> lowest)
const QUALITY_LADDER = ["hd1080", "hd720", "large", "medium", "small"];
const MAX_QUALITY = "hd1080";

const parseYoutubeId = (url: string): string => parseYoutubeIdShared(url) ?? "";

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
  const [showFallback, setShowFallback] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const seekingRef = useRef(false);
  const [seekValue, setSeekValue] = useState(0);
  const playerReadyRef = useRef(false);

  const switchingTimerRef = useRef<number | null>(null);
  const bufferingSinceRef = useRef<number | null>(null);
  const qualityIndexRef = useRef<number>(0);
  const lastDowngradeRef = useRef<number>(0);

  const id = parseYoutubeId(url);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // Pakai host www.youtube.com karena CSP aplikasi sudah mengizinkan domain ini.
  // youtube-nocookie.com sebelumnya bisa terblokir oleh CSP sehingga iframe kosong
  // lalu fallback muncul walaupun ID video valid.
  const src = id
    ? `https://www.youtube.com/embed/${id}?enablejsapi=1&autoplay=1&mute=1&playsinline=1&controls=0&modestbranding=1&rel=0&iv_load_policy=3&origin=${encodeURIComponent(origin)}&widget_referrer=${encodeURIComponent(origin)}`
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

  // Loading overlay maksimum 1.5 detik di awal mount — tidak menggantung iframe
  useEffect(() => {
    setLoading(true);
    setShowFallback(false);
    playerReadyRef.current = false;
    const t = window.setTimeout(() => setLoading(false), 1500);
    // Safety net: jika setelah 8 detik player belum mengirim infoDelivery (Error 153 / restricted),
    // tampilkan fallback link "Tonton di YouTube".
    const fb = window.setTimeout(() => {
      if (!playerReadyRef.current) setShowFallback(true);
    }, 8000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(fb);
    };
  }, [src]);

  // YT IFrame API bridge — sinkronisasi state, BUKAN syarat tampil iframe
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      try {
        const data = JSON.parse(e.data);

        if (data.event === "infoDelivery" && data.info) {
          // Player aktif & merespons → tidak perlu fallback
          playerReadyRef.current = true;
          if (showFallback) setShowFallback(false);
          if (typeof data.info.muted === "boolean") setMuted(data.info.muted);

          if (typeof data.info.playerState === "number") {
            const state = data.info.playerState;
            // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
            setPlaying(state === 1);

            if (state === 3) {
              if (bufferingSinceRef.current == null) {
                bufferingSinceRef.current = Date.now();
              }
            } else {
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

          if (typeof data.info.currentTime === "number" && !seekingRef.current) {
            setCurrentTime(data.info.currentTime);
            setSeekValue(data.info.currentTime);
          }
          if (typeof data.info.duration === "number" && data.info.duration > 0) {
            setDuration(data.info.duration);
          }
        }
      } catch {
        /* noop */
      }
    };
    window.addEventListener("message", onMessage);

    // Subscribe ke event YT — best-effort, tidak menghalangi tampilan
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
      if (attempts > 20) clearInterval(sub);
    }, 500);

    // Adaptive watcher: tiap 1s, jika buffering >3s & adaptive on → downgrade
    const watcher = setInterval(() => {
      if (!adaptive) return;
      if (switchingTimerRef.current) return;
      const since = bufferingSinceRef.current;
      if (since && Date.now() - since > 3000) {
        downgradeOneStep();
      }
    }, 1000);

    // Poll currentTime & duration (lebih ringan: 1s + skip saat tab hidden / sedang seek)
    const timePoll = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (seekingRef.current) return;
      const w = iframeRef.current?.contentWindow;
      if (!w) return;
      w.postMessage(JSON.stringify({ event: "command", func: "getCurrentTime", args: [] }), "*");
      w.postMessage(JSON.stringify({ event: "command", func: "getDuration", args: [] }), "*");
    }, 1000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(sub);
      clearInterval(watcher);
      clearInterval(timePoll);
      if (switchingTimerRef.current) window.clearTimeout(switchingTimerRef.current);
    };
  }, [src, adaptive, downgradeOneStep]);

  if (!id) {
    return (
      <div className="aspect-video w-full flex items-center justify-center rounded-xl bg-black px-4 text-center text-sm text-muted-foreground">
        URL/ID YouTube belum dikonfigurasi untuk show ini
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

  const seekTo = (sec: number) => {
    const v = Math.max(0, Math.min(duration || sec, sec));
    post("seekTo", [v, true]);
    setCurrentTime(v);
    setSeekValue(v);
  };
  const skip = (delta: number) => seekTo((currentTime || 0) + delta);

  const seekToClientX = (clientX: number, rect: DOMRect) => {
    if (!duration) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const v = ratio * duration;
    setSeekValue(v);
    setCurrentTime(v);
  };
  const updateHoverPreview = (clientX: number, rect: DOMRect) => {
    if (!duration) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHoverPreview({ time: ratio * duration, pct: ratio * 100 });
  };
  const handleSeekbarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!duration) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const rect = target.getBoundingClientRect();
    seekingRef.current = true;
    seekToClientX(e.clientX, rect);
    updateHoverPreview(e.clientX, rect);
    const isMouse = e.pointerType === "mouse";
    const move = (ev: PointerEvent) => {
      seekToClientX(ev.clientX, rect);
      updateHoverPreview(ev.clientX, rect);
    };
    const up = (ev: PointerEvent) => {
      try { target.releasePointerCapture(e.pointerId); } catch {}
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      seekTo(ratio * duration);
      if (!isMouse) setHoverPreview(null);
      setTimeout(() => { seekingRef.current = false; }, 200);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  const progressPct = duration > 0 ? Math.min(100, (seekValue / duration) * 100) : 0;
  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const mm = String(m).padStart(2, "0");
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-xl bg-black">
      {/* Poster di belakang sebagai background sementara iframe load */}
      {poster && loading && (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 z-0 h-full w-full object-cover opacity-60"
          aria-hidden
        />
      )}

      <div className="aspect-video w-full">
        <iframe
          ref={iframeRef}
          src={src}
          title="Replay"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture; accelerometer; gyroscope"
          allowFullScreen
          referrerPolicy="origin-when-cross-origin"
          onLoad={() => {
            playerReadyRef.current = true;
            setLoading(false);
            setShowFallback(false);
            window.setTimeout(() => post("playVideo"), 250);
          }}
          className="relative z-[1] h-full w-full"
        />
      </div>

      {/* Click-blocker overlay — mencegah klik tembus ke link/tombol native YouTube,
          sekaligus menjadi target tap untuk play/pause */}
      <div
        className="absolute inset-0 z-10"
        style={{ background: "transparent" }}
        onClick={togglePlay}
        onContextMenu={(e) => e.preventDefault()}
        aria-hidden
      />

      {/* Loading overlay singkat (≤1.5s) */}
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-[16] flex items-center justify-center bg-black/45 backdrop-blur-[1px] animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-black/65 px-5 py-4 text-white">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <span className="text-[11px] font-semibold tracking-wide">
              Memuat YouTube…
            </span>
          </div>
        </div>
      )}

      {/* Fallback "Tonton di YouTube" jika player tidak ready dalam 8 detik
          (mis. video restricted / Error 153 yang masih kebal terhadap parameter).
          z-[18] di atas click-blocker (z-10) dan loading (z-[16]) supaya bisa diklik. */}
      {showFallback && id && (
        <div className="absolute inset-0 z-[18] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 text-center">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/60 px-6 py-5 text-white">
            <span className="text-xs font-semibold tracking-wide opacity-80">
              Player YouTube belum dapat memuat video ini
            </span>
            <a
              href={`https://www.youtube.com/watch?v=${id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90"
            >
              ▶ Tonton di YouTube
            </a>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowFallback(false);
                setLoading(true);
                playerReadyRef.current = false;
                if (iframeRef.current) {
                  const cur = iframeRef.current.src;
                  iframeRef.current.src = "about:blank";
                  setTimeout(() => {
                    if (iframeRef.current) iframeRef.current.src = cur;
                  }, 100);
                }
                window.setTimeout(() => setLoading(false), 1500);
              }}
              className="text-[11px] font-semibold text-white/70 underline"
            >
              Coba muat ulang player
            </button>
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

      {/* Custom controls (z-20) — selalu di atas overlay click-blocker */}
      <div
        className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 to-transparent p-3 text-white space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Seekbar with draggable thumb (gaya HLS) */}
        <div
          className="group relative h-4 w-full cursor-pointer touch-none"
          onPointerDown={handleSeekbarPointerDown}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          aria-valuenow={currentTime}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
            style={{ left: `${progressPct}%` }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button onClick={() => skip(-10)} aria-label="Mundur 10 detik" title="-10s">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button onClick={() => skip(10)} aria-label="Maju 10 detik" title="+10s">
              <RotateCw className="h-4 w-4" />
            </button>
            <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <span className="text-[10px] font-mono tabular-nums opacity-80">
              {formatTime(currentTime)} / {formatTime(duration)}
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
    </div>
  );
};

export default YoutubeReplayPlayer;
