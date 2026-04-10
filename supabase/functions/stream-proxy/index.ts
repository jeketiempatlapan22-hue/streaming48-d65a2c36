import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIGNING_SECRET = SERVICE_ROLE_KEY;

// --- BALANCED TTLs ---
// Short enough to prevent link theft, long enough for smooth streaming
// Client auto-refreshes well before expiry
const PLAYLIST_TOKEN_TTL = 1800;    // 30 min — manifest URL, auto-refreshed every ~12 min
const SUB_PLAYLIST_TOKEN_TTL = 1800; // 30 min — sub-playlists inherit same lifecycle
const YT_TOKEN_TTL = 3600;           // 1 hour — YouTube/CF embeds, less sensitive
const SEG_TOKEN_TTL = 1800;          // 30 min — segments (must survive pause/resume + buffer)

// --- ALLOWED ORIGINS (Referer/Origin validation) ---
const ALLOWED_REFERERS = [
  "lovable.app",
  "lovable.dev",
  "lovableproject.com",
  "localhost",
  "streaming48.lovable.app",
  "id-preview--4387c5bf",
  "4387c5bf-8d85-41f4-b11e-91993da6d859",
  "realtime48",
];

function isAllowedReferer(req: Request): boolean {
  const referer = req.headers.get("referer") || "";
  const origin = req.headers.get("origin") || "";
  const source = referer || origin;
  // Allow if no referer (direct HLS player requests from video element)
  if (!source) return true;
  return ALLOWED_REFERERS.some((r) => source.includes(r));
}

// --- RATE LIMITER (stricter) ---
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function edgeRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  // Cleanup when map grows
  if (rateLimitMap.size > 3000) {
    for (const [k, v] of rateLimitMap) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
    if (rateLimitMap.size > 5000) {
      const entries = [...rateLimitMap.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
      for (let i = 0; i < entries.length - 1000; i++) {
        rateLimitMap.delete(entries[i][0]);
      }
    }
  }
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

// --- ABUSE TRACKER: detect IPs with repeated 403s ---
const abuseTracker = new Map<string, { count: number; resetAt: number }>();

function trackAbuse(ip: string): boolean {
  const now = Date.now();
  const entry = abuseTracker.get(ip);
  if (!entry || now > entry.resetAt) {
    abuseTracker.set(ip, { count: 1, resetAt: now + 600000 }); // 10 min window
    return false;
  }
  entry.count++;
  // Block after 30 failed attempts in 10 minutes (generous for shared networks)
  return entry.count > 30;
}

function isAbusiveIp(ip: string): boolean {
  const entry = abuseTracker.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) { abuseTracker.delete(ip); return false; }
  return entry.count > 30;
}

function getRateLimitResponse(isStreamRequest = false): Response {
  if (isStreamRequest) {
    return new Response(
      "#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:0\n",
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache", "Retry-After": "5" } }
    );
  }
  return new Response(
    JSON.stringify({ error: "Terlalu banyak request. Coba lagi nanti." }),
    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "30" } }
  );
}

// --- CACHES ---
const M3U8_CACHE_TTL_MS = 2000; // 2s (tighter)
const PLAYLIST_URL_CACHE_TTL_MS = 60000;
const PROXY_TOKEN_CACHE_TTL_MS = 300000; // 5 min cache for hanabira48 tokens

interface CacheEntry { content: string; cachedAt: number }
type FetchM3u8Result = { content: string | null; inactive?: boolean; status?: number; errorBody?: string };
const m3u8Cache = new Map<string, CacheEntry>();
const playlistUrlCache = new Map<string, { url: string; type: string; cachedAt: number }>();
const proxyTokenCache = new Map<string, { headers: Record<string, string>; cachedAt: number }>();

function getCachedM3u8(key: string): string | null {
  const entry = m3u8Cache.get(key);
  if (!entry || Date.now() - entry.cachedAt > M3U8_CACHE_TTL_MS) {
    if (entry) m3u8Cache.delete(key);
    return null;
  }
  return entry.content;
}

function setCachedM3u8(key: string, content: string): void {
  m3u8Cache.set(key, { content, cachedAt: Date.now() });
  if (m3u8Cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of m3u8Cache) {
      if (now - v.cachedAt > M3U8_CACHE_TTL_MS) m3u8Cache.delete(k);
    }
  }
}

async function getPlaylistData(pid: string): Promise<{ url: string; type: string } | null> {
  const cached = playlistUrlCache.get(pid);
  if (cached && Date.now() - cached.cachedAt < PLAYLIST_URL_CACHE_TTL_MS) {
    return { url: cached.url, type: cached.type };
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data } = await supabase.from("playlists").select("url, type").eq("id", pid).single();
  if (!data) return null;
  playlistUrlCache.set(pid, { url: data.url, type: data.type, cachedAt: Date.now() });
  return { url: data.url, type: data.type };
}

