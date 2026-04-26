import { useEffect, useRef, useState } from "react";

interface HeroVideoBackgroundProps {
  /** URL video. Mendukung .mp4 / .webm langsung, atau HLS (.m3u8) / DASH (.mpd). */
  url?: string;
  /** Optional poster image agar tidak blank saat video belum load. */
  poster?: string;
  /**
   * Kecerahan video (0-100). 100 = paling terang (tanpa overlay gelap),
   * 0 = paling gelap (overlay hitam penuh). Default 60.
   */
  brightness?: number;
  className?: string;
}

type StreamKind = "hls" | "dash" | "native";

const detectKind = (url: string): StreamKind => {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".m3u8") || clean.includes(".m3u8")) return "hls";
  if (clean.endsWith(".mpd") || clean.includes(".mpd")) return "dash";
  return "native";
};

/** Pilih level awal yang paling rendah agar background tidak buffering di awal. */
const pickStartLevel = (levels: Array<{ bitrate?: number; height?: number }>) => {
  if (!levels?.length) return -1;
  // Cari yang ≤ 480p (ringan, cocok untuk background), fallback ke level paling rendah.
  let candidate = -1;
  let bestBitrate = Infinity;
  levels.forEach((lv, i) => {
    const h = lv.height || 0;
    const br = lv.bitrate || 0;
    if (h && h <= 480 && br < bestBitrate) { candidate = i; bestBitrate = br; }
  });
  if (candidate >= 0) return candidate;
  // Fallback: level dengan bitrate paling rendah
  let lowest = 0; let lowestBr = Infinity;
  levels.forEach((lv, i) => {
    const br = lv.bitrate || 0;
    if (br < lowestBr) { lowestBr = br; lowest = i; }
  });
  return lowest;
};

/**
 * Background video dengan dukungan HLS/DASH adaptive bitrate.
 *
 * Strategi anti-buffer:
 *  - Mulai dari level kualitas paling ringan (≤ 480p) lalu biarkan ABR menaikkan bila bandwidth memadai
 *  - capLevelToPlayerSize: tidak load 1080p kalau elemen kecil
 *  - Buffer kecil (8-12 detik) — video background tidak butuh buffer panjang
 *  - Skip total kalau saveData / 2g — fallback ke gradient
 *  - Pause saat off-screen / tab background — hemat CPU & bandwidth
 *  - Defer attach src dengan requestIdleCallback agar tidak menghambat LCP
 *  - Native HLS Safari ditangani tanpa hls.js
 */
const HeroVideoBackground = ({ url, poster, brightness = 60, className = "" }: HeroVideoBackgroundProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsInstanceRef = useRef<any>(null);
  const dashInstanceRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Decide whether to load at all (respect data saver / slow 2g)
  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    try {
      const conn: any = (navigator as any).connection;
      if (conn?.saveData) return;
      if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return;
    } catch { /* ignore */ }

    const ric: any = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 200));
    const id = ric(() => { if (!cancelled) setReady(true); }, { timeout: 1500 });

    return () => {
      cancelled = true;
      try {
        const cic: any = (window as any).cancelIdleCallback;
        if (cic) cic(id); else clearTimeout(id);
      } catch { /* noop */ }
    };
  }, [url]);

  // Attach source (HLS / DASH / native) when ready
  useEffect(() => {
    if (!ready || !url) return;
    const video = videoRef.current;
    if (!video) return;

    const kind = detectKind(url);
    let disposed = false;

    const cleanup = () => {
      try {
        if (hlsInstanceRef.current) {
          hlsInstanceRef.current.destroy();
          hlsInstanceRef.current = null;
        }
      } catch { /* noop */ }
      try {
        if (dashInstanceRef.current) {
          dashInstanceRef.current.reset();
          dashInstanceRef.current = null;
        }
      } catch { /* noop */ }
    };

    const startNative = () => {
      video.src = url;
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };

    if (kind === "native") {
      startNative();
      return cleanup;
    }

    if (kind === "hls") {
      // Safari/iOS punya HLS native — pakai langsung, lebih hemat
      const canNative = video.canPlayType("application/vnd.apple.mpegurl");
      if (canNative) {
        startNative();
        return cleanup;
      }
      // Lazy import hls.js — jangan blok bundle utama
      import("hls.js").then((mod) => {
        if (disposed) return;
        const Hls = mod.default;
        if (!Hls.isSupported()) { startNative(); return; }

        const hls = new Hls({
          // Konfigurasi hemat bandwidth untuk background video
          enableWorker: true,
          lowLatencyMode: false,
          capLevelToPlayerSize: true,    // jangan load 1080p untuk elemen kecil
          startLevel: -1,                // sementara, akan di-set saat manifest parsed
          maxBufferLength: 10,           // detik — kecil, video background tidak butuh banyak buffer
          maxMaxBufferLength: 20,
          maxBufferSize: 30 * 1024 * 1024, // 30MB cap
          backBufferLength: 5,
          // Toleransi gap kecil agar tidak gampang stuck
          nudgeMaxRetry: 5,
        });

        hlsInstanceRef.current = hls;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          hls.loadSource(url);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, (_: any, data: any) => {
          // Mulai dari level yang ringan agar tidak buffering di awal
          const start = pickStartLevel(data?.levels || []);
          if (start >= 0) hls.startLevel = start;
          const p = video.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_: any, data: any) => {
          if (!data?.fatal) return;
          // Coba recover sekali, kalau gagal sembunyikan
          try {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else { hls.destroy(); setHidden(true); }
          } catch { setHidden(true); }
        });
      }).catch(() => setHidden(true));

      return () => { disposed = true; cleanup(); };
    }

    if (kind === "dash") {
      // Lazy import dashjs — hanya bila benar-benar dipakai (paket opsional, tidak di-bundle)
      const dashModuleName = "dashjs";
      import(/* @vite-ignore */ dashModuleName).then((mod: any) => {
        if (disposed) return;
        const dashjs = mod.default || mod;
        try {
          const player = dashjs.MediaPlayer().create();
          dashInstanceRef.current = player;
          player.updateSettings({
            streaming: {
              abr: {
                initialBitrate: { audio: -1, video: 400 }, // mulai 400kbps, ringan
                limitBitrateByPortal: true,
                usePixelRatioInLimitBitrateByPortal: false,
              },
              buffer: {
                bufferTimeAtTopQuality: 12,
                bufferTimeAtTopQualityLongForm: 12,
                bufferToKeep: 8,
              },
            },
          });
          player.initialize(video, url, true);
          player.setMute(true);
        } catch {
          setHidden(true);
        }
      }).catch(() => {
        // dashjs tidak terpasang — sembunyikan agar tidak crash
        setHidden(true);
      });
      return () => { disposed = true; cleanup(); };
    }

    return cleanup;
  }, [ready, url]);

  // Pause video when off-screen or tab hidden — saves CPU and prevents jank.
  useEffect(() => {
    const v = videoRef.current;
    const c = containerRef.current;
    if (!v || !c || !ready) return;

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
      (entries) => { inView = entries[0]?.isIntersecting ?? false; tryPlay(); },
      { threshold: 0.01 }
    );
    io.observe(c);

    const onVis = () => { pageVisible = !document.hidden; tryPlay(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ready]);

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
        disablePictureInPicture
        controls={false}
        poster={poster}
        onError={() => setHidden(true)}
      />
      {/* Gelapkan video agar teks tetap kontras */}
      <div className="absolute inset-0 bg-black/40" />
    </div>
  );
};

export default HeroVideoBackground;
