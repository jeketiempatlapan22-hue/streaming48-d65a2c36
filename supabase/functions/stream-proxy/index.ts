import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIGNING_SECRET = SERVICE_ROLE_KEY;

const PLAYLIST_TOKEN_TTL = 300;
const SUB_PLAYLIST_TOKEN_TTL = 600;
const YT_TOKEN_TTL = 600;

// In-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function edgeRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (rateLimitMap.size > 2000) {
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

function getRateLimitResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Terlalu banyak request. Coba lagi nanti." }),
    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "30" } }
  );
}

// In-memory cache
const M3U8_CACHE_TTL_MS = 6000;
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

// Crypto helpers
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
  return expected === signature;
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

async function generatePlaylistSignedUrl(playlistId: string, functionUrl: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + PLAYLIST_TOKEN_TTL;
  const sig = await hmacSign(`playlist:${playlistId}:${exp}`);
  return `${functionUrl}/stream-proxy?mode=play&pid=${playlistId}&exp=${exp}&sig=${sig}`;
}

async function generateSubPlaylistSignedUrl(rawUrl: string, functionUrl: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SUB_PLAYLIST_TOKEN_TTL;
  const encoded = base64UrlEncode(rawUrl);
  const sig = await hmacSign(`sub:${encoded}:${exp}`);
  return `${functionUrl}/stream-proxy?mode=sub&u=${encoded}&exp=${exp}&sig=${sig}`;
}

async function generateYouTubeSignedUrl(playlistId: string, functionUrl: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + YT_TOKEN_TTL;
  const sig = await hmacSign(`yt:${playlistId}:${exp}`);
  return `${functionUrl}/stream-proxy?mode=yt&pid=${playlistId}&exp=${exp}&sig=${sig}`;
}

async function rewriteM3u8Hybrid(content: string, baseUrl: string, functionUrl: string): Promise<string> {
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
            const signed = await generateSubPlaylistSignedUrl(absUrl, functionUrl);
            result.push(trimmed.replace(`URI="${match[1]}"`, `URI="${signed}"`));
          } else {
            result.push(trimmed.replace(`URI="${match[1]}"`, `URI="${absUrl}"`));
          }
        } else { result.push(line); }
      } else { result.push(line); }
      continue;
    }

    const absoluteUrl = resolveUrl(trimmed, baseUrl);
    if (isM3u8Url(absoluteUrl)) {
      result.push(await generateSubPlaylistSignedUrl(absoluteUrl, functionUrl));
    } else {
      result.push(absoluteUrl);
    }
  }
  return result.join("\n");
}

async function fetchAndRewriteM3u8(originUrl: string, cacheKey: string, functionUrl: string): Promise<string | null> {
  const cached = getCachedM3u8(cacheKey);
  if (cached) return cached;

  const response = await fetch(originUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; StreamProxy/1.0)" },
  });
  if (!response.ok) return null;

  const content = await response.text();
  const baseUrl = getBaseUrl(originUrl);
  const rewritten = await rewriteM3u8Hybrid(content, baseUrl, functionUrl);

  setCachedM3u8(cacheKey, rewritten);
  return rewritten;
}

// Extract YouTube video ID from various URL formats
function extractYouTubeId(url: string): string {
  if (!url) return url;
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  const match = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/watch\?.*v=)([a-zA-Z0-9_-]{11})/);
  return match?.[1] || url;
}

// XOR encrypt YouTube video ID to prevent exposure in network responses
function xorEncryptId(videoId: string): string {
  const key = [82,84,52,56,120,75,57,109,81,50,118,76,55,110,80,52];
  const encoder = new TextEncoder();
  const bytes = encoder.encode(videoId);
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ key[i % key.length];
  }
  return "enc:" + btoa(String.fromCharCode(...result));
}

// Generate a secure YouTube embed HTML page
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
// Prevent right-click
document.addEventListener('contextmenu',function(e){e.preventDefault()});
// Prevent view source shortcuts
document.addEventListener('keydown',function(e){
  if(e.key==='F12'||(e.ctrlKey&&e.shiftKey&&(e.key==='I'||e.key==='J'))||(e.ctrlKey&&e.key==='u'))e.preventDefault();
});
// Block frame-busting attempts
if(window.top!==window.self){
  try{document.domain=document.domain}catch(e){}
}
</script>
</head>
<body>
<iframe 
  src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&showinfo=0&fs=1&playsinline=1&enablejsapi=0&origin=${encodeURIComponent(SUPABASE_URL)}" 
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" 
  allowfullscreen
  sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
  referrerpolicy="no-referrer"
  loading="eager">
