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
      // Detach from old video
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

    // Also check when PiP state changes globally
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
          // Ensure video has enough data to enter PiP
          if (video.readyState < 2) {
            await new Promise<void>((resolve) => {
              const onReady = () => { video.removeEventListener("loadeddata", onReady); resolve(); };
              video.addEventListener("loadeddata", onReady);
              setTimeout(resolve, 3000); // timeout fallback
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
    return (
      <button
        disabled
        className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/40 text-muted-foreground cursor-not-allowed opacity-50"
        title="PiP tidak tersedia untuk YouTube"
      >
        <PictureInPicture2 className="h-4 w-4" />
      </button>
    );
  }

  if (!supported) return null;

  return (
    <button
      onClick={togglePip}
      className={`flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-sm transition ${
        active ? "bg-primary text-primary-foreground" : "bg-secondary/80 text-secondary-foreground hover:bg-secondary"
      }`}
      title={active ? "Keluar dari Picture-in-Picture" : "Picture-in-Picture"}
    >
      <PictureInPicture2 className="h-4 w-4" />
    </button>
  );
};

export default PipButton;
