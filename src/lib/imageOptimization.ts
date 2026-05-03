/**
 * Image optimization helpers.
 *
 * For Supabase Storage public object URLs, rewrite to the on-the-fly
 * image transform endpoint (`/storage/v1/render/image/public/...`) with
 * width + quality + WebP format. Non-Supabase URLs (Cloudinary, external
 * CDNs, blob:, data:) are returned unchanged.
 *
 * Also exports buildSrcSet() for responsive `srcset`/`sizes` rendering.
 */

const SUPABASE_OBJECT_RE = /\/storage\/v1\/object\/public\//;

export type ImageFormat = "webp" | "origin";

export function optimizedImage(
  url: string | null | undefined,
  opts: { width?: number; quality?: number; format?: ImageFormat } = {},
): string {
  if (!url) return "";
  // Skip data:, blob:, and known animated/SVG/poster-mp4 sources
  if (/^(data:|blob:)/i.test(url)) return url;
  if (/\.(svg|gif)(\?|$)/i.test(url)) return url;

  const { width, quality = 70, format = "webp" } = opts;

  // Supabase Storage → use render/image transform
  if (SUPABASE_OBJECT_RE.test(url)) {
    const rewritten = url.replace(SUPABASE_OBJECT_RE, "/storage/v1/render/image/public/");
    const params = new URLSearchParams();
    if (width) params.set("width", String(width));
    params.set("quality", String(quality));
    if (format === "webp") params.set("format", "webp");
    return `${rewritten}?${params.toString()}`;
  }

  // Cloudinary URLs: inject f_auto,q_auto,w_<width> after /upload/
  if (/res\.cloudinary\.com\//.test(url) && /\/upload\//.test(url)) {
    const tx = ["f_auto", `q_auto:${quality >= 80 ? "good" : "eco"}`];
    if (width) tx.push(`w_${width}`);
    return url.replace(/\/upload\/(?!.*\/upload\/)/, `/upload/${tx.join(",")}/`);
  }

  return url;
}

/**
 * Build a `srcset` string at multiple widths (default: 320, 640, 960, 1280).
 * Returns "" for non-transformable URLs (caller should fall back to bare src).
 */
export function buildSrcSet(
  url: string | null | undefined,
  widths: number[] = [320, 640, 960, 1280],
  quality = 70,
): string {
  if (!url) return "";
  const supabase = SUPABASE_OBJECT_RE.test(url);
  const cloudinary = /res\.cloudinary\.com\/.*\/upload\//.test(url);
  if (!supabase && !cloudinary) return "";
  return widths
    .map((w) => `${optimizedImage(url, { width: w, quality, format: "webp" })} ${w}w`)
    .join(", ");
}

/**
 * Common sizes presets for typical layouts.
 */
export const SIZES = {
  showCard: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  hero: "100vw",
  thumb: "(max-width: 640px) 50vw, 200px",
  fullWidth: "100vw",
} as const;
