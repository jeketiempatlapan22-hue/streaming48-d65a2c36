import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback, lazy, Suspense } from "react";

const Watermark = lazy(() => import("@/components/viewer/Watermark"));

interface VideoPlayerProps {
  playlist: {
    type: string;
    url: string;
    label?: string;
  };
  autoPlay?: boolean;
  watermarkUrl?: string;
  tokenCode?: string;
}

export interface VideoPlayerHandle {
  play: () => void;
  pause: () => void;
  seekTo?: (time: number) => void;
  getCurrentTime?: () => number;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ playlist, autoPlay = true, watermarkUrl, tokenCode }, ref) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [qualities, setQualities] = useState<{ label: string; value: number }[]>([]);
  const [selectedQuality, setSelectedQuality] = useState(-1);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ytMuted, setYtMuted] = useState(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [isBehindLive, setIsBehindLive] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const playlistUrl = playlist.url;
  const playlistType = playlist.type;

  // ── YouTube helpers ──
  const decryptUrl = useCallback((encoded: string): string => {
    if (!encoded.startsWith("enc:")) return encoded;
    const b64 = encoded.slice(4);
    const _a = [12,105,82,37,24,119,60,125,84,18,73,127,12,114,10,20];
    const _b = [94,61,102,29,96,60,5,16,5,32,63,51,59,28,90,32];
    const _k = _a.map((v, i) => v ^ _b[i]);
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) result[i] = bytes[i] ^ _k[i % _k.length];
    return new TextDecoder().decode(result);
  }, []);

  const extractVideoId = useCallback((url: string): string => {
    const decrypted = decryptUrl(url);
    const match = decrypted.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^?&/]+)/);
    return (match?.[1] ?? decrypted).trim();
  }, [decryptUrl]);

  // ── Imperative Handle ──
  useImperativeHandle(ref, () => ({
    play: () => {
      if (playlistType === "youtube" && ytReadyRef.current && ytPlayerRef.current) {
        try { ytPlayerRef.current.playVideo(); } catch {}
      } else if (videoRef.current) {
        videoRef.current.play().catch(() => {});
      }
    },
    pause: () => {
      if (playlistType === "youtube" && ytReadyRef.current && ytPlayerRef.current) {
        try { ytPlayerRef.current.pauseVideo(); } catch {}
      } else if (videoRef.current) {
        videoRef.current.pause();
      }
    },
    seekTo: (time: number) => {
      if (playlistType === "youtube" && ytReadyRef.current && ytPlayerRef.current) {
        try { ytPlayerRef.current.seekTo(time, true); } catch {}
      } else if (videoRef.current) {
        videoRef.current.currentTime = time;
      }
    },
    getCurrentTime: () => {
      if (playlistType === "youtube" && ytReadyRef.current && ytPlayerRef.current) {
        try { return ytPlayerRef.current.getCurrentTime() || 0; } catch { return 0; }
      }
      return videoRef.current?.currentTime || 0;
    },
  }), [playlistType]);

  // ── Controls auto-hide ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const resetTimer = () => {
      setShowControls(true);
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    };
    el.addEventListener("mousemove", resetTimer, { passive: true });
    el.addEventListener("touchstart", resetTimer, { passive: true });
    resetTimer();
    return () => {
      clearTimeout(controlsTimeoutRef.current);
      el.removeEventListener("mousemove", resetTimer);
      el.removeEventListener("touchstart", resetTimer);
    };
  }, []);

  // ══════════════════════════════════════════
  //  HLS / M3U8 — SIMPLIFIED & BULLETPROOF
  // ══════════════════════════════════════════
  useEffect(() => {
    if (playlistType !== "m3u8") return;
    const video = videoRef.current;
    if (!video || !playlistUrl) return;
    let destroyed = false;

    // Clean slate
    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
    video.removeAttribute("src");
    video.load();
    setIsPlaying(false);
    setQualities([]);
    setSelectedQuality(-1);
    setIsBehindLive(false);
    setPlayerError(null);

    // Sync UI state from native video events
    const onPlay = () => { if (!destroyed) setIsPlaying(true); };
    const onPause = () => { if (!destroyed) setIsPlaying(false); };
    const onError = () => { if (!destroyed) console.error("[VideoPlayer] video error", video.error); };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("error", onError);

    const initHls = async () => {
      const HlsModule = await import("hls.js");
      const Hls = HlsModule.default;
      if (destroyed) return;

      // Safari native HLS support
      if (!Hls.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = playlistUrl;
          video.addEventListener("loadedmetadata", () => {
            if (!destroyed && autoPlay) video.play().catch(() => {});
          }, { once: true });
        } else {
          setPlayerError("Browser tidak mendukung HLS");
        }
        return;
      }

      const hls = new Hls({
        enableWorker: false, // Workers can cause CORS issues
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        capLevelToPlayerSize: true,
        startLevel: -1,
        fragLoadingMaxRetry: 8,
        manifestLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 15000,
        fragLoadingTimeOut: 20000,
        levelLoadingTimeOut: 15000,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, (_: any, data: any) => {
        if (destroyed) return;
        const levels = data.levels?.map((l: any, i: number) => ({
          label: l.height ? `${l.height}p` : `Level ${i}`,
          value: i,
        })) || [];
        setQualities([{ label: "Auto", value: -1 }, ...levels]);
        if (autoPlay) video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_: any, d: any) => {
        if (!destroyed) setSelectedQuality(d.level);
      });

      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (destroyed) return;
        console.warn("[HLS] Error:", data.type, data.details, data.fatal);
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            console.warn("[HLS] Fatal network error, attempting recovery...");
            setTimeout(() => { if (!destroyed && hlsRef.current) hlsRef.current.startLoad(); }, 2000);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            console.warn("[HLS] Fatal media error, recovering...");
            hls.recoverMediaError();
          } else {
            setPlayerError("Stream error. Coba refresh halaman.");
          }
        } else if (data.details === "bufferStalledError") {
          // Nudge forward if buffered ahead
          if (video.buffered.length > 0) {
            const end = video.buffered.end(video.buffered.length - 1);
            if (end - video.currentTime > 1) video.currentTime = end - 0.5;
          }
        }
      });

      // SIMPLE INIT: loadSource + attachMedia (both orders work per HLS.js docs)
      // Using loadSource FIRST avoids depending on MEDIA_ATTACHED event
      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      // Behind-live detection (lightweight)
      const liveCheckId = setInterval(() => {
        if (destroyed || video.paused || !hls.liveSyncPosition) return;
        setIsBehindLive(hls.liveSyncPosition - video.currentTime > 8);
      }, 3000);

      // Tab visibility recovery
      const onVisible = () => {
        if (destroyed || document.hidden || !hlsRef.current) return;
        hlsRef.current.startLoad();
        if (video.paused) video.play().catch(() => {});
        if (hlsRef.current.liveSyncPosition && hlsRef.current.liveSyncPosition - video.currentTime > 5) {
          video.currentTime = hlsRef.current.liveSyncPosition;
        }
      };
      document.addEventListener("visibilitychange", onVisible);

      // Health check every 20s
      const healthId = setInterval(() => {
        if (destroyed || document.hidden || video.paused || !hlsRef.current) return;
        if (video.readyState < 3) hlsRef.current.startLoad();
      }, 20000);

      // Override destroy to clean up intervals
      const origDestroy = hls.destroy.bind(hls);
      hls.destroy = () => {
        clearInterval(liveCheckId);
        clearInterval(healthId);
        document.removeEventListener("visibilitychange", onVisible);
        try { origDestroy(); } catch {}
      };
    };

    initHls();

    return () => {
      destroyed = true;
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("error", onError);
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
    };
  }, [playlistType, playlistUrl, autoPlay]);

  // ══════════════════════════════════════════
  //  YouTube — API with iframe fallback
  // ══════════════════════════════════════════
  const [ytMode, setYtMode] = useState<"loading" | "api" | "iframe">("loading");
  const ytContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (playlistType !== "youtube" || !playlistUrl) return;
    let destroyed = false;

    setIsPlaying(false);
    setQualities([]);
    setPlayerError(null);
    setYtMode("loading");
    ytReadyRef.current = false;

    const videoId = extractVideoId(playlistUrl);
    if (!videoId || videoId.length < 5) {
      console.error("[YT] Invalid video ID from:", playlistUrl);
      setPlayerError("YouTube video ID tidak valid");
      return;
    }

    // Fallback to iframe after 5 seconds if API doesn't load
    const fallbackTimer = setTimeout(() => {
      if (!destroyed && !ytReadyRef.current) {
        console.warn("[YT] API timeout, falling back to iframe");
        setYtMode("iframe");
        setIsPlaying(true);
      }
    }, 5000);

    const createPlayer = () => {
      if (destroyed) return;
      const container = ytContainerRef.current;
      if (!container) { setYtMode("iframe"); return; }
      container.innerHTML = "";
      const div = document.createElement("div");
      div.id = `yt_${Date.now()}`;
      container.appendChild(div);

      try {
        ytPlayerRef.current = new (window as any).YT.Player(div, {
          width: "100%",
          height: "100%",
          videoId,
          playerVars: {
            autoplay: autoPlay ? 1 : 0,
            mute: 1,
            enablejsapi: 1,
            controls: 1,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            // NO origin parameter — it causes issues on dynamic domains
          },
          events: {
            onReady: (e: any) => {
              if (destroyed) return;
              ytReadyRef.current = true;
              clearTimeout(fallbackTimer);
              setYtMode("api");
              if (autoPlay) {
                e.target.playVideo();
                setIsPlaying(true);
                setYtMuted(true);
                // Auto-unmute after a short delay
                setTimeout(() => {
                  if (!destroyed) {
                    try { ytPlayerRef.current?.unMute?.(); setYtMuted(false); } catch {}
                  }
                }, 1500);
              }
            },
            onStateChange: (e: any) => {
              if (!destroyed) setIsPlaying(e.data === 1);
            },
            onError: (e: any) => {
              if (destroyed) return;
              console.error("[YT] Player error:", e.data);
              // Error codes: 2=invalid param, 5=html5 error, 100=not found, 101/150=restricted
              setYtMode("iframe");
            },
          },
        });
      } catch (err) {
        console.error("[YT] Failed to create player:", err);
        setYtMode("iframe");
      }
    };

    // Load YouTube IFrame API
    if ((window as any).YT?.Player) {
      createPlayer();
    } else {
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.onerror = () => { if (!destroyed) setYtMode("iframe"); };
        document.head.appendChild(tag);
      }
      const prevReady = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        prevReady?.();
        if (!destroyed) createPlayer();
      };
      // Also poll in case onYouTubeIframeAPIReady was already called
      const pollId = setInterval(() => {
        if (destroyed) { clearInterval(pollId); return; }
        if ((window as any).YT?.Player) { clearInterval(pollId); createPlayer(); }
      }, 300);
      setTimeout(() => clearInterval(pollId), 10000);
    }

    return () => {
      destroyed = true;
      ytReadyRef.current = false;
      clearTimeout(fallbackTimer);
      try { ytPlayerRef.current?.destroy?.(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [playlistUrl, playlistType, autoPlay, extractVideoId]);

  // ── Control handlers ──
  const handlePlayPause = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlistType === "youtube") {
      if (ytMode === "iframe") return; // iframe has its own controls
      if (!ytReadyRef.current || !ytPlayerRef.current) return;
      try {
        const state = ytPlayerRef.current.getPlayerState();
        if (state === 1 || state === 3) ytPlayerRef.current.pauseVideo();
        else ytPlayerRef.current.playVideo();
      } catch {}
    } else if (playlistType === "cloudflare") {
      // cloudflare iframe has its own controls
    } else {
      const v = videoRef.current;
      if (!v) return;
      v.paused ? v.play().catch(() => {}) : v.pause();
    }
  }, [playlistType, ytMode]);

  const handleQualityChange = useCallback((level: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    if (level === -1) {
      hls.currentLevel = -1;
      try { hls.autoLevelEnabled = true; } catch {}
    } else {
      hls.currentLevel = level;
      hls.nextLevel = level;
    }
    setSelectedQuality(level);
    setShowQualityMenu(false);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (el.requestFullscreen) await el.requestFullscreen();
      else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
    } catch {
      try {
        const v = videoRef.current || el.querySelector("video") || el.querySelector("iframe");
        if (v && (v as any).webkitEnterFullscreen) (v as any).webkitEnterFullscreen();
      } catch {}
    }
  }, []);

  const toggleOrientation = useCallback(async () => {
    try {
      const o = screen.orientation;
      if (o.type.includes("portrait")) await (o as any).lock("landscape");
      else await (o as any).lock("portrait");
    } catch {}
  }, []);

  const toggleYtMute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!ytReadyRef.current || !ytPlayerRef.current) return;
    try {
      if (ytPlayerRef.current.isMuted()) { ytPlayerRef.current.unMute(); setYtMuted(false); }
      else { ytPlayerRef.current.mute(); setYtMuted(true); }
    } catch {}
  }, []);

  const syncToLive = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlistType === "m3u8" && hlsRef.current && videoRef.current) {
      const hls = hlsRef.current;
      if (hls.liveSyncPosition) videoRef.current.currentTime = hls.liveSyncPosition;
      else if (videoRef.current.buffered.length > 0) {
        videoRef.current.currentTime = videoRef.current.buffered.end(videoRef.current.buffered.length - 1) - 0.5;
      }
      if (videoRef.current.paused) videoRef.current.play().catch(() => {});
      setIsBehindLive(false);
    } else if (playlistType === "youtube" && ytReadyRef.current && ytPlayerRef.current) {
      try {
        const d = ytPlayerRef.current.getDuration?.();
        if (d > 0) ytPlayerRef.current.seekTo(d, true);
      } catch {}
      try { ytPlayerRef.current.playVideo(); } catch {}
    }
  }, [playlistType]);

  // Fullscreen listener
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  // Block DevTools
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F12" || (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) || (e.ctrlKey && e.key === "u") || (e.ctrlKey && e.key === "s")) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  // Build YouTube iframe URL (for fallback)
  const ytIframeUrl = playlistType === "youtube"
    ? `https://www.youtube.com/embed/${extractVideoId(playlistUrl)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&controls=1&fs=0&iv_load_policy=3`
    : "";

  // ── Render ──
  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-black ${isFullscreen ? "flex items-center justify-center !h-screen" : "aspect-video"}`}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
    >
      {/* M3U8 / HLS video element — always rendered when type is m3u8 */}
      {playlistType === "m3u8" && (
        <video
          ref={videoRef}
          onClick={handlePlayPause}
          className={`h-full w-full object-contain cursor-pointer bg-black ${isFullscreen ? "max-h-screen" : "absolute inset-0"}`}
          playsInline
          // @ts-ignore
          webkit-playsinline=""
          x-webkit-airplay="allow"
          preload="auto"
        />
      )}

      {/* YouTube API player container */}
      {playlistType === "youtube" && ytMode !== "iframe" && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}>
          <div
            ref={ytContainerRef}
            className="absolute inset-0 w-full h-full [&>div]:!w-full [&>div]:!h-full [&>iframe]:!w-full [&>iframe]:!h-full [&>div>iframe]:!w-full [&>div>iframe]:!h-full [&_iframe]:!w-full [&_iframe]:!h-full [&_iframe]:!absolute [&_iframe]:!inset-0"
          />
          {ytMode === "api" && (
            <div
              className="absolute inset-0 z-10 cursor-pointer"
              style={{ background: "rgba(0,0,0,0.001)", pointerEvents: "all" }}
              onContextMenu={e => e.preventDefault()}
              onClick={e => { e.stopPropagation(); handlePlayPause(e); }}
            />
          )}
        </div>
      )}

      {/* YouTube iframe fallback — direct embed, most compatible */}
      {playlistType === "youtube" && ytMode === "iframe" && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}>
          <iframe
            src={ytIframeUrl}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
            allowFullScreen
            className="absolute inset-0 w-full h-full border-0 z-[1]"
            // @ts-ignore
            playsInline=""
          />
        </div>
      )}

      {/* Cloudflare iframe */}
      {playlistType === "cloudflare" && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`} onContextMenu={e => e.preventDefault()}>
          <iframe
            src={playlistUrl}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            className="absolute inset-0 w-full h-full border-0 z-[1]"
            // @ts-ignore
            playsInline=""
          />
        </div>
      )}

      {/* Error display */}
      {playerError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80">
          <div className="text-center p-4">
            <p className="text-destructive text-sm font-medium mb-2">{playerError}</p>
            <button
              onClick={() => { setPlayerError(null); window.location.reload(); }}
              className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* Watermarks */}
      {tokenCode && (<Suspense fallback={null}><Watermark tokenCode={tokenCode} /></Suspense>)}
      {watermarkUrl && (
        <div className="pointer-events-none absolute bottom-12 right-3 z-20">
          <img src={watermarkUrl} alt="" className="h-8 w-auto opacity-40 md:h-10" loading="lazy" />
        </div>
      )}

      {/* Controls bar */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-3 transition-opacity ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onContextMenu={e => e.preventDefault()}
      >
        {/* Play/Pause */}
        <button onClick={handlePlayPause} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/80 text-primary-foreground backdrop-blur-sm transition hover:bg-primary">
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          )}
        </button>

        {/* YT Mute toggle */}
        {playlistType === "youtube" && ytMode === "api" && (
          <button onClick={toggleYtMute} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition hover:bg-white/30" title={ytMuted ? "Unmute" : "Mute"}>
            {ytMuted ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            )}
          </button>
        )}

        {/* LIVE sync button */}
        <button
          onClick={syncToLive}
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition ${isBehindLive ? "bg-red-600 text-white animate-pulse hover:bg-red-700" : "bg-white/20 text-white hover:bg-white/30"}`}
          title="Sync ke Live"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>
          LIVE
        </button>

        <div className="flex-1" />

        {/* Quality selector — only for HLS */}
        {qualities.length > 0 && (
          <div className="relative">
            <button
              onClick={e => { e.stopPropagation(); setShowQualityMenu(prev => !prev); }}
              className="flex h-10 items-center gap-1.5 rounded-full bg-primary/90 px-4 py-2 text-sm font-bold text-primary-foreground backdrop-blur-sm transition hover:bg-primary shadow-lg border border-white/20"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              {qualities.find(q => q.value === selectedQuality)?.label || "Auto"}
            </button>
            {showQualityMenu && (
              <div className="absolute bottom-full right-0 mb-2 rounded-xl bg-black/90 border border-white/20 p-1.5 shadow-2xl backdrop-blur-md min-w-[130px]">
                {qualities.map(q => (
                  <button
                    key={q.value}
                    onClick={e => { e.stopPropagation(); handleQualityChange(q.value); }}
                    className={`block w-full rounded-lg px-4 py-2.5 text-left text-sm font-medium transition ${
                      selectedQuality === q.value
                        ? "bg-primary text-primary-foreground font-bold"
                        : "text-white hover:bg-white/20"
                    }`}
                  >
                    {q.label}
                    {selectedQuality === q.value && " ✓"}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rotate */}
        <button onClick={toggleOrientation} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition hover:bg-white/30" title="Rotate">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
        </button>

        {/* Fullscreen */}
        <button onClick={toggleFullscreen} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition hover:bg-white/30" title="Fullscreen">
          {isFullscreen ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          )}
        </button>
      </div>
    </div>
  );
});

VideoPlayer.displayName = "VideoPlayer";
export default VideoPlayer;
