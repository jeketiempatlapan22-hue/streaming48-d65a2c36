import { useCallback, useState, useEffect, useRef } from "react";
import { PictureInPicture2 } from "lucide-react";

const PipButton = () => {
  const [hasVideo, setHasVideo] = useState(false);
  const [pipEnabled, setPipEnabled] = useState(false);
  const [active, setActive] = useState(false);
  const [isYouTube, setIsYouTube] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const hasPip = 'pictureInPictureEnabled' in document && (document as any).pictureInPictureEnabled;
    setPipEnabled(!!hasPip);

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
      setHasVideo(!!video);
      if (video !== videoRef.current) {
        attachVideoListeners(video);
      }
    };

    checkVideo();
    const interval = setInterval(checkVideo, 1500);

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

  // Hide entirely on YouTube embeds (PiP not supported reliably) or if browser lacks PiP API
  if (isYouTube || !pipEnabled) return null;

  const disabled = !hasVideo;

  return (
    <button
      type="button"
      onClick={togglePip}
      disabled={disabled}
      aria-pressed={active}
      title={
        disabled
          ? "Picture-in-Picture akan aktif saat video mulai diputar"
          : active
            ? "Keluar dari Picture-in-Picture"
            : "Buka mini player (Picture-in-Picture)"
      }
      aria-label="Toggle Picture-in-Picture"
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 border shrink-0 ${
        active
          ? "bg-accent text-accent-foreground border-accent shadow-sm shadow-accent/30"
          : disabled
            ? "border-dashed border-border bg-muted/40 text-muted-foreground/70 cursor-not-allowed"
            : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/70"
      }`}
    >
      <PictureInPicture2 className="h-3.5 w-3.5 shrink-0" />
      <span className="tracking-wide">PiP</span>
    </button>
  );
};

export default PipButton;
