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
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitchingQuality, setIsSwitchingQuality] = useState(false);
  const [qualities, setQualities] = useState<{ label: string; index: number; ytKey?: string }[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ytMuted, setYtMuted] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef(false);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hlsInitRef = useRef(false);

  const isYTReady = useCallback(() => {
    const p = ytPlayerRef.current;
    return p && ytReadyRef.current && typeof p.getPlayerState === "function" && typeof p.playVideo === "function";
  }, []);

  useImperativeHandle(ref, () => ({
    play: () => {
      if (playlist.type === "youtube" && isYTReady()) {
        const player = ytPlayerRef.current;
        try {
          const duration = player.getDuration?.();
          if (duration && duration > 0) player.seekTo(duration, true);
        } catch {}
        player.playVideo();
      } else if (playlist.type === "m3u8" && hlsRef.current && videoRef.current) {
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
      if (playlist.type === "youtube" && isYTReady()) {
        ytPlayerRef.current.pauseVideo();
      } else if (videoRef.current) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    },
    seekTo: (time: number) => {
      if (playlist.type === "youtube" && isYTReady()) {
        ytPlayerRef.current.seekTo(time, true);
      } else if (videoRef.current) {
        videoRef.current.currentTime = time;
      }
    },
    getCurrentTime: () => {
      if (playlist.type === "youtube" && isYTReady()) {
        try { return ytPlayerRef.current.getCurrentTime() || 0; } catch { return 0; }
      }
      return videoRef.current?.currentTime || 0;
    },
  }), [playlist.type, isYTReady]);

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

  // Cleanup HLS on playlist change
  useEffect(() => {
    setIsLoading(true);
    hlsInitRef.current = false;
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playlist]);

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

  // Init HLS for m3u8
  useEffect(() => {
    if (playlist.type !== "m3u8" || !videoRef.current || hlsInitRef.current) return;
    hlsInitRef.current = true;
    let destroyed = false;
    let hls: any = null;

    const initHls = async () => {
      const Hls = (await import("hls.js")).default;
      if (destroyed) return;
      const decodedUrl = deobfuscate(obfuscate(playlist.url));
      if (!Hls.isSupported()) {
        videoRef.current!.src = decodedUrl;
        if (autoPlay) videoRef.current!.play().catch(() => {});
        return;
      }
      hls = new Hls({
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        liveDurationInfinity: true,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 0.5,
        backBufferLength: 30,
        abrEwmaDefaultEstimate: 1_000_000,
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.7,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1500,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 3,
        startFragPrefetch: true,
        testBandwidth: true,
        progressive: true,
        lowLatencyMode: false,
        debug: false,
      });
      hlsRef.current = hls;
      hls.loadSource(decodedUrl);
      hls.attachMedia(videoRef.current!);

      // Hide URL from DOM inspection
      try {
        const videoEl = videoRef.current!;
        const origSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        Object.defineProperty(videoEl, 'src', {
          get: () => '',
          set: (v: string) => origSrc?.set?.call(videoEl, v),
          configurable: true,
        });
        Object.defineProperty(videoEl, 'currentSrc', {
          get: () => '',
          configurable: true,
        });
      } catch {}

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
          videoRef.current!.play().catch(() => {});
          setIsPlaying(true);
        }
      });
      hls.on(Hls.Events.LEVEL_SWITCHING, () => { if (!destroyed) setIsSwitchingQuality(true); });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => { if (!destroyed) setIsSwitchingQuality(false); });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { if (!destroyed) setIsSwitchingQuality(false); });
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (destroyed) return;
        setIsLoading(false);
        setIsSwitchingQuality(false);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
            case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
            default:
              hls.destroy();
              hlsRef.current = null;
              hlsInitRef.current = false;
              setTimeout(() => { if (!destroyed) initHls(); }, 3000);
              break;
          }
        }
      });
    };
    initHls();
    return () => {
      destroyed = true;
      if (hls) { hls.destroy(); hlsRef.current = null; }
    };
  }, [playlist, autoPlay, obfuscate, deobfuscate]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (playlist.type !== "youtube") return;
    let destroyed = false;

    const loadYTApi = () => {
      if ((window as any).YT && (window as any).YT.Player) {
        createYTPlayer();
        return;
      }
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(tag);
      }
      (window as any).onYouTubeIframeAPIReady = () => {
        if (!destroyed) createYTPlayer();
      };
    };

    const createYTPlayer = () => {
      if (destroyed) return;
      const container = ytContainerRef.current;
      if (!container) return;
      container.innerHTML = "";
      const playerDiv = document.createElement("div");
      playerDiv.id = `_p${Math.random().toString(36).slice(2, 10)}`;
      container.appendChild(playerDiv);

      const _decrypted = decryptUrl(playlist.url);
      const _raw = (() => {
        const match = _decrypted.match(/(?:youtu\.be\/|v=|\/embed\/|\/v\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : _decrypted;
      })();
      const _enc = obfuscate(_raw);
      const videoId = deobfuscate(_enc);

      try {
        ytPlayerRef.current = new (window as any).YT.Player(playerDiv, {
          width: "100%",
          height: "100%",
          videoId,
          playerVars: {
            autoplay: autoPlay ? 1 : 0,
            mute: 0,
            enablejsapi: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            showinfo: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (e: any) => {
              if (destroyed) return;
              ytReadyRef.current = true;
              let qualityReleased = false;
              const releaseQuality = () => {
                if (qualityReleased || destroyed) return;
                qualityReleased = true;
                try {
                  if (ytPlayerRef.current && typeof ytPlayerRef.current.setPlaybackQuality === 'function') {
                    ytPlayerRef.current.setPlaybackQuality('default');
                  }
                } catch {}
              };

              // Force highest quality initially
              try {
                const ytQuals = e.target.getAvailableQualityLevels?.() || [];
                if (ytQuals.length > 0) {
                  e.target.setPlaybackQuality(ytQuals[0]);
                }
              } catch {}

              // Fallback: release quality lock after 8s
              const fallbackTimer = setTimeout(releaseQuality, 8000);
              (e.target as any).__releaseQuality = releaseQuality;
              (e.target as any).__fallbackTimer = fallbackTimer;

              try {
                const iframe = container.querySelector("iframe");
                if (iframe) {
                  iframe.removeAttribute("title");
                  iframe.setAttribute("referrerpolicy", "no-referrer");
                  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
                }
              } catch {}

              if (autoPlay) e.target.playVideo();
            },
            onStateChange: (e: any) => {
              if (destroyed) return;
              const state = e.data;
              setIsPlaying(state === 1);
              if (state === 1 || state === 2) setIsLoading(false);

              // If buffering >4s, release quality lock
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
            },
          },
        });
      } catch (err) {
        console.warn("Failed to create YT player:", err);
        setIsLoading(false);
      }
    };

    loadYTApi();
    return () => {
      destroyed = true;
      ytReadyRef.current = false;
      try { if (ytPlayerRef.current?.destroy) ytPlayerRef.current.destroy(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [playlist, autoPlay, decryptUrl, obfuscate, deobfuscate]);

  // Cloudflare loading
  useEffect(() => {
    if (playlist.type === "cloudflare") {
      const timer = setTimeout(() => setIsLoading(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [playlist]);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlist.type === "youtube") {
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
    } else if (playlist.type === "cloudflare") {
      setIsPlaying(prev => !prev);
    } else if (videoRef.current) {
      const video = videoRef.current;
      if (video.paused) {
        if (playlist.type === "m3u8" && hlsRef.current?.liveSyncPosition) {
          video.currentTime = hlsRef.current.liveSyncPosition;
        }
        video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      } else {
        video.pause();
        setIsPlaying(false);
      }
    }
  }, [playlist.type]);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch {}
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
    if (playlist.type === "youtube" && isYTReady() && ytKey) {
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
  }, [playlist.type, isYTReady]);

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
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const cloudflareSrc = useMemo(() => {
    if (playlist.type !== "cloudflare") return "";
    const url = playlist.url;
    if (url.includes("cloudflarestream.com") && url.includes("/iframe")) return url;
    if (url.includes("cloudflarestream.com")) {
      const id = url.split("/").filter(Boolean).pop();
      return `https://iframe.videodelivery.net/${id}`;
    }
    return `https://iframe.videodelivery.net/${url}`;
  }, [playlist.type, playlist.url]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full bg-card overflow-hidden ${isFullscreen ? "flex items-center justify-center !h-screen" : "aspect-video"}`}
    >
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-xs text-muted-foreground animate-pulse">Menghubungkan ke streaming...</p>
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

      {playlist.type === "youtube" && (
        <>
          <div
            ref={ytContainerRef}
            className={`w-full h-full [&>div]:!w-full [&>div]:!h-full [&>iframe]:!w-full [&>iframe]:!h-full [&>div>iframe]:!w-full [&>div>iframe]:!h-full [&_iframe]:!w-full [&_iframe]:!h-full ${isFullscreen ? "relative max-h-screen aspect-video" : "absolute inset-0 [&_iframe]:!absolute [&_iframe]:!inset-0"}`}
          />
          {/* Full overlay to block all YouTube UI navigation and links */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            onClick={togglePlay}
            onContextMenu={(e) => e.preventDefault()}
          />
        </>
      )}

      {playlist.type === "m3u8" && (
        <video
          ref={videoRef}
          onClick={togglePlay}
          className={`h-full w-full object-contain cursor-pointer ${isFullscreen ? "max-h-screen" : "absolute inset-0"}`}
          playsInline
        />
      )}

      {playlist.type === "cloudflare" && (
        <>
          <iframe
            src={cloudflareSrc}
            className={`h-full w-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}
            allow="autoplay; fullscreen"
            allowFullScreen
            loading="lazy"
          />
          <div className="absolute inset-0 z-10 cursor-pointer" onClick={togglePlay} style={{ pointerEvents: "auto" }} />
        </>
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
        {playlist.type === "youtube" && (
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
