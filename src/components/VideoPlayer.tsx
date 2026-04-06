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
  /** Mutable ref so xhrSetup always reads latest headers without re-mounting HLS */
  customHeadersRef?: React.MutableRefObject<Record<string, string> | null>;
}

export interface VideoPlayerHandle {
  play: () => void;
  pause: () => void;
  seekTo?: (time: number) => void;
  getCurrentTime?: () => number;
}

const YT_ORIGIN = "https://www.youtube.com";

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ playlist, autoPlay = true, watermarkUrl, tokenCode, customHeadersRef }, ref) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [qualities, setQualities] = useState<{ label: string; value: number }[]>([]);
  const [selectedQuality, setSelectedQuality] = useState(-1);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ytMuted, setYtMuted] = useState(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [isBehindLive, setIsBehindLive] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [qualityChanging, setQualityChanging] = useState<string | null>(null);
  const [streamInactive, setStreamInactive] = useState(false);
  const qualityChangeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const inactiveRetryRef = useRef<ReturnType<typeof setTimeout>>();
  const fragLoadedRef = useRef(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytReadyRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const controlsFrameRef = useRef<number | null>(null);
  const showControlsRef = useRef(true);
  const isBehindLiveRef = useRef(false);
  const ytIframeRef = useRef<HTMLIFrameElement | null>(null);
  const userQualityRef = useRef<number>(-1); // track user's manual quality choice

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

  // ── Helper: send postMessage to YT iframe ──
  const ytIframeCommand = useCallback((func: string) => {
    const iframe = ytIframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args: "" }), YT_ORIGIN);
    }
  }, []);

  // ── Imperative Handle ──
  useImperativeHandle(ref, () => ({
    play: () => {
      if (playlistType === "youtube") {
        if (ytReadyRef.current && ytPlayerRef.current) {
          try { ytPlayerRef.current.playVideo(); } catch {}
        } else {
          ytIframeCommand("playVideo");
          setIsPlaying(true);
        }
      } else if (videoRef.current) {
        videoRef.current.play().catch(() => {});
      }
    },
    pause: () => {
      if (playlistType === "youtube") {
        if (ytReadyRef.current && ytPlayerRef.current) {
          try { ytPlayerRef.current.pauseVideo(); } catch {}
        } else {
          ytIframeCommand("pauseVideo");
          setIsPlaying(false);
        }
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
  }), [playlistType, ytIframeCommand]);

  // ── Controls auto-hide ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const resetTimer = () => {
      if (controlsFrameRef.current !== null) cancelAnimationFrame(controlsFrameRef.current);
      controlsFrameRef.current = requestAnimationFrame(() => {
        if (!showControlsRef.current) {
          showControlsRef.current = true;
          setShowControls(true);
        }
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
          showControlsRef.current = false;
          setShowControls(false);
        }, 2500);
      });
    };

    el.addEventListener("mousemove", resetTimer, { passive: true });
    el.addEventListener("touchstart", resetTimer, { passive: true });
    resetTimer();

    return () => {
      if (controlsFrameRef.current !== null) cancelAnimationFrame(controlsFrameRef.current);
      clearTimeout(controlsTimeoutRef.current);
      el.removeEventListener("mousemove", resetTimer);
      el.removeEventListener("touchstart", resetTimer);
    };
  }, []);

  // ══════════════════════════════════════════
  //  HLS / M3U8 — CORRECT INIT ORDER
  // ══════════════════════════════════════════
  useEffect(() => {
    if (playlistType !== "m3u8") return;
    const video = videoRef.current;
    if (!video || !playlistUrl) return;
    let destroyed = false;

    if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
    if (inactiveRetryRef.current) { clearTimeout(inactiveRetryRef.current); inactiveRetryRef.current = undefined; }
    fragLoadedRef.current = false;
    video.removeAttribute("src");
    setIsPlaying(false);
    setIsLoading(true);
    setQualities([]);
    setSelectedQuality(-1);
    setIsBehindLive(false);
    setPlayerError(null);
    setStreamInactive(false);
    userQualityRef.current = -1;

    let waitingTimer: ReturnType<typeof setTimeout> | null = null;

    const onPlay = () => { if (!destroyed) { setIsPlaying(true); setIsLoading(false); } };
    const onPause = () => { if (!destroyed) setIsPlaying(false); };
    const onPlaying = () => { if (!destroyed) { setIsLoading(false); if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; } } };
    const onCanPlay = () => { if (!destroyed) { setIsLoading(false); if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = null; } } };
    const onWaiting = () => {
      if (!destroyed) {
        if (waitingTimer) clearTimeout(waitingTimer);
        waitingTimer = setTimeout(() => { if (!destroyed) setIsLoading(true); }, 800);
      }
    };
    const onError = () => {
      if (!destroyed && video.error) {
        if (video.src && video.error.code !== MediaError.MEDIA_ERR_ABORTED) {
          console.error("[VideoPlayer] video error", video.error.code, video.error.message);
        }
      }
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("error", onError);

    const loadingTimeout = setTimeout(() => {
      if (!destroyed && !fragLoadedRef.current) {
        console.warn("[HLS] No playback after 8s — stream inactive");
        setIsLoading(false);
        setStreamInactive(true);
        setPlayerError(null);
        if (inactiveRetryRef.current) clearTimeout(inactiveRetryRef.current);
        inactiveRetryRef.current = setTimeout(() => {
          if (!destroyed) {
            setStreamInactive(false);
            setIsLoading(true);
            fragLoadedRef.current = false;
            if (hlsRef.current) hlsRef.current.loadSource(playlistUrl);
          }
        }, 10000);
      }
    }, 8000);

    const initHls = async () => {
      const HlsModule = await import("hls.js");
      const Hls = HlsModule.default;
      if (destroyed) return;

      if (!Hls.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = playlistUrl;
          video.addEventListener("loadedmetadata", () => {
            if (!destroyed && autoPlay) video.play().catch(() => {});
          }, { once: true });
        } else {
          setPlayerError("Browser tidak mendukung HLS");
          setIsLoading(false);
        }
        return;
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 15,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        maxBufferHole: 0.5,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 5,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        liveBackBufferLength: 10,
        capLevelToPlayerSize: true,
        startLevel: -1,
        startFragPrefetch: true,
        progressive: true,
        fragLoadingMaxRetry: 8,
        manifestLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        manifestLoadingTimeOut: 10000,
        fragLoadingTimeOut: 15000,
        levelLoadingTimeOut: 10000,
        testBandwidth: true,
        abrEwmaDefaultEstimate: 500000,
        xhrSetup: (xhr: XMLHttpRequest, _url: string) => {
          xhr.withCredentials = false;
          // Inject custom headers for proxy stream (Player 3) — read from ref for always-latest token
          const hdrs = customHeadersRef?.current;
          if (hdrs) {
            Object.entries(hdrs).forEach(([key, value]) => {
              xhr.setRequestHeader(key, value);
            });
          }
        },
      });
      hlsRef.current = hls;
      let networkRetryCount = 0;
      const MAX_NETWORK_RETRIES = 5;
      let mediaRecoveryAttempted = false;
      let fragLoaded = false;
      let inactiveFallbackTimer: ReturnType<typeof setTimeout> | null = null;

      hls.on(Hls.Events.MANIFEST_PARSED, (_: any, data: any) => {
        if (destroyed) return;
        // Check if manifest has no usable levels (inactive stream returns empty ENDLIST)
        if (!data.levels || data.levels.length === 0) {
          console.warn("[HLS] Manifest parsed but no levels — stream inactive");
          setStreamInactive(true);
          setIsLoading(false);
          // Auto-retry every 10s
          inactiveRetryRef.current = setTimeout(() => {
            if (!destroyed && hlsRef.current) {
              console.log("[HLS] Retrying inactive stream...");
              setStreamInactive(false);
              setIsLoading(true);
              fragLoaded = false;
              fragLoadedRef.current = false;
              hls.loadSource(playlistUrl);
            }
          }, 10000);
          return;
        }
        setStreamInactive(false);
        networkRetryCount = 0;
        // Fallback: if no fragment loads within 6s, treat as inactive
        if (inactiveFallbackTimer) clearTimeout(inactiveFallbackTimer);
        inactiveFallbackTimer = setTimeout(() => {
          if (destroyed || fragLoaded) return;
          console.warn("[HLS] No fragments loaded after 6s — stream inactive");
          setStreamInactive(true);
          setIsLoading(false);
          if (inactiveRetryRef.current) clearTimeout(inactiveRetryRef.current);
          inactiveRetryRef.current = setTimeout(() => {
            if (!destroyed && hlsRef.current) {
              setStreamInactive(false);
              setIsLoading(true);
              fragLoaded = false;
              hls.loadSource(playlistUrl);
            }
          }, 10000);
        }, 6000);
        const seen = new Map<string, { label: string; value: number; bitrate: number }>();
        (data.levels || []).forEach((l: any, i: number) => {
          const label = l.height ? `${l.height}p` : `Level ${i}`;
          const existing = seen.get(label);
          if (!existing || (l.bitrate || 0) > existing.bitrate) {
            seen.set(label, { label, value: i, bitrate: l.bitrate || 0 });
          }
        });
        const levels = Array.from(seen.values()).map(({ label, value }) => ({ label, value }));
        setQualities([{ label: "Auto", value: -1 }, ...levels]);
        if (autoPlay) {
          video.muted = true;
          video.play().catch(() => {});
          setTimeout(() => { if (!destroyed && video) video.muted = false; }, 1500);
        }
      });

      // Detect inactive stream via LEVEL_LOADED (empty fragments in ENDLIST manifest)
      hls.on(Hls.Events.LEVEL_LOADED, (_: any, levelData: any) => {
        if (destroyed) return;
        const details = levelData.details;
        if (details && details.fragments && details.fragments.length === 0 && details.live === false) {
          console.warn("[HLS] Level loaded but 0 fragments + ENDLIST — stream inactive");
          setStreamInactive(true);
          setIsLoading(false);
          setPlayerError(null);
          if (inactiveRetryRef.current) clearTimeout(inactiveRetryRef.current);
          inactiveRetryRef.current = setTimeout(() => {
            if (!destroyed && hlsRef.current) {
              console.log("[HLS] Retrying inactive stream from LEVEL_LOADED...");
              setStreamInactive(false);
              setIsLoading(true);
              fragLoaded = false;
              fragLoadedRef.current = false;
              hls.loadSource(playlistUrl);
            }
          }, 10000);
          return;
        }
        // If we got fragments, stream is active
        if (details && details.fragments && details.fragments.length > 0) {
          setStreamInactive(false);
        }
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        if (!destroyed) {
          fragLoaded = true;
          fragLoadedRef.current = true;
          if (inactiveFallbackTimer) { clearTimeout(inactiveFallbackTimer); inactiveFallbackTimer = null; }
          networkRetryCount = 0; setIsLoading(false); setStreamInactive(false);
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_: any, d: any) => {
        if (!destroyed) {
          // Only update UI if user is on Auto mode; otherwise keep their selection displayed
          if (userQualityRef.current === -1) {
            setSelectedQuality(d.level);
          }
        }
      });

      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (destroyed) return;
        console.warn("[HLS] Error:", data.type, data.details, data.fatal);
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // Detect manifest load error as potential inactive stream
            if (data.details === "manifestLoadError" || data.details === "manifestParsingError") {
              console.warn("[HLS] Manifest error — treating as inactive stream, retrying in 10s");
              setStreamInactive(true);
              setIsLoading(false);
              setPlayerError(null);
              if (inactiveRetryRef.current) clearTimeout(inactiveRetryRef.current);
              inactiveRetryRef.current = setTimeout(() => {
                if (!destroyed && hlsRef.current) {
                  console.log("[HLS] Retrying inactive stream...");
                  setStreamInactive(false);
                  setIsLoading(true);
                  fragLoaded = false;
                  fragLoadedRef.current = false;
                  hls.loadSource(playlistUrl);
                }
              }, 10000);
              return;
            }
            networkRetryCount++;
            if (networkRetryCount <= MAX_NETWORK_RETRIES) {
              const delay = Math.min(2000 * networkRetryCount, 10000);
              setTimeout(() => {
                if (destroyed || !hlsRef.current) return;
                if (data.details === "manifestLoadTimeOut") {
                  hls.loadSource(playlistUrl);
                } else {
                  hls.startLoad();
                }
              }, delay);
            } else {
              setPlayerError("Koneksi terputus. Coba refresh halaman.");
              setIsLoading(false);
            }
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            if (!mediaRecoveryAttempted) {
              mediaRecoveryAttempted = true;
              hls.recoverMediaError();
            } else {
              hls.swapAudioCodec();
              hls.recoverMediaError();
            }
          } else {
            setPlayerError("Stream error. Coba refresh halaman.");
            setIsLoading(false);
          }
        } else if (data.details === "bufferStalledError") {
          if (video.buffered.length > 0) {
            const end = video.buffered.end(video.buffered.length - 1);
            if (end - video.currentTime > 0.5) video.currentTime = end - 0.3;
          }
          if (video.paused) video.play().catch(() => {});
        }
      });

      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (destroyed) return;
        hls.loadSource(playlistUrl);
      });

      const liveCheckId = setInterval(() => {
        if (destroyed || video.paused || !hls.liveSyncPosition) return;
        const behindLive = hls.liveSyncPosition - video.currentTime > 8;
        if (isBehindLiveRef.current !== behindLive) {
          isBehindLiveRef.current = behindLive;
          setIsBehindLive(behindLive);
        }
      }, 3000);

      const onVisible = () => {
        if (destroyed || document.hidden || !hlsRef.current) return;
        hlsRef.current.startLoad();
        if (video.paused) video.play().catch(() => {});
        if (hlsRef.current.liveSyncPosition && hlsRef.current.liveSyncPosition - video.currentTime > 5) {
          video.currentTime = hlsRef.current.liveSyncPosition;
        }
      };
      document.addEventListener("visibilitychange", onVisible);

      const healthId = setInterval(() => {
        if (destroyed || document.hidden || video.paused || !hlsRef.current) return;
        if (video.readyState < 3) hlsRef.current.startLoad();
      }, 20000);

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
      clearTimeout(loadingTimeout);
      clearTimeout(qualityChangeTimerRef.current);
      if (inactiveRetryRef.current) clearTimeout(inactiveRetryRef.current);
      
      if (waitingTimer) clearTimeout(waitingTimer);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("error", onError);
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch {} hlsRef.current = null; }
    };
  }, [playlistType, playlistUrl, autoPlay]);

  // ══════════════════════════════════════════
  //  YouTube — API with iframe fallback
  // ══════════════════════════════════════════
  const [ytMode, setYtMode] = useState<"loading" | "api" | "iframe">("loading");
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytBufferTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (playlistType !== "youtube" || !playlistUrl) return;
    let destroyed = false;
    let playerCreated = false;

    setIsPlaying(false);
    setIsLoading(true);
    setQualities([]);
    setPlayerError(null);
    setYtMode("loading");
    ytReadyRef.current = false;
    ytIframeRef.current = null;

    const videoId = extractVideoId(playlistUrl);
    if (!videoId || videoId.length < 5) {
      console.error("[YT] Invalid video ID from:", playlistUrl);
      setPlayerError("YouTube video ID tidak valid");
      setIsLoading(false);
      return;
    }

    // Fallback to iframe after 6s if API doesn't load
    const fallbackTimer = setTimeout(() => {
      if (!destroyed && !ytReadyRef.current) {
        console.warn("[YT] API timeout, falling back to iframe");
        setYtMode("iframe");
        // Don't set isPlaying=true here — let the iframe autoplay and we'll
        // listen for the actual state via postMessage
        setIsLoading(false);
      }
    }, 6000);

    const createPlayer = () => {
      if (destroyed || playerCreated) return;
      playerCreated = true;

      const container = ytContainerRef.current;
      if (!container) { setYtMode("iframe"); setIsLoading(false); return; }
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
            controls: 0,
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
              try {
                e.target.setPlaybackQualityRange?.("default", "default");
                e.target.setPlaybackQuality?.("default");
              } catch {}
              if (autoPlay) {
                e.target.playVideo();
                setIsPlaying(true);
                setYtMuted(true);
                setTimeout(() => {
                  if (!destroyed) {
                    try { ytPlayerRef.current?.unMute?.(); setYtMuted(false); } catch {}
                  }
                }, 1500);
              }
            },
            onStateChange: (e: any) => {
              if (destroyed) return;
              setIsPlaying(e.data === 1);
              if (e.data === 3) {
                clearTimeout(ytBufferTimerRef.current);
                ytBufferTimerRef.current = setTimeout(() => {
                  if (!destroyed) setIsLoading(true);
                }, 1000);
              } else if (e.data === 1) {
                clearTimeout(ytBufferTimerRef.current);
                setIsLoading(false);
              } else if (e.data === 0 || e.data === 2) {
                clearTimeout(ytBufferTimerRef.current);
                setIsLoading(false);
              }
            },
            onError: (e: any) => {
              if (destroyed) return;
              console.error("[YT] Player error:", e.data);
              setYtMode("iframe");
              setIsLoading(false);
            },
          },
        });
      } catch (err) {
        console.error("[YT] Failed to create player:", err);
        if (!destroyed) { setYtMode("iframe"); setIsLoading(false); }
      }
    };

    // Load YouTube IFrame API
    if ((window as any).YT?.Player) {
      createPlayer();
    } else {
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.onerror = () => { if (!destroyed) { setYtMode("iframe"); setIsLoading(false); } };
        document.head.appendChild(tag);
      }
      const prevReady = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        prevReady?.();
        if (!destroyed && !playerCreated) createPlayer();
      };
      const pollId = setInterval(() => {
        if (destroyed) { clearInterval(pollId); return; }
        if ((window as any).YT?.Player && !playerCreated) { clearInterval(pollId); createPlayer(); }
      }, 500);
      setTimeout(() => clearInterval(pollId), 10000);
    }

    // Listen for YT iframe postMessage state updates (works for both API and iframe fallback)
    const onYtMessage = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || destroyed) return;
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.event === "onStateChange" || d?.info?.playerState !== undefined) {
          const state = d?.info?.playerState ?? d?.data;
          if (state === 1) { setIsPlaying(true); setIsLoading(false); }
          else if (state === 2 || state === 0) { setIsPlaying(false); setIsLoading(false); }
          else if (state === 3) { /* buffering — handled by timer */ }
        }
        // Detect when iframe starts playing (for autoplay confirmation)
        if (d?.event === "onReady" || (d?.info?.playerState === 1)) {
          setIsPlaying(true);
          setIsLoading(false);
        }
      } catch { /* ignore non-JSON messages */ }
    };
    window.addEventListener("message", onYtMessage);

    return () => {
      destroyed = true;
      ytReadyRef.current = false;
      ytIframeRef.current = null;
      clearTimeout(fallbackTimer);
      clearTimeout(ytBufferTimerRef.current);
      window.removeEventListener("message", onYtMessage);
      try { ytPlayerRef.current?.destroy?.(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [playlistUrl, playlistType, autoPlay, extractVideoId]);

  // ── Control handlers ──
  const handlePlayPause = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlistType === "youtube") {
      if (ytMode === "api") {
        if (!ytReadyRef.current || !ytPlayerRef.current) return;
        try {
          const state = ytPlayerRef.current.getPlayerState();
          if (state === 1 || state === 3) ytPlayerRef.current.pauseVideo();
          else ytPlayerRef.current.playVideo();
        } catch {}
      } else if (ytMode === "iframe") {
        if (isPlaying) {
          ytIframeCommand("pauseVideo");
          setIsPlaying(false);
        } else {
          ytIframeCommand("playVideo");
          setIsPlaying(true);
        }
      }
    } else if (playlistType === "cloudflare") {
      // cloudflare iframe has its own controls
    } else {
      const v = videoRef.current;
      if (!v) return;
      v.paused ? v.play().catch(() => {}) : v.pause();
    }
  }, [playlistType, ytMode, isPlaying, ytIframeCommand]);

  const handleQualityChange = useCallback((level: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    userQualityRef.current = level;

    // Find label for animation
    const q = qualities.find(q => q.value === level);
    const label = q?.label || "Auto";
    setQualityChanging(label);
    clearTimeout(qualityChangeTimerRef.current);
    qualityChangeTimerRef.current = setTimeout(() => setQualityChanging(null), 1600);

    if (level === -1) {
      hls.currentLevel = -1;
      hls.nextLevel = -1;
      hls.autoLevelCapping = -1;
      try { hls.autoLevelEnabled = true; } catch {}
    } else {
      try { hls.autoLevelEnabled = false; } catch {}
      hls.currentLevel = level;
      hls.nextLevel = level;
      hls.autoLevelCapping = level;
    }
    setSelectedQuality(level);
    setShowQualityMenu(false);
  }, [qualities]);

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
    if (ytMode === "api") {
      if (!ytReadyRef.current || !ytPlayerRef.current) return;
      try {
        if (ytPlayerRef.current.isMuted()) { ytPlayerRef.current.unMute(); setYtMuted(false); }
        else { ytPlayerRef.current.mute(); setYtMuted(true); }
      } catch {}
    } else if (ytMode === "iframe") {
      if (ytMuted) {
        ytIframeCommand("unMute");
        setYtMuted(false);
      } else {
        ytIframeCommand("mute");
        setYtMuted(true);
      }
    }
  }, [ytMode, ytMuted, ytIframeCommand]);

  const syncToLive = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playlistType === "m3u8" && hlsRef.current && videoRef.current) {
      const hls = hlsRef.current;
      if (hls.liveSyncPosition) videoRef.current.currentTime = hls.liveSyncPosition;
      else if (videoRef.current.buffered.length > 0) {
        videoRef.current.currentTime = videoRef.current.buffered.end(videoRef.current.buffered.length - 1) - 0.5;
      }
      if (videoRef.current.paused) videoRef.current.play().catch(() => {});
      isBehindLiveRef.current = false;
      setIsBehindLive(false);
    } else if (playlistType === "youtube") {
      if (ytReadyRef.current && ytPlayerRef.current) {
        try {
          const d = ytPlayerRef.current.getDuration?.();
          if (d > 0) ytPlayerRef.current.seekTo(d, true);
        } catch {}
        try { ytPlayerRef.current.playVideo(); } catch {}
      } else {
        // iframe fallback: seek to end
        ytIframeCommand("playVideo");
      }
    }
  }, [playlistType, ytIframeCommand]);

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

  // YouTube iframe URL — controls=0, disablekb=1, enablejsapi=1 for postMessage control
  const ytIframeUrl = playlistType === "youtube"
    ? `https://www.youtube.com/embed/${extractVideoId(playlistUrl)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&origin=${encodeURIComponent(window.location.origin)}&enablejsapi=1`
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
      {/* M3U8 / HLS video element */}
      {playlistType === "m3u8" && (
        <video
          ref={videoRef}
          onClick={handlePlayPause}
          className={`h-full w-full object-contain cursor-pointer bg-black ${isFullscreen ? "max-h-screen" : "absolute inset-0"}`}
          playsInline
          autoPlay
          muted
          // @ts-ignore
          webkit-playsinline=""
          x-webkit-airplay="allow"
          preload="auto"
        />
      )}

      {/* YouTube API player container — overlay ALWAYS shown (including during loading) to block access */}
      {playlistType === "youtube" && ytMode !== "iframe" && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}>
          <div
            ref={ytContainerRef}
            className="absolute inset-0 w-full h-full [&>div]:!w-full [&>div]:!h-full [&>iframe]:!w-full [&>iframe]:!h-full [&>div>iframe]:!w-full [&>div>iframe]:!h-full [&_iframe]:!w-full [&_iframe]:!h-full [&_iframe]:!absolute [&_iframe]:!inset-0"
          />
          {/* Overlay always present — blocks YouTube UI during loading AND api mode */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.001)", pointerEvents: "all" }}
            onContextMenu={e => e.preventDefault()}
            onClick={e => { e.stopPropagation(); handlePlayPause(e); }}
          />
        </div>
      )}

      {/* YouTube iframe fallback — full overlay, video plays underneath via autoplay */}
      {playlistType === "youtube" && ytMode === "iframe" && (
        <div className={`relative w-full h-full ${isFullscreen ? "max-h-screen aspect-video" : "absolute inset-0"}`}>
          <iframe
            ref={(el) => { ytIframeRef.current = el; }}
            src={ytIframeUrl}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
            allowFullScreen
            className="absolute inset-0 w-full h-full border-0 z-[1]"
            // @ts-ignore
            playsInline=""
          />
          {/* Full overlay — blocks ALL YouTube buttons & source URL access */}
          <div
            className="absolute inset-0 z-[2] cursor-pointer"
            style={{ background: "rgba(0,0,0,0.001)", pointerEvents: "all" }}
            onContextMenu={e => e.preventDefault()}
            onClick={e => { e.stopPropagation(); handlePlayPause(e); }}
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

      {/* Stream inactive overlay */}
      {streamInactive && (
        <div className="absolute inset-0 z-[15] flex items-center justify-center bg-black/90">
          <div className="text-center p-6">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/20">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            </div>
            <p className="text-white/80 text-sm font-semibold mb-1">Stream Belum Aktif</p>
            <p className="text-white/50 text-xs mb-3">Menunggu siaran dimulai...</p>
            <div className="flex items-center justify-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0s" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0.15s" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0.3s" }} />
            </div>
          </div>
        </div>
      )}

      {/* Loading spinner */}
      {isLoading && !playerError && !streamInactive && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-[3px] border-white/20 border-t-primary animate-spin" />
            <span className="text-white/70 text-xs font-medium tracking-wide">Menghubungkan...</span>
          </div>
        </div>
      )}

      {/* Quality change animation overlay */}
      {qualityChanging && (
        <div
          className="absolute inset-0 z-[6] flex items-center justify-center pointer-events-none"
          style={{ animation: "quality-toast 1.6s ease-out forwards" }}
        >
          <div className="flex items-center gap-2.5 rounded-full bg-black/75 px-5 py-2.5 shadow-lg border border-white/10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" className="animate-spin" style={{ animationDuration: "1s" }}>
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span className="text-white text-xs font-bold">{qualityChanging}</span>
          </div>
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
        <button onClick={handlePlayPause} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/80 text-primary-foreground transition hover:bg-primary">
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          )}
        </button>

        {/* YT Mute toggle — works in both API and iframe mode */}
        {playlistType === "youtube" && (ytMode === "api" || ytMode === "iframe") && (
          <button onClick={toggleYtMute} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30" title={ytMuted ? "Unmute" : "Mute"}>
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
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${isBehindLive ? "bg-red-600 text-white animate-pulse hover:bg-red-700" : "bg-white/20 text-white hover:bg-white/30"}`}
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
              className="flex h-10 items-center gap-1.5 rounded-full bg-primary/90 px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary shadow-lg border border-white/20"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              {qualities.find(q => q.value === selectedQuality)?.label || "Auto"}
            </button>
            {showQualityMenu && (
              <div className="absolute bottom-full right-0 mb-2 rounded-xl bg-black/90 border border-white/20 p-1.5 shadow-2xl min-w-[130px]">
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
        <button onClick={toggleOrientation} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30" title="Rotate">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
        </button>

        {/* Fullscreen */}
        <button onClick={toggleFullscreen} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30" title="Fullscreen">
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
