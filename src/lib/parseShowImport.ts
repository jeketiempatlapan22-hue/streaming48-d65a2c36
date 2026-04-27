export type ParsedTeam = "passion" | "dream" | "love" | "";

export interface ParsedShow {
  title: string;
  schedule_date: string;
  schedule_time: string;
  lineup: string;
  team: ParsedTeam;
  warnings: string[];
}

const TITLE_RE = /^🎪\s*(.+)$/u;
const DATE_RE = /^🗓\uFE0F?\s*(.+)$/u;
// Clock emojis cover U+1F550–U+1F567 (full + half hours)
const TIME_RE = /^(?:[\u{1F550}-\u{1F567}])\uFE0F?\s*(.+)$/u;
const LINEUP_RE = /^👥\s*(.*)$/u;

const stripBold = (line: string) =>
  line
    .replace(/\*+/g, "")
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
    .trim();

const detectTeam = (raw: string): { title: string; team: ParsedTeam } => {
  // Match " - Team Love" / "– Team Dream" / "— Tim Passion" at the end
  const m = raw.match(
    /\s*[-–—]\s*(?:team|tim)\s+(love|dream|passion)\s*$/i,
  );
  if (!m) return { title: raw.trim(), team: "" };
  const team = m[1].toLowerCase() as ParsedTeam;
  const title = raw.slice(0, m.index).trim();
  return { title, team };
};

const emptyDraft = (): ParsedShow => ({
  title: "",
  schedule_date: "",
  schedule_time: "",
  lineup: "",
  team: "",
  warnings: [],
});

const finalizeDraft = (d: ParsedShow): ParsedShow | null => {
  if (!d.title) return null;
  const warnings: string[] = [];
  if (!d.schedule_date) warnings.push("Tanggal kosong");
  if (!d.schedule_time) warnings.push("Jam kosong");
  return { ...d, warnings };
};

/**
 * Parse blok pesan WhatsApp berisi banyak show.
 * Pemisah: baris kosong, atau munculnya 🎪 berikutnya.
 */
export function parseShowImport(text: string): ParsedShow[] {
  if (!text || !text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const result: ParsedShow[] = [];
  let current: ParsedShow | null = null;

  const flush = () => {
    if (!current) return;
    const f = finalizeDraft(current);
    if (f) result.push(f);
    current = null;
  };

  for (const rawLine of lines) {
    const line = stripBold(rawLine);
    if (!line) {
      flush();
      continue;
    }

    const titleMatch = line.match(TITLE_RE);
    if (titleMatch) {
      // Mulai show baru
      flush();
      current = emptyDraft();
      const { title, team } = detectTeam(titleMatch[1]);
      current.title = title;
      current.team = team;
      continue;
    }

    if (!current) {
      // Baris di luar konteks show — abaikan
      continue;
    }

    const dateMatch = line.match(DATE_RE);
    if (dateMatch) {
      current.schedule_date = dateMatch[1].trim();
      continue;
    }

    const timeMatch = line.match(TIME_RE);
    if (timeMatch) {
      current.schedule_time = timeMatch[1].trim();
      continue;
    }

    const lineupMatch = line.match(LINEUP_RE);
    if (lineupMatch) {
      const v = lineupMatch[1].trim();
      current.lineup = v === "-" || v === "" ? "" : v;
      continue;
    }
  }

  flush();
  return result;
}
