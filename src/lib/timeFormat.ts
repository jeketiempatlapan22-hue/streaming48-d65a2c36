/**
 * Time formatting utility — semua waktu basis WIB (Asia/Jakarta).
 * User di zona WITA/WIT/lainnya akan otomatis melihat waktu WIB +
 * offset jam lokal mereka jika berbeda dari WIB.
 *
 * Contoh: jadwal show "19:00 WIB"
 * - User WIB → "19:00 WIB"
 * - User WITA → "19:00 WIB (20:00 waktu Anda)"
 * - User WIT → "19:00 WIB (21:00 waktu Anda)"
 */

const WIB_TZ = "Asia/Jakarta";
const WIB_OFFSET_MIN = 7 * 60; // UTC+7

/** Get user's local UTC offset in minutes (positive = ahead of UTC). */
function getUserOffsetMin(): number {
  // getTimezoneOffset returns minutes WEST of UTC, so invert.
  return -new Date().getTimezoneOffset();
}

/** True when user's local zone differs from WIB. */
export function isUserOutsideWIB(): boolean {
  return getUserOffsetMin() !== WIB_OFFSET_MIN;
}

/** Format a date in WIB. */
export function formatWIB(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
): string {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("id-ID", { ...options, timeZone: WIB_TZ });
}

/** Format a date in user's local zone. */
export function formatLocal(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
): string {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("id-ID", options);
}

/**
 * Display WIB time with optional local-zone hint when user is outside WIB.
 * Example: "18 Apr 2026 19:00 WIB" or "18 Apr 2026 19:00 WIB (20:00 waktu Anda)"
 */
export function formatWIBWithLocal(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
): string {
  const wib = formatWIB(input, options);
  if (!wib) return "";
  if (!isUserOutsideWIB()) return `${wib} WIB`;
  const localTime = formatLocal(input, { hour: "2-digit", minute: "2-digit" });
  return `${wib} WIB (${localTime} waktu Anda)`;
}

/** Time only (HH:mm) in WIB. */
export function formatTimeWIB(input: string | number | Date): string {
  return formatWIB(input, { hour: "2-digit", minute: "2-digit" });
}

/** Time only with local hint when zone differs. */
export function formatTimeWIBWithLocal(input: string | number | Date): string {
  const wib = formatTimeWIB(input);
  if (!wib) return "";
  if (!isUserOutsideWIB()) return `${wib} WIB`;
  const localTime = formatLocal(input, { hour: "2-digit", minute: "2-digit" });
  return `${wib} WIB (${localTime} lokal)`;
}

/** Date only in WIB. */
export function formatDateWIB(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }
): string {
  return formatWIB(input, options);
}

/**
 * Parse a WIB date+time string into a UTC timestamp (ms).
 * Accepts dateStr like "1 maret 2024", "2024-03-01", or "1 mar 2024",
 * and timeStr like "19:00", "19.00", or "19:00 WIB".
 * The parsed date/time is treated as WIB (UTC+7), so the returned
 * timestamp is correct regardless of the viewer's local zone.
 */
const ID_MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function parseWIBDateTime(dateStr: string, timeStr: string): number | null {
  if (!dateStr) return null;

  // ----- Time -----
  // Accept "19:00", "19.00", "19:00 WIB", "7 PM", "7pm", "19", "" (=> 00:00).
  let cleanTime = (timeStr || "00:00")
    .replace(/\s*WIB\s*/i, "")
    .replace(/\s*WITA\s*/i, "")
    .replace(/\s*WIT\s*/i, "")
    .trim();
  let isPm = false;
  let isAm = false;
  if (/pm$/i.test(cleanTime)) { isPm = true; cleanTime = cleanTime.replace(/pm$/i, "").trim(); }
  if (/am$/i.test(cleanTime)) { isAm = true; cleanTime = cleanTime.replace(/am$/i, "").trim(); }
  cleanTime = cleanTime.replace(/\./g, ":");
  const tParts = cleanTime.split(":");
  let hour = parseInt(tParts[0]);
  let minute = parseInt(tParts[1]);
  if (isNaN(hour)) hour = 0;
  if (isNaN(minute)) minute = 0;
  if (isPm && hour < 12) hour += 12;
  if (isAm && hour === 12) hour = 0;

  // ----- Date -----
  // Strip leading day-of-week ("Jumat,", "minggu", "sabtu, ", etc.) and normalize whitespace.
  const cleanDate = String(dateStr)
    .replace(/^\s*(senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|mon|tue|wed|thu|fri|sat|sun)\.?\s*,?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;

  // ISO YYYY-MM-DD
  const iso = cleanDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  // DD/MM/YYYY or DD-MM-YYYY (slash/dash separated, day first)
  const dmySlash = cleanDate.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (iso) {
    year = parseInt(iso[1]);
    month = parseInt(iso[2]);
    day = parseInt(iso[3]);
  } else if (dmySlash) {
    day = parseInt(dmySlash[1]);
    month = parseInt(dmySlash[2]);
    year = parseInt(dmySlash[3]);
    if (year < 100) year += 2000;
  } else {
    // Indonesian/English textual: "1 maret 2024", "07 Mei 2026", "1 Mar 2026"
    const parts = cleanDate.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length >= 3) {
      day = parseInt(parts[0]);
      month = ID_MONTHS[parts[1]] ?? null;
      year = parseInt(parts[2]);
    }
  }

  if (!year || !month || !day) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  // Build UTC ms for the WIB wall-clock time: subtract 7h offset.
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - WIB_OFFSET_MIN * 60 * 1000;
  if (isNaN(utcMs)) return null;
  return utcMs;
}

/** Short label of user's zone, e.g. "WIB", "WITA", "WIT", or generic offset. */
export function getUserZoneLabel(): string {
  const offset = getUserOffsetMin();
  if (offset === 7 * 60) return "WIB";
  if (offset === 8 * 60) return "WITA";
  if (offset === 9 * 60) return "WIT";
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/**
 * Given a WIB date+time string (e.g. dateStr "1 maret 2024", timeStr "19:00"),
 * return formatted times for WIB, WITA, and WIT zones.
 * Useful for show schedule cards so viewers in any Indonesian zone know the start time.
 */
export function formatScheduleAllZones(
  dateStr: string,
  timeStr: string
): { wib: string; wita: string; wit: string } | null {
  const ts = parseWIBDateTime(dateStr, timeStr);
  if (ts == null) return null;
  const fmt = (tz: string) =>
    new Date(ts).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
      hour12: false,
    });
  return {
    wib: fmt("Asia/Jakarta"),
    wita: fmt("Asia/Makassar"),
    wit: fmt("Asia/Jayapura"),
  };
}
