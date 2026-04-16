import { useState, useEffect, useRef, useCallback } from "react";

interface ProxyStreamResult {
  playbackUrl: string | null;
  /** Always-current headers ref — read inside xhrSetup without re-mounting HLS */
  customHeadersRef: React.MutableRefObject<Record<string, string> | null>;
  loading: boolean;
  error: string | null;
}

const TOKEN_REFRESH_MS = 115 * 60 * 1000; // 1 h 55 min
const PLAYBACK_URL = "https://proxy.mediastream48.workers.dev/api/proxy/playback";
const TOKEN_TO_PLAYBACK_DELAY_MS = 1500; // 1.5s delay after token fetch before starting playback

/**
 * Hook: fetch token dari hanabira48.com/api/stream-token setiap ~1h55m,
 * lalu inject header auth langsung ke HLS.js xhr requests menuju
 * https://proxy.mediastream48.workers.dev/api/proxy/playback via setRequestHeader.
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
    if (!isProxy || !externalShowId) return;

    const isInitial = customHeadersRef.current === null;
    try {
      if (isInitial) setLoading(true);
      setError(null);

      const tokenUrl = `https://hanabira48.com/api/stream-token?showId=${encodeURIComponent(externalShowId)}`;
      console.log("[ProxyStream] Fetching token:", tokenUrl);
      const res = await fetch(tokenUrl);

      if (!res.ok) throw new Error(`Token API ${res.status}`);

      const data = await res.json();
      if (!isMounted.current) return;

      console.log("[ProxyStream] Token response:", JSON.stringify(data));

      const headers = extractHeaders(data);
      if (!headers) throw new Error("Token response tidak valid");

      console.log("[ProxyStream] Headers extracted:", Object.keys(headers).join(", "));

      // Update headers ref (read by xhrSetup on every HLS request)
      customHeadersRef.current = headers;

      if (isInitial) {
        // Delay sebelum set playback URL agar token siap di server proxy
        console.log(`[ProxyStream] Waiting ${TOKEN_TO_PLAYBACK_DELAY_MS}ms before playback...`);
        await new Promise(r => setTimeout(r, TOKEN_TO_PLAYBACK_DELAY_MS));
        if (!isMounted.current) return;

        setPlaybackUrl(PLAYBACK_URL);
        setLoading(false);
        console.log("[ProxyStream] Playback URL set:", PLAYBACK_URL);
      }

      // Schedule silent refresh
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (isMounted.current) {
          console.log("[ProxyStream] Silent token refresh...");
          fetchToken();
        }
      }, TOKEN_REFRESH_MS);
    } catch (err: any) {
      if (!isMounted.current) return;
      console.error("[ProxyStream] Error:", err);
      setError(err.message || "Gagal memuat stream");
      if (isInitial) {
        setLoading(false);
        setPlaybackUrl(null);
        customHeadersRef.current = null;
      }

      // Retry after 10s
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

/**
 * Extract auth headers dari berbagai format response stream-token.
 * Header ini akan di-inject langsung via xhr.setRequestHeader ke proxy playback.
 */
function extractHeaders(data: any): Record<string, string> | null {
  if (!data) return null;

  let apiToken: string | null = null;
  let secKey: string | null = null;
  let showId: string | null = null;
  let tokenId: string | null = null;

  // Shape 1: flat { apiToken, secKey, ... }
  if (data.apiToken && data.secKey) {
    apiToken = data.apiToken;
    secKey = data.secKey;
    showId = data.showId ?? "";
    tokenId = data.tokenId ?? "";
  }
  // Shape 2: { token: { ... } }
  else if (data.token?.apiToken && data.token?.secKey) {
    apiToken = data.token.apiToken;
    secKey = data.token.secKey;
    showId = data.token.showId ?? "";
    tokenId = data.token.tokenId ?? "";
  }
  // Shape 3: { data: { ... } }
  else if (data.data?.apiToken && data.data?.secKey) {
    apiToken = data.data.apiToken;
    secKey = data.data.secKey;
    showId = data.data.showId ?? "";
    tokenId = data.data.tokenId ?? "";
  }
  // Shape 4: x-header format
  else {
    apiToken = data["x-api-token"] ?? data.xapi ?? null;
    secKey = data["x-sec-key"] ?? data.xsec ?? null;
    showId = data["x-showid"] ?? data.xshowid ?? "";
    tokenId = data["x-token-id"] ?? data.xtoken ?? "";
  }

  if (!apiToken || !secKey) return null;

  return {
    "x-api-token": String(apiToken),
    "x-sec-key": String(secKey),
    "x-showid": String(showId),
    "x-token-id": String(tokenId),
  };
}
