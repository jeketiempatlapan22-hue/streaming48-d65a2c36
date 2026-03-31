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
  const [qualities, setQualities] = useState<{ label: string; index: number; ytKey?: string }[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ytMuted, setYtMuted] = useState(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [ytFallback, setYtFallback] = useState(false);
  const [iframeRefreshKey, setIframeRefreshKey] = useState(0);
  const [isBehindLive, setIsBehindLive] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef(false);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const ytFallbackTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const ytFallbackContainerRef = useRef<HTMLDivElement>(null);
  const cfContainerRef = useRef<HTMLDivElement>(null);
  // Performance: track last UI update time to throttle React re-renders
  const lastUiUpdateRef = useRef(0);
  const rafRef = useRef(0);

  const playlistUrl = playlist.url;
  const playlistType = playlist.type;

  // Global loading timeout — never stay stuck on loading for more than 12s
  // Robust video-element-driven loading sync — polls readyState + listens to all media events
  // This ensures the loading overlay ALWAYS clears, even if HLS.js events never fire
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const done = () => setIsLoading(false);
    const wait = () => { if (!v.paused) setIsLoading(true); };
    const sync = () => {
      // If video has enough data to render a frame, or is actively playing, clear loading
      if (v.readyState >= 2 || (!v.paused && v.readyState >= 1)) done();
    };
    const readyEvents = ["loadedmetadata", "loadeddata", "canplay", "canplaythrough", "playing", "seeked"];
    const waitEvents = ["waiting", "stalled", "seeking"];
    readyEvents.forEach(e => v.addEventListener(e, done));
    waitEvents.forEach(e => v.addEventListener(e, wait));
    // Poll every 250ms as absolute fallback — catches cases where events are missed
    const pollId = window.setInterval(sync, 250);
    // Hard timeout — absolute guarantee after 8s
    const hardTimeout = window.setTimeout(done, 8000);
    sync(); // Check immediately
    return () => {
      window.clearInterval(pollId);
      window.clearTimeout(hardTimeout);
      readyEvents.forEach(e => v.removeEventListener(e, done));
      waitEvents.forEach(e => v.removeEventListener(e, wait));
    };
  }, [playlistUrl, playlistType]);

  const isYTReady = useCallback(() => {
    const p = ytPlayerRef.current;
    return p && ytReadyRef.current && typeof p.getPlayerState === "function" && typeof p.playVideo === "function";
  }, []);

  useImperativeHandle(ref, () => ({
    play: () => {
      if (playlistType === "youtube") {
        if (ytFallback) { setIframeRefreshKey(k => k + 1); setIsPlaying(true); return; }
        if (isYTReady()) {
          const player = ytPlayerRef.current;
          try { const d = player.getDuration?.(); if (d > 0) player.seekTo(d, true); } catch {}
          player.playVideo();
          setIsPlaying(true);
        }
      } else if (playlistType === "cloudflare") {
        setIframeRefreshKey(k => k + 1); setIsPlaying(true);
      } else if (playlistType === "m3u8" && hlsRef.current && videoRef.current) {
        if (hlsRef.current.liveSyncPosition) videoRef.current.currentTime = hlsRef.current.liveSyncPosition;
        videoRef.current.play();
        setIsPlaying(true);
      } else if (videoRef.current) {
        videoRef.current.play(); setIsPlaying(true);
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

  // Cleanup on playlist change — reset video element fully
  useEffect(() => {
    setYtFallback(false);
    setIsLoading(true);
    setIsPlaying(false);
    setQualities([]);
    // Reset video element to avoid stale source
    const vid = videoRef.current;
    if (vid) { vid.pause(); vid.removeAttribute("src"); vid.load(); }
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [playlistUrl, playlistType]);

  const decryptUrl = useCallback((encoded: string): string => {
    if (!encoded.startsWith("enc:")) return encoded;
    const b64 = encoded.slice(4);
    // Derived key — not a plain literal
    const _a = [12,105,82,37,24,119,60,125,84,18,73,127,12,114,10,20];
    const _b = [94,61,102,29,96,60,5,16,5,32,63,51,59,28,90,32];
    const _k = _a.map((v, i) => v ^ _b[i]);
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) result[i] = bytes[i] ^ _k[i % _k.length];
    return new TextDecoder().decode(result);
  }, []);

  const createProtectedIframe = useCallback((container: HTMLElement, url: string, opts: { allow?: string; allowFullscreen?: boolean }) => {
    container.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.setAttribute("allow", opts.allow || "");
    if (opts.allowFullscreen) iframe.allowFullscreen = true;
    iframe.setAttribute("playsinline", "");
    iframe.setAttribute("webkit-playsinline", "");
    iframe.setAttribute("loading", "eager");
    iframe.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;border:0;z-index:1;";
    iframe.setAttribute("tabindex", "-1");
    iframe.setAttribute("aria-hidden", "true");
    iframe.src = url;
    container.appendChild(iframe);
    return iframe;
  }, []);

  const extractVideoId = useCallback((url: string): string => {
    const decrypted = decryptUrl(url);
    const match = decrypted.match(/(?:youtu\.be\/|v=|\/embed\/|\/v\/)([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(decrypted)) return decrypted;
    return decrypted;
  }, [decryptUrl]);

  // ========== HLS (m3u8) - ROBUST ==========
  useEffect(() => {
    if (playlistType !== "m3u8" || !videoRef.current || !playlistUrl) return;
    let destroyed = false;
    let hls: any = null;
    const vid = videoRef.current;

    const clearLoading = () => { if (!destroyed) setIsLoading(false); };
    const markPlaying = () => { if (!destroyed) { setIsLoading(false); setIsPlaying(true); } };

    const initHls = async () => {
      const Hls = (await import("hls.js")).default;
      if (destroyed) return;

      // Native HLS support (Safari, iOS)
      if (!Hls.isSupported()) {
        if (vid.canPlayType("application/vnd.apple.mpegurl")) {
          vid.src = playlistUrl;
          vid.load();
          if (autoPlay) { vid.muted = true; vid.play().then(() => { setTimeout(() => { if (!destroyed) vid.muted = false; }, 500); }).catch(() => {}); }
        }
        clearLoading();
        return;
      }

      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        liveDurationInfinity: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        maxLiveSyncPlaybackRate: 1.02,
        liveBackBufferLength: 15,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1024 * 1024,
        maxBufferHole: 0.5,
        abrBandWidthFactor: 0.7,
        abrBandWidthUpFactor: 0.5,
        abrEwmaDefaultEstimate: 1_000_000,
        abrEwmaFastLive: 3.0,
        abrEwmaSlowLive: 9.0,
        startLevel: -1,
        capLevelToPlayerSize: true,
        capLevelOnFPSDrop: true,
        startFragPrefetch: true,
        progressive: true,
        fragLoadingMaxRetry: 10,
        levelLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        manifestLoadingRetryDelay: 1000,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 30000,
        levelLoadingMaxRetryTimeout: 30000,
        manifestLoadingMaxRetryTimeout: 30000,
        manifestLoadingTimeOut: 12000,
        levelLoadingTimeOut: 12000,
        fragLoadingTimeOut: 20000,
        xhrSetup: (xhr: XMLHttpRequest) => { xhr.timeout = 20000; },
        debug: false,
      });
      hlsRef.current = hls;

      // Quality: keep auto until user manually selects
      let userLocked = false;

      hls.on(Hls.Events.MANIFEST_PARSED, (_: any, data: any) => {
        if (destroyed) return;
        const levels = data.levels.map((l: any, i: number) => ({ label: `${l.height}p`, index: i }));
        setQualities([{ label: "Auto", index: -1 }, ...levels]);
        hls.currentLevel = -1;
        hls.autoLevelEnabled = true;
        setCurrentQuality(-1);
        userLocked = false;
        clearLoading();

        if (autoPlay) {
          vid.muted = true;
          vid.play().then(() => {
            setTimeout(() => { if (!destroyed && videoRef.current) videoRef.current.muted = false; }, 500);
          }).catch(() => {});
          setIsPlaying(true);
        }
      });

      // Also clear loading on LEVEL_LOADED as secondary signal
      hls.on(Hls.Events.LEVEL_LOADED, (_: any, d: any) => {
        if (destroyed) return;
        clearLoading(); // Always clear — if we got level data, we're not "loading"
        const details = d.details;
        if (details?.live && vid.buffered.length) {
          const edge = details.edge;
          if (edge && edge - vid.currentTime > 15) {
            vid.currentTime = edge - 3;
          }
        }
      });

      // Also clear on FRAG_LOADED — if fragments are arriving, player is working
      hls.on(Hls.Events.FRAG_LOADED, () => { if (!destroyed) clearLoading(); });

      (hls as any).__setUserLocked = (level: number) => {
        if (level === -1) {
          userLocked = false;
          hls.currentLevel = -1;
          hls.nextAutoLevel = -1;
          hls.autoLevelEnabled = true;
        } else {
          userLocked = true;
          hls.currentLevel = level;
          hls.nextAutoLevel = level;
          hls.autoLevelEnabled = false;
        }
      };

      // Lightweight UI sync — only update "behind live" indicator every 2s
      let behindRef = false;
      const syncLoop = (timestamp: number) => {
        if (destroyed) return;
        rafRef.current = requestAnimationFrame(syncLoop);
        if (timestamp - lastUiUpdateRef.current < 2000) return;
        lastUiUpdateRef.current = timestamp;
        if (!vid || !hls || vid.paused) return;
        if (hls.liveSyncPosition) {
          const lag = hls.liveSyncPosition - vid.currentTime;
          const behind = lag > 8;
          if (behind !== behindRef) { behindRef = behind; setIsBehindLive(behind); }
        }
      };
      rafRef.current = requestAnimationFrame(syncLoop);

      let fatalRetryCount = 0;
      const MAX_FATAL_RETRIES = 3;

      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (destroyed) return;
        if (data.fatal) {
          clearLoading(); // Never stay stuck on loading during errors
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn("[HLS] Network error, retrying...");
              setTimeout(() => { if (!destroyed && hls) hls.startLoad(); }, 1000);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn("[HLS] Media error, recovering...");
              hls.recoverMediaError();
              break;
            default:
              fatalRetryCount++;
              if (fatalRetryCount <= MAX_FATAL_RETRIES) {
                console.error(`[HLS] Fatal error, reinit attempt ${fatalRetryCount}/${MAX_FATAL_RETRIES}`);
                hls.destroy();
                hlsRef.current = null;
                hls = null;
                setTimeout(() => { if (!destroyed) initHls(); }, 2000);
              } else {
                console.error("[HLS] Max retries exceeded, giving up");
              }
              break;
          }
        }
        // Non-fatal buffer stall: nudge playback forward
        if (!data.fatal && data.details === "bufferStalledError" && vid) {
          if (vid.buffered.length > 0) {
            const buffEnd = vid.buffered.end(vid.buffered.length - 1);
            if (buffEnd - vid.currentTime > 1) vid.currentTime = buffEnd - 0.5;
          }
        }
      });

      // Load source + attach AFTER all event listeners are registered
      hls.loadSource(playlistUrl);
      hls.attachMedia(vid);

      // Long-session health: recover from tab sleep / background throttling
      const onVisibilityChange = () => {
        if (destroyed || document.hidden) return;
        if (!vid || !hls) return;
        hls.startLoad();
        if (vid.paused) vid.play().catch(() => {});
        if (hls.liveSyncPosition && hls.liveSyncPosition - vid.currentTime > 5) {
          vid.currentTime = hls.liveSyncPosition;
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);

      // Periodic health check every 15s: detect stuck playback
      const healthInterval = setInterval(() => {
        if (destroyed || document.hidden) return;
        if (!vid || vid.paused || !hls) return;
        if (vid.readyState < 3) hls.startLoad();
      }, 15000);

      const origDestroy = hls.destroy.bind(hls);
      hls.destroy = () => {
        cancelAnimationFrame(rafRef.current);
        clearInterval(healthInterval);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        origDestroy();
      };
    };

    setIsLoading(true);
    initHls();
    return () => {
      destroyed = true;
      clearTimeout(hardTimeout);
      cancelAnimationFrame(rafRef.current);
      // Clean up native video listeners
      vid.onloadedmetadata = null;
      vid.oncanplay = null;
      vid.onplaying = null;
      vid.onerror = null;
      vid.onwaiting = null;
      if (hls) { hls.destroy(); hlsRef.current = null; }
    };
  }, [playlistUrl, playlistType, autoPlay]);

  // ========== YouTube ==========
  useEffect(() => {
    if (playlistType !== "youtube") return;
    setIsLoading(true);
    let destroyed = false;
    const videoId = extractVideoId(playlistUrl);

    ytFallbackTimerRef.current = setTimeout(() => {
      if (destroyed || ytReadyRef.current) return;
      console.warn("[YT] API timeout, using fallback iframe");
      setYtFallback(true); setIsLoading(false); setIsPlaying(autoPlay);
    }, 6000);

    const createYTPlayer = () => {
      if (destroyed || ytFallback) return;
      const container = ytContainerRef.current;
      if (!container) { setYtFallback(true); setIsLoading(false); return; }
      container.innerHTML = "";
      const playerDiv = document.createElement("div");
      playerDiv.id = `_p${Math.random().toString(36).slice(2, 10)}`;
      container.appendChild(playerDiv);

      try {
        ytPlayerRef.current = new (window as any).YT.Player(playerDiv, {
          width: "100%", height: "100%", videoId,
          playerVars: {
            autoplay: autoPlay ? 1 : 0, mute: 1, enablejsapi: 1, controls: 1,
            disablekb: 1, fs: 0, modestbranding: 1, rel: 0, iv_load_policy: 3,
            playsinline: 1, showinfo: 0, origin: window.location.origin,
          },
          events: {
            onReady: (e: any) => {
              if (destroyed) return;
              ytReadyRef.current = true;
              setIsLoading(false);
              clearTimeout(ytFallbackTimerRef.current);
              try {
                const iframe = container.querySelector("iframe");
                if (iframe) {
                  iframe.removeAttribute("title");
                  iframe.setAttribute("tabindex", "-1");
                  iframe.setAttribute("aria-hidden", "true");
                }
              } catch {}
              if (autoPlay) {
                e.target.playVideo(); setIsPlaying(true); setYtMuted(true);
                setTimeout(() => {
                  try { if (ytPlayerRef.current?.unMute) { ytPlayerRef.current.unMute(); setYtMuted(false); } } catch {}
                }, 1500);
              }
            },
            onStateChange: (e: any) => {
              if (destroyed) return;
              setIsPlaying(e.data === 1);
              setIsLoading(e.data === 3);
            },
            onError: () => {
              if (destroyed) return;
              setIsLoading(false); setYtFallback(true);
            },
          },
        });
      } catch {
        setIsLoading(false); setYtFallback(true);
      }
    };

    const loadYTApi = () => {
      if ((window as any).YT?.Player) { createYTPlayer(); return; }
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.onerror = () => { if (!destroyed) { setYtFallback(true); setIsLoading(false); } };
        document.head.appendChild(tag);
      }
      const check = setInterval(() => {
        if (destroyed) { clearInterval(check); return; }
        if ((window as any).YT?.Player) { clearInterval(check); createYTPlayer(); }
      }, 200);
      (window as any).onYouTubeIframeAPIReady = () => { clearInterval(check); if (!destroyed) createYTPlayer(); };
      setTimeout(() => clearInterval(check), 10000);
    };

    loadYTApi();
    return () => {
      destroyed = true; ytReadyRef.current = false;
      clearTimeout(ytFallbackTimerRef.current);
      try { ytPlayerRef.current?.destroy?.(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [playlistUrl, playlistType, autoPlay, extractVideoId]);

  // Cloudflare iframe — always use the signed proxy URL (playlistUrl already points to stream-proxy?mode=cf)
  useEffect(() => {
    if (playlistType !== "cloudflare") return;
    setIsLoading(true);
    const container = cfContainerRef.current;
    if (!container) return;
    let retryCount = 0;
    const maxRetries = 2;

    const loadCfIframe = () => {
      // playlistUrl is already the signed proxy URL from useSignedStreamUrl
      const iframe = createProtectedIframe(container, playlistUrl, { allow: "autoplay; fullscreen; picture-in-picture; encrypted-media", allowFullscreen: true });
      
      iframe.addEventListener("load", () => {
        setIsLoading(false);
        // Listen for error messages from the Cloudflare player inside the iframe
        const checkError = setTimeout(() => {
          // If we can detect the iframe failed (no video playing), retry
          try {
            if (retryCount < maxRetries && iframe.contentDocument?.body?.textContent?.includes("失败")) {
              retryCount++;
              console.warn(`[CF] Player error detected, retry ${retryCount}/${maxRetries}`);
              loadCfIframe();
            }
          } catch {
            // Cross-origin, can't check — that's fine, it means the proxy loaded successfully
          }
        }, 3000);
        return () => clearTimeout(checkError);
      }, { once: true });

      iframe.addEventListener("error", () => {
        if (retryCount < maxRetries) {
          retryCount++;
          console.warn(`[CF] Load error, retry ${retryCount}/${maxRetries}`);
          setTimeout(loadCfIframe, 1500);
        } else {
          setIsLoading(false);
        }
      }, { once: true });
    };

    loadCfIframe();
    // Fallback timeout in case load event doesn't fire
    const t = setTimeout(() => setIsLoading(false), 8000);
    return () => clearTimeout(t);
  }, [playlistType, playlistUrl, iframeRefreshKey, createProtectedIframe]);

  // YouTube fallback iframe
  useEffect(() => {
    if (playlistType !== "youtube" || !ytFallback) return;
    const container = ytFallbackContainerRef.current;
    if (!container) return;
    const videoId = extractVideoId(playlistUrl);
    createProtectedIframe(container, `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=0&controls=1&fs=0&iv_load_policy=3&origin=${encodeURIComponent(window.location.origin)}`, {
      allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share",
      allowFullscreen: true,
    });
  }, [playlistType, playlistUrl, ytFallback, iframeRefreshKey, extractVideoId, createProtectedIframe]);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlistType === "youtube") {
      if (ytFallback) { setIframeRefreshKey(k => k + 1); setIsPlaying(true); return; }
      const player = ytPlayerRef.current;
      if (!player || !ytReadyRef.current) return;
      try {
        const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : -1;
        if (state === 1 || state === 3) { player.pauseVideo(); setIsPlaying(false); }
        else {
          try { const d = player.getDuration?.(); if (d > 0) player.seekTo(d, true); } catch {}
          player.playVideo(); setIsPlaying(true);
        }
      } catch {}
    } else if (playlistType === "cloudflare") {
      if (!isPlaying) { setIframeRefreshKey(k => k + 1); setIsPlaying(true); } else setIsPlaying(false);
    } else if (videoRef.current) {
      const video = videoRef.current;
      if (video.paused) {
        if (playlistType === "m3u8" && hlsRef.current?.liveSyncPosition) video.currentTime = hlsRef.current.liveSyncPosition;
        video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      } else { video.pause(); setIsPlaying(false); }
    }
  }, [playlistType, ytFallback, isPlaying]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (el.requestFullscreen) await el.requestFullscreen();
      else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
      else if ((el as any).webkitEnterFullscreen) (el as any).webkitEnterFullscreen();
    } catch {
      try {
        const video = videoRef.current || el.querySelector("video") || el.querySelector("iframe");
        if (video && (video as any).webkitEnterFullscreen) (video as any).webkitEnterFullscreen();
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

  const handleQualityChange = useCallback((index: number, ytKey?: string) => {
    if (playlistType === "youtube" && isYTReady() && ytKey) {
      try { ytPlayerRef.current.setPlaybackQuality(ytKey === "auto" ? "default" : ytKey); setCurrentQuality(index); } catch {}
    } else if (hlsRef.current) {
      if (typeof (hlsRef.current as any).__setUserLocked === "function") (hlsRef.current as any).__setUserLocked(index);
      else hlsRef.current.currentLevel = index;
      setCurrentQuality(index);
    }
    setShowQualityMenu(false);
  }, [playlistType, isYTReady]);

  const toggleYtMute = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!isYTReady()) return;
    const player = ytPlayerRef.current;
    try {
      if (player.isMuted()) { player.unMute(); setYtMuted(false); }
      else { player.mute(); setYtMuted(true); }
    } catch {}
  }, [isYTReady]);

  const syncToLive = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlistType === "m3u8" && hlsRef.current && videoRef.current) {
      const hls = hlsRef.current;
      if (hls.liveSyncPosition) videoRef.current.currentTime = hls.liveSyncPosition;
      else if (videoRef.current.buffered.length > 0) videoRef.current.currentTime = videoRef.current.buffered.end(videoRef.current.buffered.length - 1) - 0.5;
      if (videoRef.current.paused) { videoRef.current.play().catch(() => {}); setIsPlaying(true); }
      setIsBehindLive(false);
    } else if (playlistType === "youtube") {
      if (ytFallback) setIframeRefreshKey(k => k + 1);
      else if (isYTReady()) { try { const d = ytPlayerRef.current.getDuration?.(); if (d > 0) ytPlayerRef.current.seekTo(d, true); } catch {} ytPlayerRef.current.playVideo(); }
      setIsPlaying(true);
    } else if (playlistType === "cloudflare") {
      setIframeRefreshKey(k => k + 1); setIsPlaying(true);
    }
  }, [playlistType, ytFallback, isYTReady]);

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

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-card ${isFullscreen ? "flex items-center justify-center !h-screen" : "aspect-video"}`}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
    >
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

      {playlistType === "youtube" && !ytFallback && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}>
          <div ref={ytContainerRef} className="absolute inset-0 w-full h-full [&>div]:!w-full [&>div]:!h-full [&>iframe]:!w-full [&>iframe]:!h-full [&>div>iframe]:!w-full [&>div>iframe]:!h-full [&_iframe]:!w-full [&_iframe]:!h-full [&_iframe]:!absolute [&_iframe]:!inset-0" />
          {/* Full blocking overlay — prevents ALL clicks/touches to YouTube iframe */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.001)", pointerEvents: "all" }}
            onContextMenu={e => e.preventDefault()}
            onDragStart={e => e.preventDefault()}
            onClick={e => { e.stopPropagation(); togglePlay(e); }}
            onDoubleClick={e => { e.stopPropagation(); e.preventDefault(); }}
            onTouchStart={e => e.stopPropagation()}
          />
        </div>
      )}

      {playlistType === "youtube" && ytFallback && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}>
          <div ref={ytFallbackContainerRef} className="absolute inset-0 w-full h-full" />
          {/* Full blocking overlay for fallback iframe */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.001)", pointerEvents: "all" }}
            onContextMenu={e => e.preventDefault()}
            onDragStart={e => e.preventDefault()}
            onClick={e => { e.stopPropagation(); togglePlay(e); }}
            onDoubleClick={e => { e.stopPropagation(); e.preventDefault(); }}
            onTouchStart={e => e.stopPropagation()}
          />
        </div>
      )}

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

      {playlistType === "cloudflare" && (
        <div ref={cfContainerRef} className={`h-full w-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`} onContextMenu={e => e.preventDefault()} />
      )}

      {tokenCode && (<Suspense fallback={null}><Watermark tokenCode={tokenCode} /></Suspense>)}

      {watermarkUrl && (
        <div className="pointer-events-none absolute bottom-12 right-3 z-20">
          <img src={watermarkUrl} alt="" className="h-8 w-auto opacity-40 md:h-10" loading="lazy" />
        </div>
      )}

      {/* Controls */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-background/80 to-transparent p-3 transition-opacity ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onContextMenu={e => e.preventDefault()}
      >
        <button onClick={togglePlay} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/80 text-primary-foreground backdrop-blur-sm transition hover:bg-primary">
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          )}
        </button>

        {playlistType === "youtube" && !ytFallback && (
          <button onClick={toggleYtMute} className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground backdrop-blur-sm transition hover:bg-secondary" title={ytMuted ? "Unmute" : "Mute"}>
            {ytMuted ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            )}
          </button>
        )}

        <button
          onClick={syncToLive}
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition ${isBehindLive ? "bg-destructive/90 text-destructive-foreground animate-pulse hover:bg-destructive" : "bg-secondary/80 text-secondary-foreground hover:bg-secondary"}`}
          title="Sync ke Live"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>
          LIVE
        </button>

        <div className="flex-1" />

        {qualities.length > 0 && (
          <div className="relative">
            <button onClick={e => { e.stopPropagation(); setShowQualityMenu(prev => !prev); }} className="flex h-10 items-center gap-1.5 rounded-full bg-primary/80 px-4 py-2 text-sm font-semibold text-primary-foreground backdrop-blur-sm transition hover:bg-primary shadow-lg">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              {qualities.find(q => q.index === currentQuality)?.label || "Auto"}
            </button>
            {showQualityMenu && (
              <div className="absolute bottom-full right-0 mb-2 rounded-xl bg-card border-2 border-primary/30 p-1.5 shadow-2xl backdrop-blur-md min-w-[120px]">
                {qualities.map(q => (
                  <button key={q.index} onClick={e => { e.stopPropagation(); handleQualityChange(q.index, q.ytKey); }} className={`block w-full rounded-lg px-4 py-2.5 text-left text-sm font-medium transition ${currentQuality === q.index ? "bg-primary text-primary-foreground font-bold" : "text-foreground hover:bg-secondary"}`}>
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button onClick={toggleOrientation} className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground backdrop-blur-sm transition hover:bg-secondary" title="Rotate">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
        </button>

        <button onClick={toggleFullscreen} className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/80 text-secondary-foreground backdrop-blur-sm transition hover:bg-secondary" title="Fullscreen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
      </div>
    </div>
  );
});

VideoPlayer.displayName = "VideoPlayer";

export default VideoPlayer;
