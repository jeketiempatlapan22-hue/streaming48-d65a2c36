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
 * Hook that fetches stream token directly from hanabira48.com API (no CORS issues — domain whitelisted),
 * then provides the playback URL + a **ref** to custom headers so HLS.js xhrSetup always uses
 * the latest token without destroying / re-creating the player.
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
      const res = await fetch(tokenUrl);

      if (!res.ok) throw new Error(`Token API error: ${res.status} ${res.statusText}`);

      const tokenData = await res.json();
      if (!isMounted.current) return;

      console.log("[useProxyStream] token response:", tokenData);

      const headers = buildHeaders(tokenData);
      if (!headers) throw new Error("Token response tidak valid — headers tidak ditemukan");

      console.log("[useProxyStream] Headers ready:", Object.keys(headers));

      // Update ref silently — no state change, no HLS re-init
      customHeadersRef.current = headers;

      if (isInitial) {
        setPlaybackUrl("https://proxy.mediastream48.workers.dev/api/proxy/playback");
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

/**
 * Extract auth headers from hanabira48 token response.
 * Supports multiple payload shapes.
 */
function buildHeaders(data: any): Record<string, string> | null {
  if (!data) return null;

  // Shape 1: { apiToken, secKey, showId, tokenId }
  if (data.apiToken && data.secKey) {
    return createCompatHeaders(data.apiToken, data.secKey, data.showId, data.tokenId);
  }

  // Shape 2: { token: { apiToken, secKey, ... } }
  if (data.token?.apiToken && data.token?.secKey) {
    return createCompatHeaders(data.token.apiToken, data.token.secKey, data.token.showId, data.token.tokenId);
  }

  // Shape 3: { data: { apiToken, secKey, ... } }
  if (data.data?.apiToken && data.data?.secKey) {
    return createCompatHeaders(data.data.apiToken, data.data.secKey, data.data.showId, data.data.tokenId);
  }

  // Shape 4: headers already in x-api-token format / compact alias format
  const apiToken = data["x-api-token"] ?? data.xapi;
  const secKey = data["x-sec-key"] ?? data.xsec;
  if (apiToken && secKey) {
    return createCompatHeaders(
      apiToken,
      secKey,
      data["x-showid"] ?? data.xshowid,
      data["x-token-id"] ?? data.xtoken ?? data.x
    );
  }

  return null;
}

function createCompatHeaders(
  apiToken: unknown,
  secKey: unknown,
  showId: unknown,
  tokenId: unknown
): Record<string, string> {
  const normalized = {
    apiToken: String(apiToken ?? ""),
    secKey: String(secKey ?? ""),
    showId: String(showId ?? ""),
    tokenId: String(tokenId ?? ""),
  };

  return {
    "x-api-token": normalized.apiToken,
    "x-sec-key": normalized.secKey,
    "x-showid": normalized.showId,
    "x-token-id": normalized.tokenId,
    xapi: normalized.apiToken,
    xsec: normalized.secKey,
    xshowid: normalized.showId,
    x: normalized.tokenId,
  };
}
