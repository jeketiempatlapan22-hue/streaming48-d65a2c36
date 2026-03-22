import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type StreamType = "m3u8" | "cloudflare" | "youtube";

interface VideoPlayerProps {
  url: string;
  type: StreamType;
}

const VideoPlayer = ({ url, type }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (type !== "m3u8" || !videoRef.current || !url) return;

    const video = videoRef.current;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError("Gagal memuat stream M3U8. Periksa URL Anda.");
      });
      return () => hls.destroy();
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
    } else {
      setError("Browser Anda tidak mendukung pemutaran HLS.");
    }
  }, [url, type]);

  if (error) {
    return (
      <div className="flex items-center justify-center aspect-video bg-muted rounded-lg border border-border">
        <p className="text-destructive text-sm">{error}</p>
      </div>
    );
  }

  if (type === "youtube") {
    const videoId = url.includes("youtube.com") || url.includes("youtu.be")
      ? url.match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] ?? url
      : url;

    return (
      <div className="aspect-video rounded-lg overflow-hidden border border-border shadow-lg shadow-primary/5">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0`}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="YouTube Player"
        />
      </div>
    );
  }

  if (type === "cloudflare") {
    // Support full iframe URLs, watch URLs, or plain video IDs
    let embedUrl = "";
    if (url.includes("cloudflarestream.com") && url.includes("/iframe")) {
      embedUrl = url;
    } else if (url.includes("cloudflarestream.com")) {
      const id = url.split("/").filter(Boolean).pop();
      embedUrl = `https://iframe.videodelivery.net/${id}`;
    } else {
      // Assume plain video ID
      embedUrl = `https://iframe.videodelivery.net/${url}`;
    }

    return (
      <div className="aspect-video rounded-lg overflow-hidden border border-border shadow-lg shadow-primary/5">
        <iframe
          src={embedUrl}
          className="w-full h-full"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Cloudflare Stream Player"
        />
      </div>
    );
  }

  return (
    <div className="aspect-video rounded-lg overflow-hidden border border-border shadow-lg shadow-primary/5">
      <video
        ref={videoRef}
        controls
        className="w-full h-full bg-black"
        playsInline
      />
    </div>
  );
};

export default VideoPlayer;
