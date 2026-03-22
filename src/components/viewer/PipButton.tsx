import { useCallback, useState, useEffect } from "react";
import { PictureInPicture2 } from "lucide-react";

const PipButton = () => {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    setSupported('pictureInPictureEnabled' in document && (document as any).pictureInPictureEnabled);
    const onEnter = () => setActive(true);
    const onLeave = () => setActive(false);
    document.addEventListener("enterpictureinpicture", onEnter);
    document.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      document.removeEventListener("enterpictureinpicture", onEnter);
      document.removeEventListener("leavepictureinpicture", onLeave);
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