// --- PROXY STREAM HELPERS ---
async function getProxyStreamHeaders(externalShowId: string): Promise<Record<string, string> | null> {
  const cached = proxyTokenCache.get(externalShowId);
  if (cached && Date.now() - cached.cachedAt < PROXY_TOKEN_CACHE_TTL_MS) {
    return cached.headers;
  }
  try {
    const res = await fetch(`https://hanabira48.com/api/stream-token?showId=${encodeURIComponent(externalShowId)}`);
    if (!res.ok) {
      console.error("[proxy] Failed to get stream token from hanabira48:", res.status);
      return null;
    }
    const json = await res.json();
    if (!json.success || !json.data) {
      console.error("[proxy] hanabira48 API returned unsuccessful:", json);
      return null;
    }
    const d = json.data;
    const headers: Record<string, string> = {
      "x-api-token": d.apiToken || "",
      "x-sec-key": d.secKey || "",
      "x-showid": d.showId || "",
      "x-token-id": d.tokenId || "",
    };
    proxyTokenCache.set(externalShowId, { headers, cachedAt: Date.now() });
    return headers;
  } catch (err) {
    console.error("[proxy] Error fetching hanabira48 token:", err);
    return null;
  }
}

async function fetchProxyManifest(proxyHeaders: Record<string, string>): Promise<{ content: string | null; offline?: boolean }> {
  try {
    const res = await fetch("https://proxy.mediastream48.workers.dev/api/proxy/playback", {
      headers: {
        ...proxyHeaders,
        "User-Agent": "Mozilla/5.0 (compatible; StreamProxy/1.0)",
      },
    });
    if (res.status === 404) {
      const body = await res.text();
      console.log("[proxy] Stream offline:", body);
      return { content: null, offline: true };
    }
    if (!res.ok) {
      console.error("[proxy] Failed to fetch manifest from mediastream48:", res.status);
      const body = await res.text();
      console.error("[proxy] Response body:", body);
      return { content: null };
    }
    return { content: await res.text() };
  } catch (err) {
    console.error("[proxy] Error fetching proxy manifest:", err);
    return { content: null };
  }
}

async function generateProxySegSignedUrl(rawUrl: string, functionUrl: string, ipHash: string, externalShowId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SEG_TOKEN_TTL;
  const encoded = base64UrlEncode(rawUrl);
  const eid = base64UrlEncode(externalShowId);
  const sig = await hmacSign(`proxyseg:${encoded}:${exp}:${ipHash}:${eid}`);
  return `${functionUrl}/stream-proxy?mode=proxyseg&u=${encoded}&exp=${exp}&sig=${sig}&h=${ipHash}&eid=${eid}`;
}

async function rewriteProxyM3u8(content: string, baseUrl: string, functionUrl: string, ipHash: string, externalShowId: string): Promise<string> {
  const lines = content.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { result.push(line); continue; }

    if (trimmed.startsWith("#")) {
      if (trimmed.includes('URI="')) {
        const match = trimmed.match(/URI="([^"]+)"/);
        if (match) {
          const absUrl = resolveUrl(match[1], baseUrl);
          const signed = await generateProxySegSignedUrl(absUrl, functionUrl, ipHash, externalShowId);
          result.push(trimmed.replace(`URI="${match[1]}"`, `URI="${signed}"`));
        } else { result.push(line); }
      } else { result.push(line); }
      continue;
    }

    const absoluteUrl = resolveUrl(trimmed, baseUrl);
    if (isM3u8Url(absoluteUrl)) {
      result.push(await generateProxySegSignedUrl(absoluteUrl, functionUrl, ipHash, externalShowId));
    } else {
      // Segments must also go through proxy (needs custom headers)
      result.push(await generateProxySegSignedUrl(absoluteUrl, functionUrl, ipHash, externalShowId));
    }
  }
  return result.join("\n");
}

async function generateProxyPlaylistSignedUrl(playlistId: string, functionUrl: string, ipHash: string, externalShowId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + PLAYLIST_TOKEN_TTL;
  const eid = base64UrlEncode(externalShowId);
  const sig = await hmacSign(`proxyplay:${playlistId}:${exp}:${ipHash}:${eid}`);
  return `${functionUrl}/stream-proxy?mode=proxyplay&pid=${playlistId}&exp=${exp}&sig=${sig}&h=${ipHash}&eid=${eid}`;
}

