// Helpers untuk nama file media library yang bisa diberi label.
//
// Konvensi nama: `<timestamp>_<slug>.<ext>`
// - `timestamp` (digit) menjamin keunikan + urutan.
// - `slug` adalah nama yang admin berikan (lowercase, dash). Boleh kosong → "untitled".
// - Saat ditampilkan, kita tampilkan slug (de-slugified) sebagai label.
//
// Backward-compatible: file lama tanpa underscore atau tanpa slug masih ditampilkan apa adanya.

export const slugifyName = (raw: string): string => {
  const cleaned = (raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "untitled";
};

export const buildMediaFileName = (label: string, ext: string): string => {
  const safeExt = (ext || "png").replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
  return `${Date.now()}_${slugifyName(label)}.${safeExt}`;
};

/** Ambil bagian slug dari nama file storage. */
export const extractSlug = (fileName: string): string => {
  const noExt = fileName.replace(/\.[^.]+$/, "");
  const m = noExt.match(/^\d{10,}_(.+)$/);
  return (m ? m[1] : noExt).trim();
};

/** Label manusia: ubah slug → "Team Love Pajama Drive". */
export const fileNameToLabel = (fileName: string): string => {
  const slug = extractSlug(fileName);
  if (!slug || /^[a-z0-9]{4,8}$/.test(slug)) {
    // slug random lama (mis. "a1b2c3") → kosong agar UI tampilkan placeholder
    return "";
  }
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
};

/** Ekstrak extension dari nama file. */
export const getExt = (fileName: string): string => {
  const m = fileName.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : "png";
};

/** Ganti slug pada nama file storage, pertahankan timestamp & extension. */
export const renameFile = (fileName: string, newLabel: string): string => {
  const ext = getExt(fileName);
  const noExt = fileName.replace(/\.[^.]+$/, "");
  const m = noExt.match(/^(\d{10,})_/);
  const ts = m ? m[1] : Date.now().toString();
  return `${ts}_${slugifyName(newLabel)}.${ext}`;
};

// ---- Fuzzy matching untuk auto-detect background show ----

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);

/**
 * Hitung skor kemiripan 0..1 antara query (judul show) dan label file.
 * - +1 untuk tiap token query yang muncul utuh sebagai token label
 * - +0.5 untuk substring match
 * - dinormalisasi terhadap jumlah token query
 */
export const matchScore = (query: string, candidate: string): number => {
  const q = tokenize(query);
  if (q.length === 0) return 0;
  const cText = candidate.toLowerCase();
  const cTokens = new Set(tokenize(candidate));
  let score = 0;
  for (const t of q) {
    if (cTokens.has(t)) score += 1;
    else if (cText.includes(t)) score += 0.5;
  }
  return score / q.length;
};

export interface MediaCandidate {
  name: string;
  url: string;
  label: string;
}

/**
 * Cari file media yang paling cocok dengan judul/keyword.
 * Mengembalikan kandidat terbaik di atas threshold, atau null.
 */
export const findBestMediaMatch = (
  query: string,
  files: MediaCandidate[],
  threshold = 0.5,
): { file: MediaCandidate; score: number } | null => {
  if (!query.trim() || files.length === 0) return null;
  let best: { file: MediaCandidate; score: number } | null = null;
  for (const f of files) {
    const haystack = `${f.label} ${f.name}`;
    const score = matchScore(query, haystack);
    if (!best || score > best.score) best = { file: f, score };
  }
  return best && best.score >= threshold ? best : null;
};
