import { useCallback, useState, useEffect, useRef } from "react";
import { PictureInPicture2 } from "lucide-react";

const PipButton = () => {
  const [hasVideo, setHasVideo] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [isYouTube, setIsYouTube] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Detect PiP support across browsers (standard + iOS Safari webkit)
  const detectPipSupport = (video: HTMLVideoElement | null): boolean => {
    // Standard API (Chrome, Edge, Firefox, Android)
    const standardSupport =
      typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document &&
      !!(document as any).pictureInPictureEnabled;

    // iOS Safari uses webkitSupportsPresentationMode
    const webkitSupport =
      !!video &&
      typeof (video as any).webkitSupportsPresentationMode === "function" &&
      (video as any).webkitSupportsPresentationMode("picture-in-picture");

    return standardSupport || webkitSupport;
  };

  useEffect(() => {
    const onEnter = () => setActive(true);
    const onLeave = () => setActive(false);
    const onWebkitChange = (e: any) => {
      const mode = e?.target?.webkitPresentationMode;
      setActive(mode === "picture-in-picture");
    };

    const attachVideoListeners = (video: HTMLVideoElement | null) => {
      if (videoRef.current) {
        videoRef.current.removeEventListener("enterpictureinpicture", onEnter);
        videoRef.current.removeEventListener("leavepictureinpicture", onLeave);
        videoRef.current.removeEventListener(
          "webkitpresentationmodechanged" as any,
          onWebkitChange,
        );
      }
      videoRef.current = video;
      if (video) {
        video.addEventListener("enterpictureinpicture", onEnter);
        video.addEventListener("leavepictureinpicture", onLeave);
        video.addEventListener(
          "webkitpresentationmodechanged" as any,
          onWebkitChange,
        );
        // Important on iOS so PiP can be triggered
        try {
          (video as any).disablePictureInPicture = false;
        } catch {}
      }
    };

    const checkVideo = () => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
      const ytIframe = document.querySelector('iframe[src*="youtube"]');
      setIsYouTube(!video && !!ytIframe);
      setHasVideo(!!video);
      setPipSupported(detectPipSupport(video));
      if (video !== videoRef.current) {
        attachVideoListeners(video);
      }
    };

    checkVideo();
    const interval = setInterval(checkVideo, 1500);

    setActive(
      !!(document as any).pictureInPictureElement ||
        (videoRef.current as any)?.webkitPresentationMode ===
          "picture-in-picture",
    );

    return () => {
      clearInterval(interval);
      if (videoRef.current) {
        videoRef.current.removeEventListener("enterpictureinpicture", onEnter);
        videoRef.current.removeEventListener("leavepictureinpicture", onLeave);
        videoRef.current.removeEventListener(
          "webkitpresentationmodechanged" as any,
          onWebkitChange,
        );
      }
    };
  }, []);

  const togglePip = useCallback(async () => {
    const video = document.querySelector("video") as HTMLVideoElement | null;
    if (!video) {
      console.warn("PiP: no video element found");
      return;
    }

    try {
      // Ensure PiP isn't disabled by an attribute
      try {
        (video as any).disablePictureInPicture = false;
        video.removeAttribute("disablepictureinpicture");
      } catch {}

      // iOS Safari path
      const webkitMode = (video as any).webkitPresentationMode;
      if (typeof webkitMode === "string") {
        if (webkitMode === "picture-in-picture") {
          (video as any).webkitSetPresentationMode("inline");
          setActive(false);
        } else {
          // Must be called synchronously from user gesture; play if needed
          if (video.paused) {
            try {
              await video.play();
            } catch {}
          }
          (video as any).webkitSetPresentationMode("picture-in-picture");
          setActive(true);
        }
        return;
      }

      // Standard PiP path
      if ((document as any).pictureInPictureElement) {
        await (document as any).exitPictureInPicture();
        setActive(false);
        return;
      }

      // Make sure video has data; if not, try to play first (within gesture)
      if (video.readyState < 2) {
        try {
          await video.play();
        } catch {}
      }

      await (video as any).requestPictureInPicture();
      setActive(true);
    } catch (err) {
      console.warn("PiP toggle failed:", err);
    }
  }, []);

  // Hide on YouTube embeds (PiP unsupported reliably)
  if (isYouTube) return null;
  // Hide if no PiP support at all on this browser
  if (!pipSupported && !hasVideo) return null;

  const disabled = !hasVideo || !pipSupported;

  return (
    <button
      type="button"
      onClick={togglePip}
      disabled={disabled}
      aria-pressed={active}
      title={
        !pipSupported
          ? "Picture-in-Picture tidak didukung di browser ini"
          : disabled
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