// --- CRYPTO HELPERS ---
async function hmacSign(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacVerify(message: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(message);
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

function base64UrlEncode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return decodeURIComponent(escape(atob(s)));
}

function resolveUrl(url: string, base: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  try { return new URL(url, base).href; } catch {
    return base.substring(0, base.lastIndexOf("/") + 1) + url;
  }
}

function getBaseUrl(url: string): string {
  return url.substring(0, url.lastIndexOf("/") + 1);
}

function isM3u8Url(url: string, contentType?: string): boolean {
  return url.endsWith(".m3u8") || url.includes(".m3u8?") ||
    (contentType || "").includes("mpegurl") || (contentType || "").includes("x-mpegURL");
}

// --- IP-BOUND SIGNED URLS ---
// Use subnet-level hash (/24 for IPv4, /48 for IPv6) so minor IP changes
// from CDN routing, mobile networks, or load balancers don't break playback
function normalizeIpToSubnet(ip: string): string {
  if (!ip || ip === "unknown") return "unknown";
  // Strip IPv6-mapped IPv4 prefix (::ffff:1.2.3.4 → 1.2.3.4)
  let cleaned = ip.replace(/^::ffff:/i, "");
  // IPv4: keep first 3 octets (e.g., 192.168.1.x → 192.168.1)
  const v4Match = cleaned.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (v4Match) return v4Match[1];
  // IPv6: keep first 3 groups
  if (cleaned.includes(":")) {
    const parts = cleaned.split(":");
    return parts.slice(0, 3).join(":");
  }
  return cleaned;
}

function hashIp(ip: string): string {
  const subnet = normalizeIpToSubnet(ip);
  let h = 0;
  for (let i = 0; i < subnet.length; i++) {
    h = ((h << 5) - h + subnet.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// Legacy full-IP hash for backward compatibility with existing signed URLs
function hashIpLegacy(ip: string): string {
  let h = 0;
  const cleaned = ip.replace(/^::ffff:/i, "");
  for (let i = 0; i < cleaned.length; i++) {
    h = ((h << 5) - h + cleaned.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// Check if IP hash matches (new subnet-based OR legacy full-IP)
function ipHashMatches(expectedHash: string, clientIp: string, currentHash: string): boolean {
  if (expectedHash === currentHash) return true;
  // Accept legacy full-IP hash for existing signed URLs
  return expectedHash === hashIpLegacy(clientIp);
}

async function generatePlaylistSignedUrl(playlistId: string, functionUrl: string, ipHash: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + PLAYLIST_TOKEN_TTL;
  const sig = await hmacSign(`playlist:${playlistId}:${exp}:${ipHash}`);
  return `${functionUrl}/stream-proxy?mode=play&pid=${playlistId}&exp=${exp}&sig=${sig}&h=${ipHash}`;
}

async function generateSubPlaylistSignedUrl(rawUrl: string, functionUrl: string, ipHash: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SUB_PLAYLIST_TOKEN_TTL;
  const encoded = base64UrlEncode(rawUrl);
  const sig = await hmacSign(`sub:${encoded}:${exp}:${ipHash}`);
  return `${functionUrl}/stream-proxy?mode=sub&u=${encoded}&exp=${exp}&sig=${sig}&h=${ipHash}`;
}

async function generateSegSignedUrl(rawUrl: string, functionUrl: string, ipHash: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SEG_TOKEN_TTL;
  const encoded = base64UrlEncode(rawUrl);
  const sig = await hmacSign(`seg:${encoded}:${exp}:${ipHash}`);
  return `${functionUrl}/stream-proxy?mode=seg&u=${encoded}&exp=${exp}&sig=${sig}&h=${ipHash}`;
}

async function generateYouTubeSignedUrl(playlistId: string, functionUrl: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + YT_TOKEN_TTL;
  const sig = await hmacSign(`yt:${playlistId}:${exp}`);
  return `${functionUrl}/stream-proxy?mode=yt&pid=${playlistId}&exp=${exp}&sig=${sig}`;
}

async function generateCloudflareSignedUrl(playlistId: string, functionUrl: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + YT_TOKEN_TTL;
  const sig = await hmacSign(`cf:${playlistId}:${exp}`);
  return `${functionUrl}/stream-proxy?mode=cf&pid=${playlistId}&exp=${exp}&sig=${sig}`;
}

// --- M3U8 REWRITING ---
// Only proxy sub-playlists (.m3u8), leave segment URLs as direct CDN URLs
// This avoids CORS issues with 302 redirects to CDNs that don't have CORS headers
async function rewriteM3u8Hybrid(content: string, baseUrl: string, functionUrl: string, ipHash: string): Promise<string> {
  const lines = content.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { result.push(line); continue; }

    if (trimmed.startsWith("#")) {
      if (trimmed.includes('URI="')) {
        const match = trimmed.match(/URI="([^"]+)"/);
        if (match) {
          const absUrl = resolveUrl(match[1], baseUrl);
          if (isM3u8Url(absUrl)) {
            // Proxy sub-playlists through signed URL
            const signed = await generateSubPlaylistSignedUrl(absUrl, functionUrl, ipHash);
            result.push(trimmed.replace(`URI="${match[1]}"`, `URI="${signed}"`));
          } else {
            // Keys and other non-m3u8 URIs: resolve to absolute CDN URL directly
            result.push(trimmed.replace(`URI="${match[1]}"`, `URI="${absUrl}"`));
          }
        } else { result.push(line); }
      } else { result.push(line); }
      continue;
    }

    // Non-comment, non-empty lines are URLs
    const absoluteUrl = resolveUrl(trimmed, baseUrl);
    if (isM3u8Url(absoluteUrl)) {
      // Sub-playlists: proxy through signed URL
      result.push(await generateSubPlaylistSignedUrl(absoluteUrl, functionUrl, ipHash));
    } else {
      // Segments (.ts): use direct CDN URL to avoid CORS issues with 302 redirects
      result.push(absoluteUrl);
    }
  }
  return result.join("\n");
}

async function fetchAndRewriteM3u8(originUrl: string, cacheKey: string, functionUrl: string, ipHash: string): Promise<FetchM3u8Result> {
  const fullCacheKey = `${cacheKey}:${ipHash}`;
  const cached = getCachedM3u8(fullCacheKey);
  if (cached) return { content: cached };

  let lastStatus: number | undefined;
  let lastErrorBody: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(originUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; StreamProxy/1.0)" },
        signal: controller.signal,
      });
      if (timeout) clearTimeout(timeout);

      if (!response.ok) {
        lastStatus = response.status;
        lastErrorBody = await response.text().catch(() => "");
        console.error(`[stream-proxy] fetch m3u8 failed: ${response.status} attempt ${attempt + 1}`);

        const isInactive = response.status === 412 && lastErrorBody.includes("live_stream_inactive");
        if (isInactive) {
          return { content: null, inactive: true, status: response.status, errorBody: lastErrorBody };
        }

        if (attempt === 0) continue;
        return { content: null, status: lastStatus, errorBody: lastErrorBody };
      }

      const content = await response.text();
      const baseUrl = getBaseUrl(originUrl);
      const rewritten = await rewriteM3u8Hybrid(content, baseUrl, functionUrl, ipHash);

      setCachedM3u8(fullCacheKey, rewritten);
      return { content: rewritten };
    } catch (err: any) {
      if (timeout) clearTimeout(timeout);
      console.error(`[stream-proxy] fetch m3u8 error attempt ${attempt + 1}:`, err?.message);
      lastErrorBody = err?.message || "unknown error";
      if (attempt === 0) continue;
      return { content: null, status: lastStatus, errorBody: lastErrorBody };
    }
  }

  return { content: null, status: lastStatus, errorBody: lastErrorBody };
}

// --- XOR ENCRYPTION for YouTube IDs ---
const _xk = [12,105,82,37,24,119,60,125,84,18,73,127,12,114,10,20];
const _xo = [94,61,102,29,96,60,5,16,5,32,63,51,59,28,90,32];
const XOR_KEY = _xk.map((v, i) => v ^ _xo[i]);

function xorDecryptId(encoded: string): string {
  if (!encoded.startsWith("enc:")) return encoded;
  const b64 = encoded.slice(4);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ XOR_KEY[i % XOR_KEY.length];
  }
  return new TextDecoder().decode(result);
}

