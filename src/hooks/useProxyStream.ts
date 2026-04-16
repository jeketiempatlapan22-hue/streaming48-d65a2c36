import { useState, useEffect, useRef, useCallback } from "react";

interface ProxyStreamResult {
  playbackUrl: string | null;
  /** Always-current headers ref — read inside xhrSetup without re-mounting HLS */
  customHeadersRef: React.MutableRefObject<Record<string, string> | null>;
  loading: boolean;
  error: string | null;
}

const TOKEN_REFRESH_MS = 115 * 60 * 1000; // 1 h 55 min

/**
 * Hook: fetch token from hanabira48.com/api/stream-token every ~1h55m,
 * then inject auth headers via xhrSetup ref into HLS.js requests.
 * The playback URL comes directly from the token response (hanabira's own proxy).
 */
export function useProxyStream(
  isProxy: boolean,
  externalShowId: string | null,
  refreshKey = 0
): ProxyStreamResult {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const customHeadersRef = useRef<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const fetchToken = useCallback(async () => {
    console.log("[useProxyStream] fetchToken called, isProxy:", isProxy, "showId:", externalShowId);
    if (!isProxy || !externalShowId) return;

    const isInitial = customHeadersRef.current === null;
    try {
      if (isInitial) setLoading(true);
      setError(null);

      const tokenUrl = `https://hanabira48.com/api/stream-token?showId=${encodeURIComponent(externalShowId)}`;
      console.log("[useProxyStream] Fetching token from:", tokenUrl);
      const res = await fetch(tokenUrl);

      if (!res.ok) throw new Error(`Token API error: ${res.status} ${res.statusText}`);

      const tokenData = await res.json();
      if (!isMounted.current) return;

      console.log("[useProxyStream] Full token response:", JSON.stringify(tokenData));

      const parsed = parseTokenResponse(tokenData);
      if (!parsed) throw new Error("Token response tidak valid — data tidak ditemukan");

      console.log("[useProxyStream] Parsed playbackUrl:", parsed.playbackUrl);
      console.log("[useProxyStream] Headers:", JSON.stringify(parsed.headers));

      // Update ref silently — no state change, no HLS re-init on refresh
      customHeadersRef.current = parsed.headers;

      if (isInitial) {
        setPlaybackUrl(parsed.playbackUrl);
        setLoading(false);
      }

      // Schedule silent refresh every 1 h 55 min
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (isMounted.current) {
          console.log("[useProxyStream] Silent token refresh…");
          fetchToken();
        }
      }, TOKEN_REFRESH_MS);
    } catch (err: any) {
      if (!isMounted.current) return;
      console.error("[useProxyStream] Error:", err);
      setError(err.message || "Gagal memuat proxy stream");
      if (isInitial) {
        setLoading(false);
        setPlaybackUrl(null);
        customHeadersRef.current = null;
      }

      // Retry after 10 s
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (isMounted.current) fetchToken();
      }, 10_000);
    }
  }, [isProxy, externalShowId, refreshKey]);

  useEffect(() => {
    isMounted.current = true;
    setPlaybackUrl(null);
    customHeadersRef.current = null;
    if (isProxy && externalShowId) fetchToken();

    return () => {
      isMounted.current = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [fetchToken]);

  return { playbackUrl, customHeadersRef, loading, error };
}

interface ParsedToken {
  playbackUrl: string;
  headers: Record<string, string>;
}

/**
 * Parse hanabira48 token response.
 * Uses the playback URL directly from the response (hanabira has its own proxy).
 */
function parseTokenResponse(data: any): ParsedToken | null {
  if (!data) return null;

  // Extract playback URL from response
  const extractUrl = (src: any): string | null => {
    if (!src) return null;
    return src.playbackUrl || src.playback_url || src.url || src.streamUrl || src.stream_url || null;
  };

  let apiToken: string | null = null;
  let secKey: string | null = null;
  let showId: string | null = null;
  let tokenId: string | null = null;
  let playbackUrl: string | null = null;

  // Shape 1: flat { apiToken, secKey, showId, tokenId, playbackUrl? }
  if (data.apiToken && data.secKey) {
    apiToken = String(data.apiToken);
    secKey = String(data.secKey);
    showId = String(data.showId ?? "");
    tokenId = String(data.tokenId ?? "");
    playbackUrl = extractUrl(data);
  }
  // Shape 2: { token: { ... } }
  else if (data.token?.apiToken && data.token?.secKey) {
    apiToken = String(data.token.apiToken);
    secKey = String(data.token.secKey);
    showId = String(data.token.showId ?? "");
    tokenId = String(data.token.tokenId ?? "");
    playbackUrl = extractUrl(data.token) || extractUrl(data);
  }
  // Shape 3: { data: { ... } }
  else if (data.data?.apiToken && data.data?.secKey) {
    apiToken = String(data.data.apiToken);
    secKey = String(data.data.secKey);
    showId = String(data.data.showId ?? "");
    tokenId = String(data.data.tokenId ?? "");
    playbackUrl = extractUrl(data.data) || extractUrl(data);
  }
  // Shape 4: already x-header format
  else {
    const at = data["x-api-token"] ?? data.xapi;
    const sk = data["x-sec-key"] ?? data.xsec;
    if (at && sk) {
      apiToken = String(at);
      secKey = String(sk);
      showId = String(data["x-showid"] ?? data.xshowid ?? "");
      tokenId = String(data["x-token-id"] ?? data.xtoken ?? data.x ?? "");
      playbackUrl = extractUrl(data);
    }
  }

  if (!apiToken || !secKey) return null;

  // Use the URL from the token response directly (hanabira's own proxy)
  // No more overriding with workers.dev proxy
  if (!playbackUrl) {
    console.warn("[useProxyStream] No playbackUrl in token response, cannot proceed");
    return null;
  }

  console.log("[useProxyStream] Using playback URL from token response:", playbackUrl);

  const headers: Record<string, string> = {
    "x-api-token": apiToken,
    "x-sec-key": secKey,
    "x-showid": showId,
    "x-token-id": tokenId,
  };

  return { playbackUrl, headers };
}
