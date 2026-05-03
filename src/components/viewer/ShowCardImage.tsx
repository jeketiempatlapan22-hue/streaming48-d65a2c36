import { useState } from "react";
import { Play, Ticket } from "lucide-react";
import { optimizedImage, buildSrcSet, SIZES } from "@/lib/imageOptimization";

interface ShowCardImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackIcon?: "ticket" | "play";
  fallbackClassName?: string;
  /** Target rendered width (px) for default 1x src. Default 640. */
  width?: number;
  /** Sizes attribute. Default = card layout. */
  sizes?: string;
}

/**
 * Render show/replay card image dengan auto-fallback bila URL invalid (404, dihapus, dst).
 * Pastikan kartu tidak pernah hitam-kosong saat foto admin tidak bisa dimuat.
 *
 * Otomatis menggunakan Supabase image transform (WebP + width) bila URL berasal
 * dari Supabase Storage public bucket, lengkap dengan responsive `srcset`.
 */
export default function ShowCardImage({
  src,
  alt,
  className,
  fallbackIcon = "ticket",
  fallbackClassName,
  width = 640,
  sizes = SIZES.showCard,
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

  const optimizedSrc = optimizedImage(src, { width, quality: 70 });
  const srcSet = buildSrcSet(src, [320, 480, 640, 960]);

  return (
    <img
      src={optimizedSrc}
      srcSet={srcSet || undefined}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setErrored(true)}
      className={className}
    />
  );
}
