import { useEffect, useRef, useState, useCallback } from "react";
import Hls, { type Level } from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize, Settings, Rewind, FastForward } from "lucide-react";

interface Props {
  src: string;
  poster?: string | null;
  onError?: (msg: string) => void;
}

const SEEK_SECONDS = 10;
const DOUBLE_TAP_MS = 300;

const formatLabel = (lvl: Level) => {
  if (lvl.height) return `${lvl.height}p`;
  if (lvl.bitrate) return `${Math.round(lvl.bitrate / 1000)}kbps`;
  return "Auto";
};

const HlsReplayPlayer = ({ src, poster, onError }: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [showQuality, setShowQuality] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekIndicator, setSeekIndicator] = useState<{ side: "left" | "right"; amount: number } | null>(null);

  // Tap tracking refs (one per side to avoid cross-side interference)
  const lastTapRef = useRef<{ side: "left" | "right" | null; time: number }>({ side: null, time: 0 });
  const singleTapTimerRef = useRef<NodeJS.Timeout | null>(null);
  const seekIndicatorTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: Infinity,
        maxBufferLength: 60,
        maxMaxBufferLength: 600,
        liveDurationInfinity: false,
        liveSyncDurationCount: 3,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        setLevels(data.levels || []);
        try {
          if (video.currentTime < 0.1) video.currentTime = 0;
        } catch {}
      });
      hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
        const details: any = data.details;
        if (!details) return;
        // Force VOD mode so the entire timeline is seekable, even if the
        // playlist is missing #EXT-X-ENDLIST. We trust that this is a replay.
        try {
          details.live = false;
        } catch {}
        // Surface the total duration as soon as the manifest is parsed,
        // so the UI can show it before the browser computes video.duration.
        const total = Number(details.totalduration);
        if (isFinite(total) && total > 0) {
          setDuration((prev) => (prev && isFinite(prev) && prev > 0 ? prev : total));
        }
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        setCurrentLevel(hls.autoLevelEnabled ? -1 : data.level);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          onError?.(`Gagal memuat video: ${data.details || data.type}`);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    } else {
      onError?.("Browser tidak mendukung HLS");
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, onError]);

  // Track the best-known duration (manifest totalduration OR video.duration)
  const durationRef = useRef(0);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      const vidDur = v.duration;
      // Prefer the video element's duration once it's a finite positive number,
      // but fall back to whatever we already have (e.g. from the HLS manifest)
      // so the UI never regresses to 00:00 after we already know the length.
      const best =
        isFinite(vidDur) && vidDur > 0
          ? vidDur
          : durationRef.current && isFinite(durationRef.current)
          ? durationRef.current
          : 0;
      setCurrentTime(v.currentTime || 0);
      if (best > 0) {
        setDuration((prev) => (prev && prev >= best ? prev : best));
        setProgress(((v.currentTime || 0) / best) * 100);
      }
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onTime);
    v.addEventListener("durationchange", onTime);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onTime);
      v.removeEventListener("durationchange", onTime);
    };
  }, []);

  // Cleanup any pending tap timers on unmount
  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      if (seekIndicatorTimerRef.current) clearTimeout(seekIndicatorTimerRef.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play().catch(() => {}) : v.pause();
  }, []);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  // Best-known total length: prefer the live <video> duration, else manifest
  const getEffectiveDuration = useCallback(() => {
    const v = videoRef.current;
    const vd = v?.duration ?? NaN;
    if (isFinite(vd) && vd > 0) return vd;
    return durationRef.current && isFinite(durationRef.current) ? durationRef.current : 0;
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      const dur = getEffectiveDuration();
      const next = (v.currentTime || 0) + delta;
      const target = dur > 0 ? Math.max(0, Math.min(dur, next)) : Math.max(0, next);
      try {
        v.currentTime = target;
      } catch {}
    },
    [getEffectiveDuration]
  );

  const showSeekIndicator = (side: "left" | "right", amount: number) => {
    setSeekIndicator({ side, amount });
    if (seekIndicatorTimerRef.current) clearTimeout(seekIndicatorTimerRef.current);
    seekIndicatorTimerRef.current = setTimeout(() => setSeekIndicator(null), 600);
  };

  // Unified seek (works for click and drag) — uses effective duration so that
  // users can jump to the middle/end even before video.duration resolves.
  const seekToClientX = (clientX: number, rect: DOMRect) => {
    const v = videoRef.current;
    if (!v) return;
    const dur = getEffectiveDuration();
    if (!dur) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    try {
      v.currentTime = ratio * dur;
    } catch {}
  };

  const handleSeekbarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const rect = target.getBoundingClientRect();
    seekToClientX(e.clientX, rect);

    const move = (ev: PointerEvent) => seekToClientX(ev.clientX, rect);
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  // Tap on video area: single tap toggles play, double-tap on left/right seeks
  const handleVideoAreaTap = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore taps that originate from inside the controls bar
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest("[data-controls-bar]")) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const side: "left" | "right" = x < rect.width / 2 ? "left" : "right";
    const now = Date.now();
    const last = lastTapRef.current;

    if (last.side === side && now - last.time < DOUBLE_TAP_MS) {
      // Double tap detected — cancel pending single-tap (play toggle)
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      const delta = side === "left" ? -SEEK_SECONDS : SEEK_SECONDS;
      seekBy(delta);
      showSeekIndicator(side, SEEK_SECONDS);
      lastTapRef.current = { side: null, time: 0 };
      return;
    }

    lastTapRef.current = { side, time: now };
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    singleTapTimerRef.current = setTimeout(() => {
      togglePlay();
      singleTapTimerRef.current = null;
    }, DOUBLE_TAP_MS);
  };

  const setLevel = (idx: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = idx;
    setCurrentLevel(idx);
    setShowQuality(false);
  };

  const enterFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return "00:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-xl bg-black select-none">
      <div
        className="relative"
        onPointerDown={handleVideoAreaTap}
      >
        <video
          ref={videoRef}
          poster={poster || undefined}
          className="aspect-video w-full"
          playsInline
        />

        {/* Double-tap seek indicator overlay */}
        {seekIndicator && (
          <div
            className={`pointer-events-none absolute inset-y-0 ${
              seekIndicator.side === "left" ? "left-0" : "right-0"
            } flex w-1/2 items-center justify-center`}
          >
            <div className="flex flex-col items-center gap-1 rounded-full bg-black/55 px-5 py-3 text-white backdrop-blur-sm animate-in fade-in zoom-in duration-150">
              {seekIndicator.side === "left" ? (
                <Rewind className="h-7 w-7" fill="currentColor" />
              ) : (
                <FastForward className="h-7 w-7" fill="currentColor" />
              )}
              <span className="text-xs font-semibold tabular-nums">
                {seekIndicator.amount} detik
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        data-controls-bar
        className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 space-y-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Seekbar with draggable thumb */}
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
              style={{ width: `${progress}%` }}
            />
          </div>
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow opacity-0 transition-opacity group-hover:opacity-100"
            style={{ left: `${progress}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button
              onClick={() => {
                seekBy(-SEEK_SECONDS);
                showSeekIndicator("left", SEEK_SECONDS);
              }}
              aria-label="Mundur 10 detik"
              className="hidden sm:inline-flex"
            >
              <Rewind className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                seekBy(SEEK_SECONDS);
                showSeekIndicator("right", SEEK_SECONDS);
              }}
              aria-label="Maju 10 detik"
              className="hidden sm:inline-flex"
            >
              <FastForward className="h-5 w-5" />
            </button>
            <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <span className="text-xs tabular-nums opacity-80">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
          </div>
          <div className="flex items-center gap-2 relative">
            {levels.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowQuality((v) => !v)}
                  className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                  aria-label="Kualitas"
                >
                  <Settings className="h-3.5 w-3.5" />
                  {currentLevel === -1 ? "Auto" : formatLabel(levels[currentLevel])}
                </button>
                {showQuality && (
                  <div className="absolute bottom-full right-0 mb-2 min-w-[110px] rounded-lg border border-white/10 bg-black/90 p-1 backdrop-blur">
                    <button
                      onClick={() => setLevel(-1)}
                      className={`block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-white/10 ${
                        currentLevel === -1 ? "text-primary font-bold" : ""
                      }`}
                    >
                      Auto
                    </button>
                    {[...levels]
                      .map((lvl, i) => ({ lvl, i }))
                      .sort((a, b) => (b.lvl.height || 0) - (a.lvl.height || 0))
                      .map(({ lvl, i }) => (
                        <button
                          key={i}
                          onClick={() => setLevel(i)}
                          className={`block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-white/10 ${
                            currentLevel === i ? "text-primary font-bold" : ""
                          }`}
                        >
                          {formatLabel(lvl)}
                        </button>
                      ))}
                  </div>
                )}
              </div>
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

export default HlsReplayPlayer;
