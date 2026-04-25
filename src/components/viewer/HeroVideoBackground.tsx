import { useEffect, useRef, useState } from "react";

interface HeroVideoBackgroundProps {
  /** URL video langsung (mp4/webm). Kosong = tidak render apa-apa. */
  url?: string;
  /** Optional poster image agar tidak blank saat video belum load. */
  poster?: string;
  /** className untuk wrapper */
  className?: string;
}

/**
 * Background video ringan untuk hero section.
 *
 * Optimasi:
 *  - preload="metadata" agar tidak menyedot bandwidth
 *  - muted + playsInline agar autoplay diizinkan browser mobile
 *  - loop tanpa kontrol
 *  - IntersectionObserver: pause otomatis saat tidak terlihat (hemat CPU/baterai)
 *  - PageVisibility: pause saat tab background
 *  - Tidak render di koneksi sangat lambat (saveData / 2g) — fallback gradient
 *  - decoding="async" + lazy via 'requestIdleCallback' untuk attach src
 *  - Error handler: kalau gagal load, sembunyikan secara senyap (UI tetap pakai gradient)
 */
const HeroVideoBackground = ({ url, poster, className = "" }: HeroVideoBackgroundProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string>("");
  const [hidden, setHidden] = useState(false);

  // Decide whether to load at all (respect data saver / slow 2g)
  useEffect(() => {
    if (!url) return;
    try {
      const conn: any = (navigator as any).connection;
      if (conn?.saveData) return;
      if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return;
    } catch {
      /* ignore */
    }

    // Defer attaching src so it doesn't block initial paint of hero text.
    const ric: any = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 200));
    const id = ric(() => setSrc(url), { timeout: 1500 });
    return () => {
      try {
        const cic: any = (window as any).cancelIdleCallback;
        if (cic) cic(id);
        else clearTimeout(id);
      } catch { /* noop */ }
    };
  }, [url]);

  // Pause video when off-screen or tab hidden — saves CPU and prevents jank.
  useEffect(() => {
    const v = videoRef.current;
    const c = containerRef.current;
    if (!v || !c) return;

    let inView = true;
    let pageVisible = !document.hidden;

    const tryPlay = () => {
      if (inView && pageVisible) {
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } else {
        v.pause();
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        inView = entries[0]?.isIntersecting ?? false;
        tryPlay();
      },
      { threshold: 0.01 }
    );
    io.observe(c);

    const onVis = () => {
      pageVisible = !document.hidden;
      tryPlay();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [src]);

  if (!url || hidden) return null;

  return (
    <div ref={containerRef} className={`absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <video
        ref={videoRef}
        className="h-full w-full object-cover opacity-60"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        // @ts-expect-error - non-standard but harmless on iOS
        disablePictureInPicture
        controls={false}
        poster={poster}
        src={src || undefined}
        onError={() => setHidden(true)}
      />
      {/* Gelapkan video agar teks tetap kontras */}
      <div className="absolute inset-0 bg-black/40" />
    </div>
  );
};

export default HeroVideoBackground;
