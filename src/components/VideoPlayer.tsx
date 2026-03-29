import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo, useCallback, lazy, Suspense } from "react";

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
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitchingQuality, setIsSwitchingQuality] = useState(false);
  const [qualities, setQualities] = useState<{ label: string; index: number; ytKey?: string }[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ytMuted, setYtMuted] = useState(true); // Start muted for autoplay compliance
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [ytFallback, setYtFallback] = useState(false);
  const [iframeRefreshKey, setIframeRefreshKey] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef(false);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hlsInitRef = useRef(false);
  const ytFallbackTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const ytFallbackContainerRef = useRef<HTMLDivElement>(null);
  const cfContainerRef = useRef<HTMLDivElement>(null);
  

  // Stable references to avoid re-triggering effects on every render
  const playlistUrl = playlist.url;
  const playlistType = playlist.type;

  const isYTReady = useCallback(() => {
    const p = ytPlayerRef.current;
    return p && ytReadyRef.current && typeof p.getPlayerState === "function" && typeof p.playVideo === "function";
  }, []);

  useImperativeHandle(ref, () => ({
    play: () => {
      if (playlistType === "youtube") {
        if (ytFallback) {
          setIframeRefreshKey(k => k + 1);
          setIsPlaying(true);
          return;
        }
        if (isYTReady()) {
          const player = ytPlayerRef.current;
          try {
            const duration = player.getDuration?.();
            if (duration && duration > 0) player.seekTo(duration, true);
          } catch {}
          player.playVideo();
          setIsPlaying(true);
        }
      } else if (playlistType === "cloudflare") {
        setIframeRefreshKey(k => k + 1);
        setIsPlaying(true);
      } else if (playlistType === "m3u8" && hlsRef.current && videoRef.current) {
        if (hlsRef.current.liveSyncPosition) {
          videoRef.current.currentTime = hlsRef.current.liveSyncPosition;
        }
        videoRef.current.play();
        setIsPlaying(true);
      } else if (videoRef.current) {
        videoRef.current.play();
        setIsPlaying(true);
      }
    },
    pause: () => {
      if (playlistType === "youtube" && isYTReady()) {
        ytPlayerRef.current.pauseVideo();
        setIsPlaying(false);
      } else if (videoRef.current) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    },
    seekTo: (time: number) => {
      if (playlistType === "youtube" && isYTReady()) {
        ytPlayerRef.current.seekTo(time, true);
      } else if (videoRef.current) {
        videoRef.current.currentTime = time;
      }
    },
    getCurrentTime: () => {
      if (playlistType === "youtube" && isYTReady()) {
        try { return ytPlayerRef.current.getCurrentTime() || 0; } catch { return 0; }
      }
      return videoRef.current?.currentTime || 0;
    },
  }), [playlistType, isYTReady, ytFallback]);

  // Hide controls after 3s
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

  // Cleanup on playlist change
  useEffect(() => {
    hlsInitRef.current = false;
    setYtFallback(false);
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playlistUrl, playlistType]);

  const obfuscate = useCallback((str: string) => btoa(unescape(encodeURIComponent(str))), []);
  const deobfuscate = useCallback((str: string) => decodeURIComponent(escape(atob(str))), []);

  // XOR decrypt for server-encrypted YouTube URLs
  const decryptUrl = useCallback((encoded: string): string => {
    if (!encoded.startsWith("enc:")) return encoded;
    const b64 = encoded.slice(4);
    const _k = [82,84,52,56,120,75,57,109,81,50,118,76,55,110,80,52];
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      result[i] = bytes[i] ^ _k[i % _k.length];
    }
    return new TextDecoder().decode(result);
  }, []);

  // Helper: create iframe imperatively
  const createProtectedIframe = useCallback((container: HTMLElement, url: string, opts: { allow?: string; allowFullscreen?: boolean; className?: string }) => {
    container.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.setAttribute("allow", opts.allow || "");
    if (opts.allowFullscreen) iframe.allowFullscreen = true;
    iframe.setAttribute("playsinline", "");
    iframe.setAttribute("webkit-playsinline", "");
    iframe.setAttribute("loading", "eager");
    iframe.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;border:0;z-index:1;";
    iframe.src = url;
    container.appendChild(iframe);
    return iframe;
  }, []);

  // Extract YouTube video ID from any format
  const extractVideoId = useCallback((url: string): string => {
    const decrypted = decryptUrl(url);
    const match = decrypted.match(/(?:youtu\.be\/|v=|\/embed\/|\/v\/)([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    // If it's already an 11-char ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(decrypted)) return decrypted;
    return decrypted;
  }, [decryptUrl]);

  // Init HLS for m3u8
  useEffect(() => {
    if (playlistType !== "m3u8" || !videoRef.current || hlsInitRef.current) return;
    hlsInitRef.current = true;
    let destroyed = false;
    let hls: any = null;
    setIsLoading(true);

    const initHls = async () => {
      const Hls = (await import("hls.js")).default;
      if (destroyed) return;
      const decodedUrl = deobfuscate(obfuscate(playlistUrl));
      if (!Hls.isSupported()) {
        videoRef.current!.src = decodedUrl;
        setIsLoading(false);
        if (autoPlay) videoRef.current!.play().catch(() => {});
        return;
      }
      hls = new Hls({
        enableWorker: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5,
        liveDurationInfinity: true,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        maxBufferSize: 15 * 1000 * 1000,
        maxBufferHole: 0.3,
        backBufferLength: 10,
        abrEwmaDefaultEstimate: 500_000,
        abrEwmaDefaultEstimateMax: 5_000_000,
        abrBandWidthFactor: 0.95,
        abrBandWidthUpFactor: 0.7,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 8000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        startFragPrefetch: true,
        testBandwidth: true,
        progressive: false,
        lowLatencyMode: false,
        capLevelToPlayerSize: true,
        capLevelOnFPSDrop: true,
        fpsDroppedMonitoringPeriod: 5000,
        fpsDroppedMonitoringThreshold: 0.3,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 5,
        debug: false,
      });
      hlsRef.current = hls;
      hls.loadSource(decodedUrl);
      hls.attachMedia(videoRef.current!);


      hls.on(Hls.Events.MANIFEST_PARSED, (_: any, data: any) => {
        if (destroyed) return;
        const levels = data.levels.map((l: any, i: number) => ({
          label: `${l.height}p`,
          index: i,
        }));
        setQualities([{ label: "Auto", index: -1 }, ...levels]);
        hls.currentLevel = -1;
        setCurrentQuality(-1);
        setIsLoading(false);
        if (autoPlay) {
          videoRef.current!.muted = true;
          videoRef.current!.play().then(() => {
            // Unmute after autoplay succeeds
            setTimeout(() => {
              if (!destroyed && videoRef.current) {
                videoRef.current.muted = false;
              }
            }, 500);
          }).catch(() => {});
          setIsPlaying(true);
        }
      });
      hls.on(Hls.Events.LEVEL_SWITCHING, () => { if (!destroyed) setIsSwitchingQuality(true); });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => { if (!destroyed) setIsSwitchingQuality(false); });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { if (!destroyed) setIsSwitchingQuality(false); });

      // Stall recovery: if video stalls, nudge it forward
      let stallCheckInterval: any = null;
      const startStallCheck = () => {
        if (stallCheckInterval) clearInterval(stallCheckInterval);
        stallCheckInterval = setInterval(() => {
          if (destroyed || !videoRef.current || !hls) return;
          const vid = videoRef.current;
          if (!vid.paused && vid.readyState >= 2 && vid.buffered.length > 0) {
            const currentTime = vid.currentTime;
            const bufferedEnd = vid.buffered.end(vid.buffered.length - 1);
            // If we have buffer ahead but playback is stuck
            if (bufferedEnd - currentTime > 1 && vid.playbackRate === 0) {
              vid.currentTime = currentTime + 0.1;
            }
            // For live streams, sync to live edge if too far behind
            if (hls.liveSyncPosition && (hls.liveSyncPosition - currentTime > 15)) {
              vid.currentTime = hls.liveSyncPosition;
            }
          }
        }, 3000);
      };
      startStallCheck();

      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (destroyed) return;
        setIsLoading(false);
        setIsSwitchingQuality(false);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn("[HLS] Network error, retrying...");
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn("[HLS] Media error, recovering...");
              hls.recoverMediaError();
              break;
            default:
              console.warn("[HLS] Fatal error, reinitializing...");
              hls.destroy();
              hlsRef.current = null;
              hlsInitRef.current = false;
              setTimeout(() => { if (!destroyed) initHls(); }, 2000);
              break;
          }
        } else if (data.details === 'bufferStalledError') {
          // Non-fatal stall: try to recover
          if (videoRef.current && hls.liveSyncPosition) {
            videoRef.current.currentTime = hls.liveSyncPosition;
          }
        }
      });

      // Cleanup stall checker
      const origDestroy = hls.destroy.bind(hls);
      hls.destroy = () => {
        clearInterval(stallCheckInterval);
        origDestroy();
      };
    };
    initHls();
    return () => {
      destroyed = true;
      if (hls) { hls.destroy(); hlsRef.current = null; }
    };
  }, [playlistUrl, playlistType, autoPlay, obfuscate, deobfuscate]);

  // Load YouTube IFrame API with fallback to direct iframe
  useEffect(() => {
    if (playlistType !== "youtube") return;
    let destroyed = false;

    const videoId = extractVideoId(playlistUrl);

    // Fallback: if YT API doesn't fire onReady within 3 seconds, use direct iframe
    ytFallbackTimerRef.current = setTimeout(() => {
      if (destroyed || ytReadyRef.current) return;
      console.warn("[VideoPlayer] YT IFrame API timeout, switching to direct iframe embed");
      setYtFallback(true);
      setIsLoading(false);
      setIsPlaying(autoPlay);
    }, 3000);

    const loadYTApi = () => {
      if ((window as any).YT && (window as any).YT.Player) {
        createYTPlayer();
        return;
      }
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.onerror = () => {
          if (!destroyed) {
            console.warn("[VideoPlayer] YT API script failed to load, using direct iframe");
            setYtFallback(true);
            setIsLoading(false);
          }
        };
        document.head.appendChild(tag);
      }
      // If API was already loaded by another instance but callback already fired
      const checkInterval = setInterval(() => {
        if (destroyed) { clearInterval(checkInterval); return; }
        if ((window as any).YT && (window as any).YT.Player) {
          clearInterval(checkInterval);
          createYTPlayer();
        }
      }, 200);
      // Also set the callback for fresh loads
      (window as any).onYouTubeIframeAPIReady = () => {
        clearInterval(checkInterval);
        if (!destroyed) createYTPlayer();
      };
      // Cleanup interval after 3s
      setTimeout(() => clearInterval(checkInterval), 3500);
    };

    const createYTPlayer = () => {
      if (destroyed || ytFallback) return;
      const container = ytContainerRef.current;
      if (!container) {
        console.warn("[VideoPlayer] ytContainerRef is null, falling back to iframe");
        setYtFallback(true);
        setIsLoading(false);
        return;
      }
      container.innerHTML = "";
      const playerDiv = document.createElement("div");
      playerDiv.id = `_p${Math.random().toString(36).slice(2, 10)}`;
      container.appendChild(playerDiv);

      try {
        ytPlayerRef.current = new (window as any).YT.Player(playerDiv, {
          width: "100%",
          height: "100%",
          videoId,
          playerVars: {
            autoplay: autoPlay ? 1 : 0,
            mute: 1,
            enablejsapi: 1,
            controls: 0, // Hide native controls, use custom controls
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            showinfo: 0,
          },
          events: {
            onReady: (e: any) => {
              if (destroyed) return;
              ytReadyRef.current = true;
              setIsLoading(false);
              clearTimeout(ytFallbackTimerRef.current);

              try {
                const ytQuals = e.target.getAvailableQualityLevels?.() || [];
                if (ytQuals.length > 0) {
                  e.target.setPlaybackQuality(ytQuals[0]);
                }
              } catch {}

              const releaseQuality = () => {
                try {
                  if (ytPlayerRef.current && typeof ytPlayerRef.current.setPlaybackQuality === 'function') {
                    ytPlayerRef.current.setPlaybackQuality('default');
                  }
                } catch {}
              };
              const fallbackTimer = setTimeout(releaseQuality, 8000);
              (e.target as any).__releaseQuality = releaseQuality;
              (e.target as any).__fallbackTimer = fallbackTimer;

              try {
                const iframe = container.querySelector("iframe");
                if (iframe) iframe.removeAttribute("title");
              } catch {}

              if (autoPlay) {
                e.target.playVideo();
                setIsPlaying(true);
                setYtMuted(true);
                // Auto-unmute after a short delay
                setTimeout(() => {
                  try {
                    if (ytPlayerRef.current && typeof ytPlayerRef.current.unMute === 'function') {
                      ytPlayerRef.current.unMute();
                      setYtMuted(false);
                    }
                  } catch {}
                }, 1500);
              }
            },
            onStateChange: (e: any) => {
              if (destroyed) return;
              const state = e.data;
              setIsPlaying(state === 1);
              setIsLoading(state === 3);

              if (state === 3) {
                const bufferTimeout = setTimeout(() => {
                  if (destroyed) return;
                  try {
                    const p = ytPlayerRef.current;
                    if (p && typeof p.getPlayerState === "function" && p.getPlayerState() === 3) {
                      (p as any).__releaseQuality?.();
                    }
                  } catch {}
                }, 4000);
                (e.target as any).__bufferTimeout = bufferTimeout;
              } else {
                clearTimeout((e.target as any).__bufferTimeout);
              }
            },
            onError: (e: any) => {
              if (destroyed) return;
              console.warn("YT Player error code:", e.data);
              setIsLoading(false);
              // On error, fall back to direct iframe
              setYtFallback(true);
            },
          },
        });
      } catch (err) {
        console.warn("Failed to create YT player:", err);
        setIsLoading(false);
        setYtFallback(true);
      }
    };

    loadYTApi();
    return () => {
      destroyed = true;
      ytReadyRef.current = false;
      clearTimeout(ytFallbackTimerRef.current);
      try { if (ytPlayerRef.current?.destroy) ytPlayerRef.current.destroy(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [playlistUrl, playlistType, autoPlay, extractVideoId]);

  // Cloudflare: imperatively create protected iframe
  // If URL is a proxy URL (from stream-proxy), use it directly
  // If URL is a direct Cloudflare URL/ID (admin monitor), build the embed URL
  useEffect(() => {
    if (playlistType !== "cloudflare") return;
    setIsLoading(false);
    const container = cfContainerRef.current;
    if (!container) return;
    const url = playlistUrl;
    let cfUrl = "";
    if (url.includes("stream-proxy") || url.includes("/functions/v1/")) {
      // Proxy URL - use directly
      cfUrl = url;
    } else if (url.includes("cloudflarestream.com") && url.includes("/iframe")) {
      cfUrl = url.includes("autoplay") ? url : `${url}${url.includes("?") ? "&" : "?"}autoplay=true&preload=auto`;
    } else if (url.includes("cloudflarestream.com")) {
      const id = url.split("/").filter(Boolean).pop();
      cfUrl = `https://iframe.videodelivery.net/${id}?autoplay=true&preload=auto`;
    } else {
      cfUrl = `https://iframe.videodelivery.net/${url}?autoplay=true&preload=auto`;
    }
    createProtectedIframe(container, cfUrl, { allow: "autoplay; fullscreen; picture-in-picture; encrypted-media", allowFullscreen: true });
  }, [playlistType, playlistUrl, iframeRefreshKey, createProtectedIframe]);


  // YouTube fallback: imperatively create protected iframe
  useEffect(() => {
    if (playlistType !== "youtube" || !ytFallback) return;
    const container = ytFallbackContainerRef.current;
    if (!container) return;
    const videoId = extractVideoId(playlistUrl);
    const ytUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=0&controls=0&fs=0&iv_load_policy=3`;
    createProtectedIframe(container, ytUrl, {
      allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share",
      allowFullscreen: true,
    });
  }, [playlistType, playlistUrl, ytFallback, iframeRefreshKey, extractVideoId, createProtectedIframe]);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlistType === "youtube") {
      if (ytFallback) {
        // Reload iframe to get latest content
        setIframeRefreshKey(k => k + 1);
        setIsPlaying(true);
        return;
      }
      const player = ytPlayerRef.current;
      if (!player || !ytReadyRef.current) return;
      try {
        const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
        if (state === 1 || state === 3) {
          player.pauseVideo();
          setIsPlaying(false);
        } else {
          try {
            const duration = typeof player.getDuration === "function" ? player.getDuration() : 0;
            if (duration && duration > 0) player.seekTo(duration, true);
          } catch {}
          player.playVideo();
          setIsPlaying(true);
        }
      } catch {}
    } else if (playlistType === "cloudflare") {
      if (!isPlaying) {
        // Reload iframe to get latest content
        setIframeRefreshKey(k => k + 1);
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
      }
    } else if (videoRef.current) {
      const video = videoRef.current;
      if (video.paused) {
        if (playlistType === "m3u8" && hlsRef.current?.liveSyncPosition) {
          video.currentTime = hlsRef.current.liveSyncPosition;
        }
        video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      } else {
        video.pause();
        setIsPlaying(false);
      }
    }
  }, [playlistType, ytFallback, isPlaying]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if ((el as any).webkitRequestFullscreen) {
        (el as any).webkitRequestFullscreen();
      } else if ((el as any).webkitEnterFullscreen) {
        (el as any).webkitEnterFullscreen();
      }
    } catch {
      // iOS: try fullscreen on the video element directly
      try {
        const video = videoRef.current || el.querySelector("video") || el.querySelector("iframe");
        if (video && (video as any).webkitEnterFullscreen) {
          (video as any).webkitEnterFullscreen();
        }
      } catch {}
    }
  }, []);

  const toggleOrientation = useCallback(async () => {
    try {
      const orientation = screen.orientation;
      if (orientation.type.includes("portrait")) {
        await (orientation as any).lock("landscape");
      } else {
        await (orientation as any).lock("portrait");
      }
    } catch {}
  }, []);

  const handleQualityChange = useCallback((index: number, ytKey?: string) => {
    if (playlistType === "youtube" && isYTReady() && ytKey) {
      try {
        ytPlayerRef.current.setPlaybackQuality(ytKey === "auto" ? "default" : ytKey);
        setCurrentQuality(index);
      } catch {}
    } else if (hlsRef.current) {
      setIsSwitchingQuality(true);
      hlsRef.current.currentLevel = index;
      setCurrentQuality(index);
    }
    setShowQualityMenu(false);
  }, [playlistType, isYTReady]);

  const toggleYtMute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!isYTReady()) return;
    const player = ytPlayerRef.current;
    try {
      if (player.isMuted()) {
        player.unMute();
        setYtMuted(false);
      } else {
        player.mute();
        setYtMuted(true);
      }
    } catch {}
  }, [isYTReady]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  // (YouTube and Cloudflare URLs are now built imperatively in effects above)

  // Block DevTools shortcuts on the player area
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) ||
        (e.ctrlKey && e.key === "u") ||
        (e.ctrlKey && e.key === "s")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

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
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-primary border-t-transparent" />
            <p className="text-xs text-muted-foreground">Memuat...</p>
          </div>
        </div>
      )}

      {/* Quality switching overlay */}
      {isSwitchingQuality && !isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/50 backdrop-blur-sm transition-opacity duration-300">
          <div className="flex flex-col items-center gap-2 rounded-xl bg-card/80 px-6 py-4 shadow-lg backdrop-blur">
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-primary border-t-transparent" />
            <p className="text-xs text-muted-foreground">Mengganti resolusi...</p>
          </div>
        </div>
      )}

      {playlistType === "youtube" && !ytFallback && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}>
          <div
            ref={ytContainerRef}
            className="absolute inset-0 w-full h-full [&>div]:!w-full [&>div]:!h-full [&>iframe]:!w-full [&>iframe]:!h-full [&>div>iframe]:!w-full [&>div>iframe]:!h-full [&_iframe]:!w-full [&_iframe]:!h-full [&_iframe]:!absolute [&_iframe]:!inset-0"
          />
          {/* Protective overlay - blocks right-click & inspect on iframe, click triggers play/pause */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            style={{ background: "transparent" }}
            onContextMenu={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); togglePlay(e); }}
          />
        </div>
      )}

      {/* YouTube fallback: protected iframe container */}
      {playlistType === "youtube" && ytFallback && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}>
          <div
            ref={ytFallbackContainerRef}
            className="absolute inset-0 w-full h-full"
          />
          {/* Protective overlay */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            style={{ background: "transparent" }}
            onContextMenu={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); togglePlay(e); }}
          />
        </div>
      )}


      {playlistType === "m3u8" && (
        <video
          ref={videoRef}
          onClick={togglePlay}
          className={`h-full w-full object-contain cursor-pointer ${isFullscreen ? "max-h-screen" : "absolute inset-0"}`}
          playsInline
        />
      )}

      {playlistType === "cloudflare" && (
        <div
          ref={cfContainerRef}
          className={`h-full w-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}

      {/* Token code watermark */}
      {tokenCode && (
        <Suspense fallback={null}>
          <Watermark tokenCode={tokenCode} />
        </Suspense>
      )}

      {/* Admin watermark image */}
      {watermarkUrl && (
        <div className="pointer-events-none absolute bottom-12 right-3 z-20">
          <img src={watermarkUrl} alt="" className="h-8 w-auto opacity-40 md:h-10" loading="lazy" />
        </div>
      )}

      {/* Custom controls overlay */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-background/80 to-transparent p-3 transition-opacity ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          onClick={togglePlay}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/80 text-primary-foreground backdrop-blur-sm transition hover:bg-primary"
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          )}
        </button>

        {/* YouTube volume toggle */}
        {playlistType === "youtube" && !ytFallback && (
          <button
            onClick={toggleYtMute}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground backdrop-blur-sm transition hover:bg-secondary"
            title={ytMuted ? "Unmute" : "Mute"}
          >
            {ytMuted ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            )}
          </button>
        )}

        <div className="flex-1" />

        {qualities.length > 0 && (
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowQualityMenu(prev => !prev); }}
              className="flex items-center gap-1 rounded-md bg-secondary/80 px-2 py-1 text-xs text-secondary-foreground backdrop-blur-sm transition hover:bg-secondary"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              {qualities.find(q => q.index === currentQuality)?.label || "Auto"}
            </button>
            {showQualityMenu && (
              <div className="absolute bottom-full right-0 mb-2 rounded-lg bg-card/95 border border-border p-1 shadow-xl backdrop-blur-md min-w-[100px]">
                {qualities.map((q) => (
                  <button
                    key={q.index}
                    onClick={(e) => { e.stopPropagation(); handleQualityChange(q.index, q.ytKey); }}
                    className={`block w-full rounded-md px-3 py-1.5 text-left text-xs transition ${
                      currentQuality === q.index
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-foreground hover:bg-secondary"
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={toggleOrientation}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground backdrop-blur-sm transition hover:bg-secondary"
          title="Rotate"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
        </button>

        <button
          onClick={toggleFullscreen}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground backdrop-blur-sm transition hover:bg-secondary"
          title="Fullscreen"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
      </div>
    </div>
  );
});

VideoPlayer.displayName = "VideoPlayer";

export default VideoPlayer;
