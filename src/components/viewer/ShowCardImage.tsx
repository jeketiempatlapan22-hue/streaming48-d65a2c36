import { useState } from "react";
import { Play, Ticket } from "lucide-react";

interface ShowCardImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackIcon?: "ticket" | "play";
  fallbackClassName?: string;
}

/**
 * Render show/replay card image dengan auto-fallback bila URL invalid (404, dihapus, dst).
 * Pastikan kartu tidak pernah hitam-kosong saat foto admin tidak bisa dimuat.
 */
export default function ShowCardImage({
  src,
  alt,
  className,
  fallbackIcon = "ticket",
  fallbackClassName,
}: ShowCardImageProps) {
  const [errored, setErrored] = useState(false);
  const Icon = fallbackIcon === "play" ? Play : Ticket;

  if (!src || errored) {
    return (
      <div
        className={
          fallbackClassName ||
          "flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 to-accent/10"
        }
      >
        <Icon className="h-16 w-16 text-primary/30" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setErrored(true)}
      className={className}
    />
  );
}
