import { useCallback, useState, useEffect, useRef } from "react";
import { PictureInPicture2 } from "lucide-react";

const PipButton = () => {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [isYouTube, setIsYouTube] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const hasPip = 'pictureInPictureEnabled' in document && (document as any).pictureInPictureEnabled;

    const onEnter = () => setActive(true);
    const onLeave = () => setActive(false);

    const attachVideoListeners = (video: HTMLVideoElement | null) => {
      if (videoRef.current) {
        videoRef.current.removeEventListener("enterpictureinpicture", onEnter);
        videoRef.current.removeEventListener("leavepictureinpicture", onLeave);
      }
      videoRef.current = video;
      if (video) {
        video.addEventListener("enterpictureinpicture", onEnter);
        video.addEventListener("leavepictureinpicture", onLeave);
      }
    };

    const checkVideo = () => {
      const video = document.querySelector("video");
      const ytIframe = document.querySelector('iframe[src*="youtube"]');
      setIsYouTube(!video && !!ytIframe);
      setSupported(hasPip && !!video);
      if (video !== videoRef.current) {
        attachVideoListeners(video);
      }
    };

    checkVideo();
    const interval = setInterval(checkVideo, 2000);

    setActive(!!(document as any).pictureInPictureElement);

    return () => {
      clearInterval(interval);
      if (videoRef.current) {
        videoRef.current.removeEventListener("enterpictureinpicture", onEnter);
        videoRef.current.removeEventListener("leavepictureinpicture", onLeave);
      }
    };
  }, []);

  const togglePip = useCallback(async () => {
    try {
      if ((document as any).pictureInPictureElement) {
        await (document as any).exitPictureInPicture();
        setActive(false);
      } else {
        const video = document.querySelector("video");
        if (video) {
          if (video.readyState < 2) {
            await new Promise<void>((resolve) => {
              const onReady = () => { video.removeEventListener("loadeddata", onReady); resolve(); };
              video.addEventListener("loadeddata", onReady);
              setTimeout(resolve, 3000);
            });
          }
          await (video as any).requestPictureInPicture();
          setActive(true);
        }
      }
    } catch (err) {
      console.warn("PiP toggle failed:", err);
    }
  }, []);

  if (isYouTube) {
    return null; // Hide for YouTube — not supported reliably
  }

  if (!supported) return null;

  return (
    <button
      onClick={togglePip}
      className={`flex items-center gap-1.5 rounded-full backdrop-blur-md transition-all px-3 py-1.5 shadow-lg border ${
        active
          ? "bg-primary text-primary-foreground border-primary/50 shadow-primary/40"
          : "bg-black/70 text-white border-white/30 hover:bg-black/85 hover:border-primary/60"
      }`}
      title={active ? "Keluar dari Picture-in-Picture" : "Buka Picture-in-Picture (mini player)"}
      aria-label="Toggle Picture-in-Picture"
    >
      <PictureInPicture2 className="h-4 w-4" />
      <span className="text-xs font-semibold tracking-wide">PiP</span>
    </button>
  );
};

export default PipButton;
