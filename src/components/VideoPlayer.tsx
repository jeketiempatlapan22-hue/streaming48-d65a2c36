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
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isLoading, setIsLoading] = useState(true);
  const [qualities, setQualities] = useState<{ label: string; level: number }[]>([]);
  const [selectedQuality, setSelectedQuality] = useState(-1);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ytMuted, setYtMuted] = useState(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [isBehindLive, setIsBehindLive] = useState(false);

  // YouTube can use fallback iframe or IFrame API
  const [ytMode, setYtMode] = useState<"api" | "iframe" | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef(false);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytFallbackRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cfContainerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const rafRef = useRef(0);

  const playlistUrl = playlist.url;
  const playlistType = playlist.type;

  // ── Helpers ──

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
    const match = decrypted.match(/(?:youtu\.be\/|v=|\/embed\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(decrypted)) return decrypted;
    return decrypted;
  }, [decryptUrl]);

  const buildYtEmbedUrl = useCallback((videoId: string) => {
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&controls=1&fs=0&iv_load_policy=3&origin=${encodeURIComponent(window.location.origin)}`;
  }, []);

  const isYTReady = useCallback(() => {
    const p = ytPlayerRef.current;
    return p && ytReadyRef.current && typeof p.getPlayerState === "function";
  }, []);

  // ── Imperative Handle ──

  useImperativeHandle(ref, () => ({
    play: () => {
      if (playlistType === "youtube") {
        if (ytMode === "iframe") return;
        if (isYTReady()) { ytPlayerRef.current.playVideo(); setIsPlaying(true); }
      } else if (playlistType === "cloudflare") {
        setIsPlaying(true);
      } else if (videoRef.current) {
        if (playlistType === "m3u8" && hlsRef.current?.liveSyncPosition) {
          videoRef.current.currentTime = hlsRef.current.liveSyncPosition;
        }
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    },
    pause: () => {
      if (playlistType === "youtube" && isYTReady()) { ytPlayerRef.current.pauseVideo(); setIsPlaying(false); }
      else if (videoRef.current) { videoRef.current.pause(); setIsPlaying(false); }
    },
    seekTo: (time: number) => {
      if (playlistType === "youtube" && isYTReady()) ytPlayerRef.current.seekTo(time, true);
      else if (videoRef.current) videoRef.current.currentTime = time;
    },
    getCurrentTime: () => {
      if (playlistType === "youtube" && isYTReady()) { try { return ytPlayerRef.current.getCurrentTime() || 0; } catch { return 0; } }
      return videoRef.current?.currentTime || 0;
    },
  }), [playlistType, isYTReady, ytMode]);

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

  // ── Master reset on playlist change (non-m3u8 types only) ──
  // M3U8 handles its own full lifecycle to avoid race conditions.

  useEffect(() => {
    if (playlistType === "m3u8") return; // m3u8 manages itself
    setIsLoading(true);
    setIsPlaying(false);
    setQualities([]);
    setSelectedQuality(-1);
    setYtMode(null);
    setIsBehindLive(false);
    ytReadyRef.current = false;

    return () => {
      cancelAnimationFrame(rafRef.current);
      try { ytPlayerRef.current?.destroy?.(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [playlistUrl, playlistType]);

  // ══════════════════════════════════════════
  //  HLS / M3U8 Player — single self-contained effect
  //  Owns the full lifecycle: reset → attach → load → play → cleanup
  // ══════════════════════════════════════════

  useEffect(() => {
    if (playlistType !== "m3u8" || !playlistUrl) return;
    const vid = videoRef.current;
    if (!vid) return;
    let destroyed = false;

    // ─── 1. Reset everything ───
    setIsLoading(true);
    setIsPlaying(false);
    setQualities([]);
    setSelectedQuality(-1);
    setIsBehindLive(false);
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    vid.pause();
    vid.removeAttribute("src");
    vid.load();

    // ─── 2. Wire up media events for UI state ───
    const onReady = () => { if (!destroyed) setIsLoading(false); };
    const onPlay = () => { if (!destroyed) { setIsPlaying(true); setIsLoading(false); } };
    const onPause = () => { if (!destroyed) setIsPlaying(false); };
    const onWait = () => { if (!destroyed) setIsLoading(true); };

    const allEvents: [string, EventListener][] = [
      ["loadeddata", onReady], ["canplay", onReady], ["canplaythrough", onReady], ["playing", onPlay],
      ["play", onPlay], ["pause", onPause], ["ended", onPause],
      ["waiting", onWait], ["stalled", onWait], ["seeking", onWait],
    ];
    allEvents.forEach(([evt, fn]) => vid.addEventListener(evt, fn));

    // Hard timeout — absolute last resort
    const hardTimeout = window.setTimeout(() => { if (!destroyed) setIsLoading(false); }, 10000);

    // ─── 3. Initialize HLS ───
    let hls: any = null;

    const initHls = async () => {
      const HlsModule = await import("hls.js");
      const Hls = HlsModule.default;
      if (destroyed) return;

      // Safari / iOS native HLS
      if (!Hls.isSupported()) {
        if (vid.canPlayType("application/vnd.apple.mpegurl")) {
          vid.src = playlistUrl;
          if (autoPlay) { vid.muted = true; vid.play().catch(() => {}); }
        }
        return;
      }

      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        capLevelToPlayerSize: true,
        startLevel: -1,
        liveDurationInfinity: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        maxLiveSyncPlaybackRate: 1.02,
        liveBackBufferLength: 15,
        backBufferLength: 30,
        maxBufferLength: 20,
        maxMaxBufferLength: 30,
        maxBufferSize: 30 * 1024 * 1024,
        maxBufferHole: 0.5,
        abrBandWidthFactor: 0.7,
        abrBandWidthUpFactor: 0.5,
        abrEwmaDefaultEstimate: 1_000_000,
        startFragPrefetch: true,
        progressive: true,
        fragLoadingMaxRetry: 10,
        levelLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        manifestLoadingRetryDelay: 1000,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 30000,
        manifestLoadingTimeOut: 12000,
        levelLoadingTimeOut: 12000,
        fragLoadingTimeOut: 20000,
        debug: false,
      });
      hlsRef.current = hls;

      // CRITICAL ORDER: attachMedia FIRST, then loadSource after MEDIA_ATTACHED
      hls.attachMedia(vid);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (destroyed) return;
        hls.loadSource(playlistUrl);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (destroyed) return;
        const levels = hls.levels.map((l: any, i: number) => ({ label: `${l.height}p`, level: i }));
        setQualities([{ label: "Auto", level: -1 }, ...levels]);
        setSelectedQuality(-1);
        // Don't set isLoading false here — let the video element events handle it
        if (autoPlay) {
          vid.muted = true;
          vid.play().then(() => {
            setTimeout(() => { if (!destroyed && vid) vid.muted = false; }, 800);
          }).catch(() => {});
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_: any, data: any) => {
        if (!destroyed) setSelectedQuality(data.level);
      });

      // Behind-live detection (throttled to every 2s via rAF)
      let lastCheck = 0;
      const syncLoop = (ts: number) => {
        if (destroyed) return;
        rafRef.current = requestAnimationFrame(syncLoop);
        if (ts - lastCheck < 2000) return;
        lastCheck = ts;
        if (vid.paused || !hls || !hls.liveSyncPosition) return;
        const behind = hls.liveSyncPosition - vid.currentTime > 8;
        setIsBehindLive(behind);
      };
      rafRef.current = requestAnimationFrame(syncLoop);

      // Error recovery
      let fatalRetries = 0;
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (destroyed) return;
        if (!data.fatal) {
          // Nudge past buffer stalls
          if (data.details === "bufferStalledError" && vid.buffered.length > 0) {
            const end = vid.buffered.end(vid.buffered.length - 1);
            if (end - vid.currentTime > 1) vid.currentTime = end - 0.5;
          }
          return;
        }
        setIsLoading(false); // Never stay stuck
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setTimeout(() => { if (!destroyed && hls) hls.startLoad(); }, 1000);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else if (fatalRetries++ < 3) {
          hls.destroy();
          hlsRef.current = null;
          setTimeout(() => { if (!destroyed) initHls(); }, 2000);
        }
      });

      // Tab visibility recovery
      const onVisible = () => {
        if (destroyed || document.hidden || !hls) return;
        hls.startLoad();
        if (vid.paused) vid.play().catch(() => {});
        if (hls.liveSyncPosition && hls.liveSyncPosition - vid.currentTime > 5) {
          vid.currentTime = hls.liveSyncPosition;
        }
      };
      document.addEventListener("visibilitychange", onVisible);

      // Health check every 15s
      const healthId = setInterval(() => {
        if (destroyed || document.hidden || vid.paused || !hls) return;
        if (vid.readyState < 3) hls.startLoad();
      }, 15000);

      // Patch destroy to clean up extras
      const origDestroy = hls.destroy.bind(hls);
      hls.destroy = () => {
        cancelAnimationFrame(rafRef.current);
        clearInterval(healthId);
        document.removeEventListener("visibilitychange", onVisible);
        origDestroy();
      };
    };

    initHls();

    return () => {
      destroyed = true;
      window.clearTimeout(hardTimeout);
      cancelAnimationFrame(rafRef.current);
      allEvents.forEach(([evt, fn]) => vid.removeEventListener(evt, fn));
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [playlistUrl, playlistType, autoPlay]);

  // ══════════════════════════════════════════
  //  YouTube Player
  // ══════════════════════════════════════════

  useEffect(() => {
    if (playlistType !== "youtube" || !playlistUrl) return;
    let destroyed = false;
    const videoId = extractVideoId(playlistUrl);

    if (!videoId || videoId.length < 5) {
      console.error("[YT] Could not extract video ID from:", playlistUrl);
      setIsLoading(false);
      return;
    }

    // Fallback timer: if YT API doesn't load in 6s, use plain iframe
    const fallbackTimer = setTimeout(() => {
      if (destroyed || ytReadyRef.current) return;
      console.warn("[YT] API timeout, using iframe fallback");
      setYtMode("iframe");
      setIsLoading(false);
      setIsPlaying(autoPlay);
    }, 6000);

    const createPlayer = () => {
      if (destroyed) return;
      const container = ytContainerRef.current;
      if (!container) { setYtMode("iframe"); setIsLoading(false); return; }
      container.innerHTML = "";
      const div = document.createElement("div");
      div.id = `yt_${Math.random().toString(36).slice(2, 8)}`;
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
            origin: window.location.origin,
          },
          events: {
            onReady: (e: any) => {
              if (destroyed) return;
              ytReadyRef.current = true;
              clearTimeout(fallbackTimer);
              setYtMode("api");
              setIsLoading(false);
              if (autoPlay) {
                e.target.playVideo();
                setIsPlaying(true);
                setYtMuted(true);
                setTimeout(() => {
                  try { ytPlayerRef.current?.unMute?.(); setYtMuted(false); } catch {}
                }, 1500);
              }
            },
            onStateChange: (e: any) => {
              if (destroyed) return;
              setIsPlaying(e.data === 1);
              if (e.data === 3) setIsLoading(true);
              else setIsLoading(false);
            },
            onError: () => {
              if (destroyed) return;
              console.warn("[YT] Player error, switching to iframe");
              setYtMode("iframe");
              setIsLoading(false);
            },
          },
        });
      } catch (err) {
        console.error("[YT] Failed to create player:", err);
        setYtMode("iframe");
        setIsLoading(false);
      }
    };

    // Load YT IFrame API
    if ((window as any).YT?.Player) {
      createPlayer();
    } else {
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.onerror = () => { if (!destroyed) { setYtMode("iframe"); setIsLoading(false); } };
        document.head.appendChild(tag);
      }
      const check = setInterval(() => {
        if (destroyed) { clearInterval(check); return; }
        if ((window as any).YT?.Player) { clearInterval(check); createPlayer(); }
      }, 200);
      const prevReady = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        prevReady?.();
        clearInterval(check);
        if (!destroyed) createPlayer();
      };
      setTimeout(() => clearInterval(check), 10000);
    }

    return () => {
      destroyed = true;
      ytReadyRef.current = false;
      clearTimeout(fallbackTimer);
      try { ytPlayerRef.current?.destroy?.(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [playlistUrl, playlistType, autoPlay, extractVideoId]);

  // YouTube fallback iframe rendering
  useEffect(() => {
    if (playlistType !== "youtube" || ytMode !== "iframe") return;
    const container = ytFallbackRef.current;
    if (!container) return;
    const videoId = extractVideoId(playlistUrl);
    container.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.src = buildYtEmbedUrl(videoId);
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share";
    iframe.allowFullscreen = true;
    iframe.setAttribute("playsinline", "");
    iframe.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;border:0;z-index:1;";
    container.appendChild(iframe);
  }, [playlistType, playlistUrl, ytMode, extractVideoId, buildYtEmbedUrl]);

  // ══════════════════════════════════════════
  //  Cloudflare Player
  // ══════════════════════════════════════════

  useEffect(() => {
    if (playlistType !== "cloudflare" || !playlistUrl) return;
    setIsLoading(true);
    const container = cfContainerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const iframe = document.createElement("iframe");
    iframe.src = playlistUrl;
    iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    iframe.allowFullscreen = true;
    iframe.setAttribute("playsinline", "");
    iframe.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;border:0;z-index:1;";
    iframe.addEventListener("load", () => setIsLoading(false), { once: true });
    iframe.addEventListener("error", () => setIsLoading(false), { once: true });
    container.appendChild(iframe);

    const t = setTimeout(() => setIsLoading(false), 8000);
    return () => clearTimeout(t);
  }, [playlistType, playlistUrl]);

  // ── Control handlers ──

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlistType === "youtube") {
      if (ytMode === "iframe") return; // iframe has its own controls
      if (!isYTReady()) return;
      try {
        const state = ytPlayerRef.current.getPlayerState();
        if (state === 1 || state === 3) { ytPlayerRef.current.pauseVideo(); setIsPlaying(false); }
        else { ytPlayerRef.current.playVideo(); setIsPlaying(true); }
      } catch {}
    } else if (playlistType === "cloudflare") {
      // Cloudflare iframe has built-in controls
    } else if (videoRef.current) {
      const v = videoRef.current;
      if (v.paused) {
        if (playlistType === "m3u8" && hlsRef.current?.liveSyncPosition) {
          v.currentTime = hlsRef.current.liveSyncPosition;
        }
        v.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      } else {
        v.pause();
        setIsPlaying(false);
      }
    }
  }, [playlistType, ytMode, isYTReady]);

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

  const changeQuality = useCallback((level: number) => {
    if (!hlsRef.current) return;
    const hls = hlsRef.current;
    if (level === -1) {
      // Auto mode
      hls.currentLevel = -1;
      hls.nextLevel = -1;
    } else {
      // Manual level lock
      hls.currentLevel = level;
      hls.nextLevel = level;
    }
    setSelectedQuality(level);
    setShowQualityMenu(false);
  }, []);

  const toggleYtMute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!isYTReady()) return;
    try {
      if (ytPlayerRef.current.isMuted()) { ytPlayerRef.current.unMute(); setYtMuted(false); }
      else { ytPlayerRef.current.mute(); setYtMuted(true); }
    } catch {}
  }, [isYTReady]);

  const syncToLive = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlistType === "m3u8" && hlsRef.current && videoRef.current) {
      const hls = hlsRef.current;
      if (hls.liveSyncPosition) videoRef.current.currentTime = hls.liveSyncPosition;
      else if (videoRef.current.buffered.length > 0) {
        videoRef.current.currentTime = videoRef.current.buffered.end(videoRef.current.buffered.length - 1) - 0.5;
      }
      if (videoRef.current.paused) { videoRef.current.play().catch(() => {}); setIsPlaying(true); }
      setIsBehindLive(false);
    } else if (playlistType === "youtube" && isYTReady()) {
      try { const d = ytPlayerRef.current.getDuration?.(); if (d > 0) ytPlayerRef.current.seekTo(d, true); } catch {}
      ytPlayerRef.current.playVideo();
      setIsPlaying(true);
    }
  }, [playlistType, isYTReady]);

  // Fullscreen change listener
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => { document.removeEventListener("fullscreenchange", onFsChange); document.removeEventListener("webkitfullscreenchange", onFsChange); };
  }, []);

  // Block DevTools shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F12" || (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) || (e.ctrlKey && e.key === "u") || (e.ctrlKey && e.key === "s")) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  // ── Render ──

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-card ${isFullscreen ? "flex items-center justify-center !h-screen" : "aspect-video"}`}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
    >
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="h-12 w-12 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
              <svg className="absolute inset-0 m-auto h-5 w-5 text-primary" viewBox="0 0 24 24" fill="currentColor"><polygon points="9.5,7.5 16.5,12 9.5,16.5"/></svg>
            </div>
            <p className="text-sm text-muted-foreground animate-pulse">Menghubungkan...</p>
          </div>
        </div>
      )}

      {/* YouTube API player */}
      {playlistType === "youtube" && ytMode !== "iframe" && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}>
          <div ref={ytContainerRef} className="absolute inset-0 w-full h-full [&>div]:!w-full [&>div]:!h-full [&>iframe]:!w-full [&>iframe]:!h-full [&>div>iframe]:!w-full [&>div>iframe]:!h-full [&_iframe]:!w-full [&_iframe]:!h-full [&_iframe]:!absolute [&_iframe]:!inset-0" />
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.001)", pointerEvents: "all" }}
            onContextMenu={e => e.preventDefault()}
            onClick={e => { e.stopPropagation(); togglePlay(e); }}
          />
        </div>
      )}

      {/* YouTube iframe fallback */}
      {playlistType === "youtube" && ytMode === "iframe" && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}>
          <div ref={ytFallbackRef} className="absolute inset-0 w-full h-full" />
        </div>
      )}

      {/* HLS / M3U8 video element */}
      {playlistType === "m3u8" && (
        <video
          ref={videoRef}
          onClick={togglePlay}
          className={`h-full w-full object-contain cursor-pointer ${isFullscreen ? "max-h-screen" : "absolute inset-0"}`}
          playsInline
          // @ts-ignore
          webkit-playsinline=""
          x-webkit-airplay="allow"
          preload="auto"
        />
      )}

      {/* Cloudflare iframe */}
      {playlistType === "cloudflare" && (
        <div ref={cfContainerRef} className={`h-full w-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`} onContextMenu={e => e.preventDefault()} />
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
        className={`absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-background/80 to-transparent p-3 transition-opacity ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onContextMenu={e => e.preventDefault()}
      >
        {/* Play/Pause */}
        <button onClick={togglePlay} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/80 text-primary-foreground backdrop-blur-sm transition hover:bg-primary">
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          )}
        </button>

        {/* YT Mute toggle */}
        {playlistType === "youtube" && ytMode === "api" && (
          <button onClick={toggleYtMute} className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground backdrop-blur-sm transition hover:bg-secondary" title={ytMuted ? "Unmute" : "Mute"}>
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
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition ${isBehindLive ? "bg-destructive/90 text-destructive-foreground animate-pulse hover:bg-destructive" : "bg-secondary/80 text-secondary-foreground hover:bg-secondary"}`}
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
              className="flex h-10 items-center gap-1.5 rounded-full bg-primary/90 px-4 py-2 text-sm font-bold text-primary-foreground backdrop-blur-sm transition hover:bg-primary shadow-lg border border-primary-foreground/20"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              {qualities.find(q => q.level === selectedQuality)?.label || "Auto"}
            </button>
            {showQualityMenu && (
              <div className="absolute bottom-full right-0 mb-2 rounded-xl bg-card border-2 border-primary/30 p-1.5 shadow-2xl backdrop-blur-md min-w-[130px]">
                {qualities.map(q => (
                  <button
                    key={q.level}
                    onClick={e => { e.stopPropagation(); changeQuality(q.level); }}
                    className={`block w-full rounded-lg px-4 py-2.5 text-left text-sm font-medium transition ${
                      selectedQuality === q.level
                        ? "bg-primary text-primary-foreground font-bold"
                        : "text-foreground hover:bg-secondary"
                    }`}
                  >
                    {q.label}
                    {selectedQuality === q.level && " ✓"}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Rotate */}
        <button onClick={toggleOrientation} className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground backdrop-blur-sm transition hover:bg-secondary" title="Rotate">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
        </button>

        {/* Fullscreen */}
        <button onClick={toggleFullscreen} className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground backdrop-blur-sm transition hover:bg-secondary" title="Fullscreen">
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
