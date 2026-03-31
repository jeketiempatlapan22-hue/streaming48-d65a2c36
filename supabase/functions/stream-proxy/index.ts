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
  "localhost",
  "streaming48.lovable.app",
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
  // Block after 15 failed attempts in 10 minutes
  return entry.count > 15;
}

function isAbusiveIp(ip: string): boolean {
  const entry = abuseTracker.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) { abuseTracker.delete(ip); return false; }
  return entry.count > 15;
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

interface CacheEntry { content: string; cachedAt: number }
const m3u8Cache = new Map<string, CacheEntry>();
const playlistUrlCache = new Map<string, { url: string; type: string; cachedAt: number }>();

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
// Include IP hash in signature so URLs can't be shared across different IPs
function hashIp(ip: string): string {
  // Simple fast hash for IP binding (not crypto, just uniqueness)
  let h = 0;
  for (let i = 0; i < ip.length; i++) {
    h = ((h << 5) - h + ip.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
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
            const signed = await generateSubPlaylistSignedUrl(absUrl, functionUrl, ipHash);
            result.push(trimmed.replace(`URI="${match[1]}"`, `URI="${signed}"`));
          } else {
            const signed = await generateSegSignedUrl(absUrl, functionUrl, ipHash);
            result.push(trimmed.replace(`URI="${match[1]}"`, `URI="${signed}"`));
          }
        } else { result.push(line); }
      } else { result.push(line); }
      continue;
    }

    const absoluteUrl = resolveUrl(trimmed, baseUrl);
    if (isM3u8Url(absoluteUrl)) {
      result.push(await generateSubPlaylistSignedUrl(absoluteUrl, functionUrl, ipHash));
    } else {
      result.push(await generateSegSignedUrl(absoluteUrl, functionUrl, ipHash));
    }
  }
  return result.join("\n");
}

async function fetchAndRewriteM3u8(originUrl: string, cacheKey: string, functionUrl: string, ipHash: string): Promise<string | null> {
  // IP-specific cache key so different IPs get different signed segments
  const fullCacheKey = `${cacheKey}:${ipHash}`;
  const cached = getCachedM3u8(fullCacheKey);
  if (cached) return cached;

  const response = await fetch(originUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; StreamProxy/1.0)" },
  });
  if (!response.ok) return null;

  const content = await response.text();
  const baseUrl = getBaseUrl(originUrl);
  const rewritten = await rewriteM3u8Hybrid(content, baseUrl, functionUrl, ipHash);

  setCachedM3u8(fullCacheKey, rewritten);
  return rewritten;
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
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipH = hashIp(clientIp);

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
      const { token_code, playlist_id, fingerprint } = body;

      // Strict rate limit: 20 generate requests per minute per IP
      // Each viewer refreshes every ~12 min, so 20/min supports ~240 viewers per IP
      if (!edgeRateLimit(`gen:${clientIp}`, 20, 60000)) {
        return getRateLimitResponse();
      }

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
          trackAbuse(clientIp);
          const errMsg = sr?.error || "Token tidak valid";
          return new Response(
            JSON.stringify({ error: errMsg, max_devices: sr?.max_devices, active_devices: sr?.active_devices }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        const { data: validation, error: valErr } = await supabase.rpc("validate_token", { _code: token_code });
        if (valErr || !(validation as any)?.valid) {
          trackAbuse(clientIp);
          return new Response(
            JSON.stringify({ error: (validation as any)?.error || "Token tidak valid atau expired" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const { data: playlist } = await supabase
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
      if (h !== ipH) {
        trackAbuse(clientIp);
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
      const rewritten = await fetchAndRewriteM3u8(plData.url, `play:${pid}`, functionUrl, ipH);

      if (!rewritten) {
        return new Response("Failed to fetch stream", { status: 502, headers: corsHeaders });
      }

      return new Response(rewritten, {
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

      // 120 segment requests per minute per IP per unique segment (was 600)
      if (encoded && !edgeRateLimit(`seg:${clientIp}:${encoded.slice(0, 20)}`, 120, 60000)) {
        return getRateLimitResponse(true);
      }

      if (!encoded || !exp || !sig || !h) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Segment expired", { status: 403, headers: corsHeaders });
      }

      // Verify IP binding
      if (h !== ipH) {
        trackAbuse(clientIp);
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

      // 120 sub-playlist requests per minute per IP (was 500)
      if (encoded && !edgeRateLimit(`sub:${clientIp}:${encoded.slice(0, 20)}`, 120, 60000)) {
        return getRateLimitResponse(true);
      }

      if (!encoded || !exp || !sig || !h) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Token expired", { status: 403, headers: corsHeaders });
      }

      // Verify IP binding
      if (h !== ipH) {
        trackAbuse(clientIp);
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

    return new Response("Not found", { status: 404, headers: corsHeaders });
  } catch (err) {
    console.error("stream-proxy error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
