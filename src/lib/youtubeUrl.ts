// Centralized YouTube ID parsing & validation.
// Accepts: bare 11-char IDs, youtu.be/<id>, youtube.com/watch?v=<id>,
// youtube.com/embed/<id>, youtube.com/shorts/<id>, youtube.com/live/<id>,
// and youtube-nocookie.com variants. Strips extra params/whitespace.

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const parseYoutubeId = (raw: string): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Bare 11-char ID
  if (YT_ID_RE.test(trimmed)) return trimmed;

  // Try as URL
  let url: URL | null = null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withProto);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const isYt =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYt) return null;

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] || "";
    return YT_ID_RE.test(id) ? id : null;
  }

  // /watch?v=<id>
  const v = url.searchParams.get("v");
  if (v && YT_ID_RE.test(v)) return v;

  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const [seg, id] = parts;
    if (["embed", "shorts", "live", "v"].includes(seg) && YT_ID_RE.test(id)) {
      return id;
    }
  }

  return null;
};

export const isValidYoutubeInput = (raw: string): boolean =>
  parseYoutubeId(raw) !== null;