</iframe>
<div class="overlay"></div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");

  try {
    // MODE: generate (POST) - generates signed URLs for m3u8 AND youtube
    if (req.method === "POST" && (!mode || mode === "generate")) {
      const body = await req.json();
      const { token_code, playlist_id } = body;

      const genClientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      if (token_code && !edgeRateLimit(`gen:${genClientIp}`, 15, 60000)) {
        return getRateLimitResponse();
      }

      if (!token_code || !playlist_id) {
        return new Response(
          JSON.stringify({ error: "Missing token_code or playlist_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { data: validation, error: valErr } = await supabase.rpc("validate_token", { _code: token_code });

      if (valErr || !(validation as any)?.valid) {
        return new Response(
          JSON.stringify({ error: (validation as any)?.error || "Token tidak valid atau expired" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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
        // Generate signed YouTube proxy URL
        const signedUrl = await generateYouTubeSignedUrl(playlist_id, functionUrl);
        return new Response(
          JSON.stringify({ signed_url: signedUrl, expires_in: YT_TOKEN_TTL, type: "youtube_proxy" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (playlist.type === "m3u8") {
        const signedUrl = await generatePlaylistSignedUrl(playlist_id, functionUrl);
        return new Response(
          JSON.stringify({ signed_url: signedUrl, expires_in: PLAYLIST_TOKEN_TTL, type: "m3u8" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // For cloudflare or other types, also proxy
      const signedUrl = await generateYouTubeSignedUrl(playlist_id, functionUrl);
      return new Response(
        JSON.stringify({ signed_url: signedUrl, expires_in: YT_TOKEN_TTL, type: playlist.type }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // MODE: play (GET) - m3u8 proxy
    if (req.method === "GET" && mode === "play") {
      const pid = url.searchParams.get("pid");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");

      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      if (pid && !edgeRateLimit(`play:${clientIp}:${pid}`, 30, 60000)) {
        return getRateLimitResponse();
      }

      if (!pid || !exp || !sig) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Token expired", { status: 403, headers: corsHeaders });
      }

      if (!(await hmacVerify(`playlist:${pid}:${exp}`, sig))) {
        return new Response("Invalid signature", { status: 403, headers: corsHeaders });
      }

      const plData = await getPlaylistData(pid);
      if (!plData) {
        return new Response("Playlist not found", { status: 404, headers: corsHeaders });
      }

      const functionUrl = `${SUPABASE_URL}/functions/v1`;
      const rewritten = await fetchAndRewriteM3u8(plData.url, `play:${pid}`, functionUrl);

      if (!rewritten) {
        return new Response("Failed to fetch stream", { status: 502, headers: corsHeaders });
      }

      return new Response(rewritten, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache, no-store",
          "Access-Control-Expose-Headers": "Content-Type",
        },
      });
    }

    // MODE: yt (GET) - YouTube embed proxy
    if (req.method === "GET" && mode === "yt") {
      const pid = url.searchParams.get("pid");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");

      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      if (pid && !edgeRateLimit(`yt:${clientIp}:${pid}`, 20, 60000)) {
        return getRateLimitResponse();
      }

      if (!pid || !exp || !sig) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Token expired", { status: 403, headers: corsHeaders });
      }

      if (!(await hmacVerify(`yt:${pid}:${exp}`, sig))) {
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

    // MODE: sub (GET) - sub-playlist proxy for m3u8
    if (req.method === "GET" && mode === "sub") {
      const encoded = url.searchParams.get("u");
      const exp = url.searchParams.get("exp");
      const sig = url.searchParams.get("sig");

      const clientIpSub = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      if (encoded && !edgeRateLimit(`sub:${clientIpSub}:${encoded.slice(0, 20)}`, 60, 60000)) {
        return getRateLimitResponse();
      }

      if (!encoded || !exp || !sig) {
        return new Response("Missing parameters", { status: 400, headers: corsHeaders });
      }

      if (Date.now() / 1000 > parseInt(exp, 10)) {
        return new Response("Token expired", { status: 403, headers: corsHeaders });
      }

      if (!(await hmacVerify(`sub:${encoded}:${exp}`, sig))) {
        return new Response("Invalid signature", { status: 403, headers: corsHeaders });
      }

      const actualUrl = base64UrlDecode(encoded);

      const functionUrl = `${SUPABASE_URL}/functions/v1`;
      const rewritten = await fetchAndRewriteM3u8(actualUrl, `sub:${encoded.slice(0, 40)}`, functionUrl);

      if (!rewritten) {
        return new Response("Failed to fetch sub-playlist", { status: 502, headers: corsHeaders });
      }

      return new Response(rewritten, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache, no-store",
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
