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
  const [isLoading, setIsLoading] = useState(true);
  const [qualities, setQualities] = useState<{ label: string; value: number }[]>([]);
  const [selectedQuality, setSelectedQuality] = useState(-1);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ytMuted, setYtMuted] = useState(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [isBehindLive, setIsBehindLive] = useState(false);
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

  const youtubeId = useCallback((url: string): string => {
    const decrypted = decryptUrl(url);
    return (decrypted.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^?&/]+)/)?.[1] ?? decrypted).trim();
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
        if (isYTReady()) { ytPlayerRef.current.playVideo(); }
      } else if (videoRef.current) {
        videoRef.current.play().catch(() => {});
      }
    },
    pause: () => {
      if (playlistType === "youtube" && isYTReady()) ytPlayerRef.current.pauseVideo();
      else if (videoRef.current) videoRef.current.pause();
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

  // ══════════════════════════════════════════
  //  HLS / M3U8 — SINGLE SOURCE OF TRUTH
  //  One effect owns the ENTIRE lifecycle
  // ══════════════════════════════════════════

  useEffect(() => {
    if (playlistType !== "m3u8" || !videoRef.current || !playlistUrl) return;
    const video = videoRef.current;
    let mounted = true;

    // 1. Full reset
    cancelAnimationFrame(rafRef.current);
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    video.pause();
    video.removeAttribute("src");
    video.load();
    setIsLoading(true);
    setIsPlaying(false);
    setQualities([]);
    setSelectedQuality(-1);
    setIsBehindLive(false);

    // 2. UI state driven ONLY by native video events
    const done = () => { if (mounted) setIsLoading(false); };
    const onPlay = () => { if (mounted) { setIsPlaying(true); setIsLoading(false); } };
    const onPause = () => { if (mounted) setIsPlaying(false); };

    // Only these events clear loading — NO waiting/stalled/seeking to avoid flicker
    ["loadeddata", "canplay", "playing"].forEach(e => video.addEventListener(e, done));
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    // 3. ReadyState polling — catches cases where events don't fire
    const pollId = window.setInterval(() => {
      if (!mounted) return;
      if (video.readyState >= 2) done();
    }, 300);

    // 4. Hard timeout — absolute last resort (6s)
    const hardTimeout = window.setTimeout(done, 6000);

    // 5. Initialize HLS
    const initHls = async () => {
      const HlsModule = await import("hls.js");
      const Hls = HlsModule.default;
      if (!mounted) return;

      if (!Hls.isSupported()) {
        // Safari native HLS
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = playlistUrl;
          video.addEventListener("loadedmetadata", () => video.play().catch(() => {}), { once: true });
        }
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        capLevelToPlayerSize: true,
        startLevel: -1,
        fragLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 10000,
        fragLoadingTimeOut: 15000,
      });
      hlsRef.current = hls;

      // Levels + autoplay
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!mounted) return;
        const levels = hls.levels.map((l: any, i: number) => ({
          label: `${l.height || 0}p`,
          value: i,
        }));
        setQualities([{ label: "Auto", value: -1 }, ...levels]);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_: any, d: any) => {
        if (mounted) setSelectedQuality(d.level);
      });

      // Error recovery
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (!mounted) return;
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else { hls.destroy(); hlsRef.current = null; }
        } else if (data.details === "bufferStalledError" && video.buffered.length > 0) {
          const end = video.buffered.end(video.buffered.length - 1);
          if (end - video.currentTime > 1) video.currentTime = end - 0.5;
        }
      });

      // CRITICAL ORDER: attach first, then load after MEDIA_ATTACHED
      hls.attachMedia(video);
      hls.once(Hls.Events.MEDIA_ATTACHED, () => {
        if (!mounted) return;
        hls.loadSource(playlistUrl);
      });

      // Behind-live detection
      let lastCheck = 0;
      const syncLoop = (ts: number) => {
        if (!mounted) return;
        rafRef.current = requestAnimationFrame(syncLoop);
        if (ts - lastCheck < 2000) return;
        lastCheck = ts;
        if (video.paused || !hls.liveSyncPosition) return;
        setIsBehindLive(hls.liveSyncPosition - video.currentTime > 8);
      };
      rafRef.current = requestAnimationFrame(syncLoop);

      // Tab visibility recovery
      const onVisible = () => {
        if (!mounted || document.hidden || !hlsRef.current) return;
        hlsRef.current.startLoad();
        if (video.paused) video.play().catch(() => {});
        if (hlsRef.current.liveSyncPosition && hlsRef.current.liveSyncPosition - video.currentTime > 5) {
          video.currentTime = hlsRef.current.liveSyncPosition;
        }
      };
      document.addEventListener("visibilitychange", onVisible);

      // Health check
      const healthId = setInterval(() => {
        if (!mounted || document.hidden || video.paused || !hlsRef.current) return;
        if (video.readyState < 3) hlsRef.current.startLoad();
      }, 15000);

      // Patch destroy for cleanup
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
      mounted = false;
      window.clearTimeout(hardTimeout);
      window.clearInterval(pollId);
      cancelAnimationFrame(rafRef.current);
      ["loadeddata", "canplay", "playing"].forEach(e => video.removeEventListener(e, done));
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [playlistType, playlistUrl]);

  // ══════════════════════════════════════════
  //  YouTube Player
  // ══════════════════════════════════════════

  useEffect(() => {
    if (playlistType !== "youtube" || !playlistUrl) return;
    let destroyed = false;

    // Reset state
    setIsLoading(true);
    setIsPlaying(false);
    setQualities([]);
    setSelectedQuality(-1);
    setYtMode(null);
    setIsBehindLive(false);
    ytReadyRef.current = false;

    const videoId = youtubeId(playlistUrl);
    if (!videoId || videoId.length < 5) {
      console.error("[YT] Could not extract video ID from:", playlistUrl);
      setIsLoading(false);
      return;
    }

    const fallbackTimer = setTimeout(() => {
      if (destroyed || ytReadyRef.current) return;
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
            autoplay: autoPlay ? 1 : 0, mute: 1, enablejsapi: 1, controls: 1,
            disablekb: 1, fs: 0, modestbranding: 1, rel: 0, iv_load_policy: 3,
            playsinline: 1, origin: window.location.origin,
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
                setTimeout(() => { try { ytPlayerRef.current?.unMute?.(); setYtMuted(false); } catch {} }, 1500);
              }
            },
            onStateChange: (e: any) => {
              if (destroyed) return;
              setIsPlaying(e.data === 1);
              setIsLoading(e.data === 3);
            },
            onError: () => {
              if (destroyed) return;
              setYtMode("iframe");
              setIsLoading(false);
            },
          },
        });
      } catch {
        setYtMode("iframe");
        setIsLoading(false);
      }
    };

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
      (window as any).onYouTubeIframeAPIReady = () => { prevReady?.(); clearInterval(check); if (!destroyed) createPlayer(); };
      setTimeout(() => clearInterval(check), 10000);
    }

    return () => {
      destroyed = true;
      ytReadyRef.current = false;
      clearTimeout(fallbackTimer);
      try { ytPlayerRef.current?.destroy?.(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [playlistUrl, playlistType, autoPlay, youtubeId]);

  // YouTube fallback iframe
  useEffect(() => {
    if (playlistType !== "youtube" || ytMode !== "iframe") return;
    const container = ytFallbackRef.current;
    if (!container) return;
    const videoId = youtubeId(playlistUrl);
    container.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.src = buildYtEmbedUrl(videoId);
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share";
    iframe.allowFullscreen = true;
    iframe.setAttribute("playsinline", "");
    iframe.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;border:0;z-index:1;";
    container.appendChild(iframe);
  }, [playlistType, playlistUrl, ytMode, youtubeId, buildYtEmbedUrl]);

  // ══════════════════════════════════════════
  //  Cloudflare Player
  // ══════════════════════════════════════════

  useEffect(() => {
    if (playlistType !== "cloudflare" || !playlistUrl) return;
    setIsLoading(true);
    setIsPlaying(false);
    setQualities([]);
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

  const handlePlayPause = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlistType === "youtube") {
      if (ytMode === "iframe") return;
      if (!isYTReady()) return;
      try {
        const state = ytPlayerRef.current.getPlayerState();
        if (state === 1 || state === 3) ytPlayerRef.current.pauseVideo();
        else ytPlayerRef.current.playVideo();
      } catch {}
    } else if (playlistType === "cloudflare") {
      // iframe has its own controls
    } else {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    }
  }, [playlistType, ytMode, isYTReady]);

  const handleQualityChange = useCallback((level: number) => {
    if (!hlsRef.current) return;
    const hls = hlsRef.current;
    hls.currentLevel = level;
    hls.nextLevel = level;
    if (level === -1) {
      hls.currentLevel = -1;
      // Re-enable ABR
      try { hls.autoLevelEnabled = true; } catch {}
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
      if (videoRef.current.paused) videoRef.current.play().catch(() => {});
      setIsBehindLive(false);
    } else if (playlistType === "youtube" && isYTReady()) {
      try { const d = ytPlayerRef.current.getDuration?.(); if (d > 0) ytPlayerRef.current.seekTo(d, true); } catch {}
      ytPlayerRef.current.playVideo();
    }
  }, [playlistType, isYTReady]);

  // Fullscreen listener
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => { document.removeEventListener("fullscreenchange", onFsChange); document.removeEventListener("webkitfullscreenchange", onFsChange); };
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
            onClick={e => { e.stopPropagation(); handlePlayPause(e); }}
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
          onClick={handlePlayPause}
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
        <button onClick={handlePlayPause} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/80 text-primary-foreground backdrop-blur-sm transition hover:bg-primary">
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
              {qualities.find(q => q.value === selectedQuality)?.label || "Auto"}
            </button>
            {showQualityMenu && (
              <div className="absolute bottom-full right-0 mb-2 rounded-xl bg-card border-2 border-primary/30 p-1.5 shadow-2xl backdrop-blur-md min-w-[130px]">
                {qualities.map(q => (
                  <button
                    key={q.value}
                    onClick={e => { e.stopPropagation(); handleQualityChange(q.value); }}
                    className={`block w-full rounded-lg px-4 py-2.5 text-left text-sm font-medium transition ${
                      selectedQuality === q.value
                        ? "bg-primary text-primary-foreground font-bold"
                        : "text-foreground hover:bg-secondary"
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