function extractYouTubeId(url: string): string {
  if (!url) return url;
  const decrypted = xorDecryptId(url);
  if (/^[a-zA-Z0-9_-]{11}$/.test(decrypted)) return decrypted;
  const match = decrypted.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/watch\?.*v=)([a-zA-Z0-9_-]{11})/);
  return match?.[1] || decrypted;
}

function xorEncryptId(videoId: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(videoId);
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ XOR_KEY[i % XOR_KEY.length];
  }
  return "enc:" + btoa(String.fromCharCode(...result));
}

function generateYouTubeEmbedPage(videoId: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="X-Frame-Options" content="SAMEORIGIN">
<title>RT48 Player</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
iframe{width:100%;height:100%;border:none;position:absolute;top:0;left:0}
.overlay{position:absolute;top:0;left:0;width:100%;height:100%;z-index:10;pointer-events:none}
</style>
<script>
document.addEventListener('contextmenu',function(e){e.preventDefault()});
document.addEventListener('keydown',function(e){
  if(e.key==='F12'||(e.ctrlKey&&e.shiftKey&&(e.key==='I'||e.key==='J'))||(e.ctrlKey&&e.key==='u'))e.preventDefault();
});
if(window.top!==window.self){
  try{document.domain=document.domain}catch(e){}
}
</script>
</head>
<body>
<iframe 
  src="https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0&modestbranding=1&showinfo=0&fs=1&playsinline=1&enablejsapi=0&controls=1" 
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" 
  allowfullscreen
  loading="eager">
</iframe>
<div class="overlay"></div>
</body>
</html>`;
}

// ==============================================
// MAIN HANDLER
// ==============================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const rawXff = req.headers.get("x-forwarded-for") || "";
  const clientIp = rawXff.split(",")[0]?.trim()?.replace(/^::ffff:/i, "") || "unknown";
  const ipH = hashIp(clientIp);

  // Debug log for IP tracking (temporary)
  if (mode === "play" || mode === "sub" || mode === "seg") {
    const h = url.searchParams.get("h");
    if (h && h !== ipH) {
      console.warn(`[stream-proxy] IP debug: mode=${mode} xff="${rawXff}" clientIp="${clientIp}" expected_h=${h} actual_h=${ipH}`);
    }
  }

  // Block known abusive IPs immediately
  if (isAbusiveIp(clientIp)) {
    return new Response(
      JSON.stringify({ error: "Akses diblokir sementara karena aktivitas mencurigakan." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // --- GLOBAL RATE LIMITS ---
  // 500/min per IP — supports ~5 viewers on same WiFi/NAT
  // HLS needs ~50-90 req/min per viewer (manifest + sub + segments)
  if (!edgeRateLimit(`global:${clientIp}`, 500, 60000)) {
    const isStream = mode === "play" || mode === "sub" || mode === "seg";
    return getRateLimitResponse(isStream);
  }

  // Referer validation for POST requests (generate mode)
  if (req.method === "POST" && !isAllowedReferer(req)) {
    trackAbuse(clientIp);
    return new Response(
      JSON.stringify({ error: "Unauthorized origin" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // ===== MODE: generate (POST) =====
    if (req.method === "POST" && (!mode || mode === "generate")) {
      const body = await req.json();
      const { token_code, playlist_id, fingerprint, admin_preview } = body;

      // Strict rate limit: 20 generate requests per minute per IP
      // Each viewer refreshes every ~12 min, so 20/min supports ~240 viewers per IP
      if (!edgeRateLimit(`gen:${clientIp}`, 20, 60000)) {
        return getRateLimitResponse();
      }

      // --- ADMIN PREVIEW MODE ---
      if (admin_preview) {
        if (!playlist_id) {
          return new Response(
            JSON.stringify({ error: "Missing playlist_id" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Validate admin via JWT
        const authHeader = req.headers.get("authorization") || "";
        const jwt = authHeader.replace(/^Bearer\s+/i, "");
        if (!jwt) {
          return new Response(
            JSON.stringify({ error: "Unauthorized" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser(jwt);
        if (userErr || !user) {
          return new Response(
            JSON.stringify({ error: "Invalid session" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { data: isAdmin } = await supabaseAuth.rpc("has_role", { _user_id: user.id, _role: "admin" });
        if (!isAdmin) {
          return new Response(
            JSON.stringify({ error: "Admin access required" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Admin is verified — skip token validation, proceed to playlist lookup below
      } else {
        // --- NORMAL VIEWER MODE ---
        if (!token_code || !playlist_id) {
          return new Response(
            JSON.stringify({ error: "Missing token_code or playlist_id" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Validate token_code format (prevent SQL injection via RPC)
        if (typeof token_code !== "string" || token_code.length > 100) {
          trackAbuse(clientIp);
          return new Response(
            JSON.stringify({ error: "Invalid token format" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Validate playlist_id is UUID format
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playlist_id)) {
          trackAbuse(clientIp);
          return new Response(
            JSON.stringify({ error: "Invalid playlist ID" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        if (fingerprint) {
          const { data: sessResult, error: sessErr } = await supabase.rpc("create_token_session", {
            _token_code: token_code,
            _fingerprint: fingerprint,
            _user_agent: "stream-proxy",
          });
          const sr = sessResult as any;
          if (sessErr || !sr?.success) {
            const errMsg = sr?.error || "Token tidak valid";
            const isLegitFailure = errMsg === "device_limit" || errMsg.includes("kedaluwarsa") || errMsg.includes("expired");
            if (!isLegitFailure) trackAbuse(clientIp);
            return new Response(
              JSON.stringify({ error: errMsg, max_devices: sr?.max_devices, active_devices: sr?.active_devices }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else {
          const { data: validation, error: valErr } = await supabase.rpc("validate_token", { _code: token_code });
          if (valErr || !(validation as any)?.valid) {
            const errMsg = (validation as any)?.error || "";
            const isLegitFailure = errMsg.includes("kedaluwarsa") || errMsg.includes("expired") || errMsg.includes("replay");
            if (!isLegitFailure) trackAbuse(clientIp);
            return new Response(
              JSON.stringify({ error: errMsg || "Token tidak valid atau expired" }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }

      const supabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { data: playlist } = await supabaseClient
        .from("playlists").select("id, type").eq("id", playlist_id).single();

      if (!playlist) {
        return new Response(
          JSON.stringify({ error: "Playlist tidak ditemukan" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const functionUrl = `${SUPABASE_URL}/functions/v1`;

      if (playlist.type === "youtube") {
        const realUrl = await getPlaylistData(playlist_id);
        const videoId = extractYouTubeId(realUrl?.url || "");
        const encryptedId = xorEncryptId(videoId);
        return new Response(
          JSON.stringify({ signed_url: encryptedId, expires_in: YT_TOKEN_TTL, type: "youtube" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (playlist.type === "m3u8") {
        const signedUrl = await generatePlaylistSignedUrl(playlist_id, functionUrl, ipH);
        return new Response(
          JSON.stringify({ signed_url: signedUrl, expires_in: PLAYLIST_TOKEN_TTL, type: "m3u8" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (playlist.type === "cloudflare") {
        const cfSignedUrl = await generateCloudflareSignedUrl(playlist_id, functionUrl);
        return new Response(
          JSON.stringify({ signed_url: cfSignedUrl, expires_in: YT_TOKEN_TTL, type: "cloudflare" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (playlist.type === "proxy") {
        // Get active show's external_show_id
        const { data: activeShowSetting } = await supabaseClient.from("site_settings").select("value").eq("key", "active_show_id").single();
        if (!activeShowSetting?.value) {
          return new Response(
            JSON.stringify({ error: "Tidak ada show aktif yang dipilih" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { data: showData } = await supabaseClient.from("shows").select("external_show_id").eq("id", activeShowSetting.value).single();
        if (!showData?.external_show_id) {
          return new Response(
            JSON.stringify({ error: "External Show ID belum diatur untuk show aktif" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const signedUrl = await generateProxyPlaylistSignedUrl(playlist_id, functionUrl, ipH, showData.external_show_id);
        return new Response(
          JSON.stringify({ signed_url: signedUrl, expires_in: PLAYLIST_TOKEN_TTL, type: "m3u8" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const realUrl = await getPlaylistData(playlist_id);
      return new Response(
        JSON.stringify({ signed_url: realUrl?.url || "", expires_in: YT_TOKEN_TTL, type: playlist.type }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== MODE: play (GET) - m3u8 proxy =====
    if (req.method === "GET" && mode === "play") {
      const pid = url.searchParams.get("pid");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      const h = url.searchParams.get("h");

      // 150 manifest requests per minute per IP per playlist
      // HLS.js fetches every 2-5s = ~12-30/min per viewer, supports ~5 viewers/IP
      if (pid && !edgeRateLimit(`play:${clientIp}:${pid}`, 150, 60000)) {
        return getRateLimitResponse(true);
      }

      if (!pid || !exp || !sig || !h) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Token expired", { status: 403, headers: corsHeaders });
      }

      // Verify IP binding
      if (!ipHashMatches(h, clientIp, ipH)) {
        console.warn(`[stream-proxy] play IP mismatch: expected=${h} got=${ipH} ip=${clientIp}`);
        return new Response("IP mismatch - URL tidak bisa digunakan dari perangkat lain", { status: 403, headers: corsHeaders });
      }

      if (!(await hmacVerify(`playlist:${pid}:${exp}:${h}`, sig))) {
        trackAbuse(clientIp);
        return new Response("Invalid signature", { status: 403, headers: corsHeaders });
      }

      const plData = await getPlaylistData(pid);
      if (!plData) {
        return new Response("Playlist not found", { status: 404, headers: corsHeaders });
      }

      const functionUrl = `${SUPABASE_URL}/functions/v1`;
      const rewrittenResult = await fetchAndRewriteM3u8(plData.url, `play:${pid}`, functionUrl, ipH);

      if (rewrittenResult.inactive) {
        return new Response(
          "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ENDLIST\n",
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/vnd.apple.mpegurl",
              "Cache-Control": "no-store, no-cache, must-revalidate",
              "X-Stream-Status": "inactive",
            },
          }
        );
      }

      if (!rewrittenResult.content) {
        return new Response("Failed to fetch stream", {
          status: 502,
          headers: {
            ...corsHeaders,
            "X-Upstream-Status": String(rewrittenResult.status || 0),
          },
        });
      }

      return new Response(rewrittenResult.content, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Access-Control-Expose-Headers": "Content-Type",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // ===== MODE: seg (GET) - 302 redirect for TS segments =====
    if (req.method === "GET" && mode === "seg") {
      const encoded = url.searchParams.get("u");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      const h = url.searchParams.get("h");

      // Segment rate limit: per unique segment prefix, generous since each seg is unique
      if (encoded && !edgeRateLimit(`seg:${clientIp}:${encoded.slice(0, 20)}`, 60, 60000)) {
        return getRateLimitResponse(true);
      }

      if (!encoded || !exp || !sig || !h) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Segment expired", { status: 403, headers: corsHeaders });
      }

      // Verify IP binding
      if (!ipHashMatches(h, clientIp, ipH)) {
        console.warn(`[stream-proxy] seg IP mismatch: expected=${h} got=${ipH} ip=${clientIp}`);
        return new Response("IP mismatch", { status: 403, headers: corsHeaders });
      }

      if (!(await hmacVerify(`seg:${encoded}:${exp}:${h}`, sig))) {
        trackAbuse(clientIp);
        return new Response("Invalid signature", { status: 403, headers: corsHeaders });
      }

      const actualUrl = base64UrlDecode(encoded);

      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          "Location": actualUrl,
          "Cache-Control": "private, no-store, no-cache",
        },
      });
    }

    // ===== MODE: yt (GET) - YouTube embed proxy =====
    if (req.method === "GET" && mode === "yt") {
      const pid = url.searchParams.get("pid");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");

      if (pid && !edgeRateLimit(`yt:${clientIp}:${pid}`, 10, 60000)) {
        return getRateLimitResponse();
      }

      if (!pid || !exp || !sig) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Token expired", { status: 403, headers: corsHeaders });
      }

      if (!(await hmacVerify(`yt:${pid}:${exp}`, sig))) {
        trackAbuse(clientIp);
        return new Response("Invalid signature", { status: 403, headers: corsHeaders });
      }

      const plData = await getPlaylistData(pid);
      if (!plData) {
        return new Response("Playlist not found", { status: 404, headers: corsHeaders });
      }

      const videoId = extractYouTubeId(plData.url);
      const html = generateYouTubeEmbedPage(videoId);

      return new Response(html, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "ALLOWALL",
          "Referrer-Policy": "no-referrer",
        },
      });
    }

    // ===== MODE: cf (GET) - Cloudflare Stream embed proxy =====
    if (req.method === "GET" && mode === "cf") {
      const pid = url.searchParams.get("pid");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");

      if (pid && !edgeRateLimit(`cf:${clientIp}:${pid}`, 10, 60000)) {
        return getRateLimitResponse();
      }

      if (!pid || !exp || !sig) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Token expired", { status: 403, headers: corsHeaders });
      }

      if (!(await hmacVerify(`cf:${pid}:${exp}`, sig))) {
        trackAbuse(clientIp);
        return new Response("Invalid signature", { status: 403, headers: corsHeaders });
      }

      const plData = await getPlaylistData(pid);
      if (!plData) {
        return new Response("Playlist not found", { status: 404, headers: corsHeaders });
      }

      const cfUrl = plData.url;
      let embedUrl = "";
      if (cfUrl.includes("cloudflarestream.com") && cfUrl.includes("/iframe")) {
        embedUrl = cfUrl;
      } else if (cfUrl.includes("cloudflarestream.com")) {
        const id = cfUrl.split("/").filter(Boolean).pop();
        embedUrl = `https://iframe.videodelivery.net/${id}`;
      } else {
        embedUrl = `https://iframe.videodelivery.net/${cfUrl}`;
      }
      const sep = embedUrl.includes("?") ? "&" : "?";
      embedUrl = `${embedUrl}${sep}autoplay=true&preload=auto`;

      const html = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>RT48 Player</title>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden;background:#000}
