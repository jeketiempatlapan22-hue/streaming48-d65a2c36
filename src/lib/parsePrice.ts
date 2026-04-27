/**
 * Parse harga Rupiah ke integer rupiah.
 * Mendukung format:
 *  - "Rp 50.000"        -> 50000  (titik = pemisah ribuan ID)
 *  - "Rp 50,000"        -> 50000  (koma ribuan, gaya EN)
 *  - "50000"            -> 50000
 *  - "50000.5" / "50000,5" -> 50001 (dibulatkan)
 *  - "Rp 1.234.567,89"  -> 1234568
 *  - 50000 (number)     -> 50000
 *  - null/undefined/""  -> 0
 *
 * Aturan desimal: dianggap desimal HANYA jika pemisah terakhir
 * diikuti tepat 1-2 digit di akhir string. Selain itu seluruh
 * pemisah dianggap pemisah ribuan.
 */
export function parsePriceToNumber(input: unknown): number {
  if (input == null) return 0;
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input) : 0;
  if (typeof input !== "string") return 0;

  // Ambil hanya digit, titik, dan koma
  const cleaned = input.replace(/[^\d.,]/g, "").trim();
  if (!cleaned) return 0;

  // Jika tidak ada pemisah, parse langsung
  if (!/[.,]/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : 0;
  }

  // Deteksi desimal: pemisah terakhir diikuti 1-2 digit DAN tidak ada
  // pemisah lain setelahnya. Untuk format ID umum "50.000" jangan
  // dianggap desimal — gunakan aturan: desimal hanya kalau ada >=4 digit
  // sebelum pemisah terakhir, atau ada pemisah berbeda sebelumnya.
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const lastSepIdx = Math.max(lastDot, lastComma);
  const lastSep = cleaned[lastSepIdx];
  const tail = cleaned.slice(lastSepIdx + 1);
  const head = cleaned.slice(0, lastSepIdx);
  const otherSep = lastSep === "." ? "," : ".";
  const hasOther = head.includes(otherSep);
  const headDigits = head.replace(/[.,]/g, "");

  const isDecimal =
    /^\d{1,2}$/.test(tail) &&
    (hasOther || headDigits.length >= 4 || tail.length === 1);

  if (isDecimal) {
    const intPart = headDigits.replace(/\D/g, "");
    const fracPart = tail;
    const num = parseFloat(`${intPart || "0"}.${fracPart}`);
    return Number.isFinite(num) ? Math.round(num) : 0;
  }

  // Semua pemisah = pemisah ribuan
  const digitsOnly = cleaned.replace(/[.,]/g, "");
  const n = parseInt(digitsOnly, 10);
  return Number.isFinite(n) ? n : 0;
}
