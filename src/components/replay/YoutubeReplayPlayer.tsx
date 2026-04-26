import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize } from "lucide-react";

interface Props {
  url: string; // YouTube URL or ID
  poster?: string | null;
}

// Extract video id from youtube url forms
const parseYoutubeId = (url: string): string => {
  if (!url) return "";
  const m1 = url.match(/[?&]v=([\w-]{6,})/);
  if (m1) return m1[1];
  const m2 = url.match(/youtu\.be\/([\w-]{6,})/);
  if (m2) return m2[1];
  const m3 = url.match(/youtube\.com\/embed\/([\w-]{6,})/);
  if (m3) return m3[1];
  if (/^[\w-]{6,}$/.test(url)) return url;
  return "";
};

const YoutubeReplayPlayer = ({ url, poster }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  const id = parseYoutubeId(url);

  // Embed parameters: hide controls + branding + related, request highest quality (vq=hd1080)
  const src = id
    ? `https://www.youtube.com/embed/${id}?enablejsapi=1&controls=0&modestbranding=1&rel=0&showinfo=0&fs=0&iv_load_policy=3&disablekb=1&playsinline=1&vq=hd1080&autoplay=0`
    : "";

  const post = (func: string, args: any[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*",
    );
  };

  // Lazy YT IFrame API for state events (muted/playing)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      try {
        const data = JSON.parse(e.data);
        if (data.event === "infoDelivery" && data.info) {
          if (typeof data.info.muted === "boolean") setMuted(data.info.muted);
          if (typeof data.info.playerState === "number") {
            setPlaying(data.info.playerState === 1);
          }
        }
      } catch {
        /* noop */
      }
    };
    window.addEventListener("message", onMessage);

    // Subscribe to state updates
    const sub = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "listening" }),
        "*",
      );
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"] }),
        "*",
      );
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "setPlaybackQuality", args: ["hd1080"] }),
        "*",
      );
    }, 800);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(sub);
    };
  }, [src]);

  if (!id) {
    return (
      <div className="aspect-video w-full flex items-center justify-center rounded-xl bg-black text-sm text-muted-foreground">
        Link YouTube tidak valid
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

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-xl bg-black">
      <div className="aspect-video w-full">
        <iframe
          ref={iframeRef}
          src={src}
          title="Replay"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen={false}
          className="h-full w-full"
        />
      </div>

      {/* Click-blocking overlay so users cannot click through into youtube.com */}
      <div
        className="absolute inset-0 z-10"
        style={{ background: "transparent" }}
        onClick={togglePlay}
        onContextMenu={(e) => e.preventDefault()}
        aria-hidden
      />

      {/* Custom controls (z-20) */}
      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 to-transparent p-3 flex items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <span className="text-[10px] uppercase tracking-wide opacity-70">YouTube • HD</span>
        </div>
        <button onClick={enterFullscreen} aria-label="Fullscreen">
          <Maximize className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default YoutubeReplayPlayer;
