import { useCallback, useState, useEffect } from "react";
import { PictureInPicture2 } from "lucide-react";

const PipButton = () => {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [isYouTube, setIsYouTube] = useState(false);

  useEffect(() => {
    const hasPip = 'pictureInPictureEnabled' in document && (document as any).pictureInPictureEnabled;
    setSupported(hasPip);

    const onEnter = () => setActive(true);
    const onLeave = () => setActive(false);
    document.addEventListener("enterpictureinpicture", onEnter);
    document.addEventListener("leavepictureinpicture", onLeave);

    // Detect if YouTube player is active (no native <video>)
    const checkYt = () => {
      const video = document.querySelector("video");
      const ytIframe = document.querySelector('iframe[src*="youtube"]');
      setIsYouTube(!video && !!ytIframe);
      setSupported(hasPip && !!video);
    };
    checkYt();
    const interval = setInterval(checkYt, 3000);

    return () => {
      document.removeEventListener("enterpictureinpicture", onEnter);
      document.removeEventListener("leavepictureinpicture", onLeave);
      clearInterval(interval);
    };
  }, []);

  const togglePip = useCallback(async () => {
    try {
      if ((document as any).pictureInPictureElement) {
        await (document as any).exitPictureInPicture();
      } else {
        const video = document.querySelector("video");
        if (video) await (video as any).requestPictureInPicture();
      }
    } catch {}
  }, []);

  // Show disabled state for YouTube
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
      title="Picture-in-Picture"
    >
      <PictureInPicture2 className="h-4 w-4" />
    </button>
  );
};

export default PipButton;