iframe{width:100%;height:100%;border:none;position:absolute;top:0;left:0}</style>
<script>document.addEventListener('contextmenu',function(e){e.preventDefault()});
document.addEventListener('keydown',function(e){if(e.key==='F12'||(e.ctrlKey&&e.shiftKey&&(e.key==='I'||e.key==='J'))||(e.ctrlKey&&e.key==='u'))e.preventDefault();});
</script></head><body>
<iframe src="${embedUrl}" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>
</body></html>`;

      return new Response(html, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "ALLOWALL",
          "Referrer-Policy": "no-referrer",
        },
      });
    }

    // ===== MODE: sub (GET) - sub-playlist proxy for m3u8 =====
    if (req.method === "GET" && mode === "sub") {
      const encoded = url.searchParams.get("u");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      const h = url.searchParams.get("h");

      // 150 sub-playlist requests per minute per IP — same as manifest
      if (encoded && !edgeRateLimit(`sub:${clientIp}:${encoded.slice(0, 20)}`, 150, 60000)) {
        return getRateLimitResponse(true);
      }

      if (!encoded || !exp || !sig || !h) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Token expired", { status: 403, headers: corsHeaders });
      }

      // Verify IP binding
      if (!ipHashMatches(h, clientIp, ipH)) {
        console.warn(`[stream-proxy] sub IP mismatch: expected=${h} got=${ipH} ip=${clientIp}`);
        return new Response("IP mismatch", { status: 403, headers: corsHeaders });
      }

      if (!(await hmacVerify(`sub:${encoded}:${exp}:${h}`, sig))) {
        trackAbuse(clientIp);
        return new Response("Invalid signature", { status: 403, headers: corsHeaders });
      }

      const actualUrl = base64UrlDecode(encoded);

      const functionUrl = `${SUPABASE_URL}/functions/v1`;
      const rewritten = await fetchAndRewriteM3u8(actualUrl, `sub:${encoded.slice(0, 40)}`, functionUrl, ipH);

      if (!rewritten) {
        return new Response("Failed to fetch sub-playlist", { status: 502, headers: corsHeaders });
      }

      return new Response(rewritten, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    // ===== MODE: proxyplay (GET) - Proxy stream manifest =====
    if (req.method === "GET" && mode === "proxyplay") {
      const pid = url.searchParams.get("pid");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      const h = url.searchParams.get("h");
      const eid = url.searchParams.get("eid");

      if (pid && !edgeRateLimit(`proxyplay:${clientIp}:${pid}`, 150, 60000)) {
        return getRateLimitResponse(true);
      }

      if (!pid || !exp || !sig || !h || !eid) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Token expired", { status: 403, headers: corsHeaders });
      }

      if (!ipHashMatches(h, clientIp, ipH)) {
        console.warn(`[stream-proxy] proxyplay IP mismatch: expected=${h} got=${ipH} ip=${clientIp}`);
        return new Response("IP mismatch", { status: 403, headers: corsHeaders });
      }

      if (!(await hmacVerify(`proxyplay:${pid}:${exp}:${h}:${eid}`, sig))) {
        trackAbuse(clientIp);
        return new Response("Invalid signature", { status: 403, headers: corsHeaders });
      }

      const externalShowId = base64UrlDecode(eid);
      const proxyHeaders = await getProxyStreamHeaders(externalShowId);
      if (!proxyHeaders) {
        return new Response("Failed to get proxy stream token", { status: 502, headers: corsHeaders });
      }

      const cacheKey = `proxyplay:${pid}:${ipH}`;
      const cached = getCachedM3u8(cacheKey);
      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      }

      const manifestResult = await fetchProxyManifest(proxyHeaders);
      if (manifestResult.offline) {
        // Return empty ENDLIST manifest so HLS.js treats it as inactive (not error)
        return new Response(
          "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-ENDLIST\n",
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/vnd.apple.mpegurl",
              "Cache-Control": "no-store, no-cache, must-revalidate",
              "X-Stream-Status": "inactive",
            },
          }
        );
      }
      if (!manifestResult.content) {
        return new Response("Failed to fetch proxy stream", { status: 502, headers: corsHeaders });
      }
      const manifest = manifestResult.content;

      const functionUrl = `${SUPABASE_URL}/functions/v1`;
      const baseUrl = "https://proxy.mediastream48.workers.dev/api/proxy/";
      const rewritten = await rewriteProxyM3u8(manifest, baseUrl, functionUrl, ipH, externalShowId);
      setCachedM3u8(cacheKey, rewritten);

      return new Response(rewritten, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    // ===== MODE: proxyseg (GET) - Proxy segment with custom headers =====
    if (req.method === "GET" && mode === "proxyseg") {
      const encoded = url.searchParams.get("u");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");
      const h = url.searchParams.get("h");
      const eid = url.searchParams.get("eid");

      if (encoded && !edgeRateLimit(`proxyseg:${clientIp}:${encoded.slice(0, 20)}`, 300, 60000)) {
        return getRateLimitResponse(true);
      }

      if (!encoded || !exp || !sig || !h || !eid) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Segment expired", { status: 403, headers: corsHeaders });
      }

      if (!ipHashMatches(h, clientIp, ipH)) {
        console.warn(`[stream-proxy] proxyseg IP mismatch: expected=${h} got=${ipH} ip=${clientIp}`);
        return new Response("IP mismatch", { status: 403, headers: corsHeaders });
      }

      if (!(await hmacVerify(`proxyseg:${encoded}:${exp}:${h}:${eid}`, sig))) {
        trackAbuse(clientIp);
        return new Response("Invalid signature", { status: 403, headers: corsHeaders });
      }

      const actualUrl = base64UrlDecode(encoded);
      const externalShowId = base64UrlDecode(eid);

      // Check if this is a sub-playlist (.m3u8) or a segment
      if (isM3u8Url(actualUrl)) {
        // Sub-playlist: fetch with headers and rewrite
        const proxyHeaders = await getProxyStreamHeaders(externalShowId);
        if (!proxyHeaders) {
          return new Response("Failed to get proxy token", { status: 502, headers: corsHeaders });
        }

        const res = await fetch(actualUrl, {
          headers: {
            ...proxyHeaders,
            "User-Agent": "Mozilla/5.0 (compatible; StreamProxy/1.0)",
          },
        });
        if (!res.ok) {
          return new Response("Failed to fetch sub-playlist", { status: 502, headers: corsHeaders });
        }

        const content = await res.text();
        const baseUrl = actualUrl.substring(0, actualUrl.lastIndexOf("/") + 1);
        const functionUrl = `${SUPABASE_URL}/functions/v1`;
        const rewritten = await rewriteProxyM3u8(content, baseUrl, functionUrl, ipH, externalShowId);

        return new Response(rewritten, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      }

      // Segment: proxy the actual content with headers
      const proxyHeaders = await getProxyStreamHeaders(externalShowId);
      if (!proxyHeaders) {
        return new Response("Failed to get proxy token", { status: 502, headers: corsHeaders });
      }

      const segRes = await fetch(actualUrl, {
        headers: {
          ...proxyHeaders,
          "User-Agent": "Mozilla/5.0 (compatible; StreamProxy/1.0)",
        },
      });

      if (!segRes.ok) {
        return new Response("Failed to fetch segment", { status: 502, headers: corsHeaders });
      }

      return new Response(segRes.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": segRes.headers.get("Content-Type") || "video/mp2t",
          "Cache-Control": "private, max-age=5",
        },
      });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  } catch (err) {
    console.error("stream-proxy error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
