import { useEffect, useRef, useState } from "react";
import Hls, { type Level } from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize, Settings } from "lucide-react";

interface Props {
  src: string;
  poster?: string | null;
  onError?: (msg: string) => void;
}

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
  const [currentLevel, setCurrentLevel] = useState<number>(-1); // -1 = auto
  const [showQuality, setShowQuality] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        // Replay/VOD: jangan buang segmen lama, simpan seluruh buffer agar bisa
        // di-seek dari awal sampai akhir. Default backBufferLength=90 detik
        // membuat playlist EVENT/live-style hanya menampilkan bagian akhir.
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
        // Untuk replay: paksa mulai dari awal (currentTime=0).
        // Tanpa ini, playlist EVENT tanpa #EXT-X-ENDLIST akan diperlakukan
        // seperti live & user hanya melihat bagian paling akhir.
        try {
          if (video.currentTime < 0.1) {
            video.currentTime = 0;
          }
        } catch {}
      });
      hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
        // Jika manifest sebenarnya VOD tapi tidak diberi tanda ENDLIST oleh
        // origin, tetap perlakukan sebagai VOD agar seekable bar penuh.
        const details: any = data.details;
        if (details && details.live && details.endSN > 0) {
          // Override: anggap sebagai VOD setelah semua segmen termuat
          if (details.endSN === details.startSN + details.fragments.length - 1) {
            details.live = false;
          }
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
      video.src = src; // Safari native
    } else {
      onError?.("Browser tidak mendukung HLS");
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src, onError]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      if (v.duration) setProgress((v.currentTime / v.duration) * 100);
      setDuration(v.duration || 0);
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onTime);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onTime);
    };
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    v.currentTime = ratio * v.duration;
  };

  const setLevel = (idx: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = idx; // -1 = auto
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
    if (!isFinite(s)) return "00:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        poster={poster || undefined}
        className="aspect-video w-full"
        playsInline
        onClick={togglePlay}
      />

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 space-y-2">
        <div
          className="h-1.5 w-full cursor-pointer rounded-full bg-white/20"
          onClick={handleSeek}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <span className="text-xs tabular-nums opacity-80">
              {fmt((videoRef.current?.currentTime) || 0)} / {fmt(duration)}
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
