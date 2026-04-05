import { useState, useEffect, useRef, useCallback } from "react";

interface ProxyStreamResult {
  playbackUrl: string | null;
  customHeaders: Record<string, string> | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook that fetches stream token directly from hanabira48.com API (no CORS issues — domain whitelisted),
 * then provides the playback URL + custom headers for HLS.js to use directly.
 * Browser → hanabira48.com (token) → proxy.mediastream48.workers.dev (playback with headers).
 */
export function useProxyStream(
  isProxy: boolean,
  externalShowId: string | null,
  refreshKey = 0
): ProxyStreamResult {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [customHeaders, setCustomHeaders] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const fetchToken = useCallback(async () => {
    console.log("[useProxyStream] fetchToken called, isProxy:", isProxy, "showId:", externalShowId);
    if (!isProxy || !externalShowId) return;

    try {
      setLoading(true);
      setError(null);

      console.log("[useProxyStream] Fetching token directly from hanabira48 for showId:", externalShowId);

      const tokenUrl = `https://hanabira48.com/api/stream-token?showId=${encodeURIComponent(externalShowId)}`;
      const res = await fetch(tokenUrl);

      if (!res.ok) {
        throw new Error(`Token API error: ${res.status} ${res.statusText}`);
      }

      const tokenData = await res.json();

      if (!isMounted.current) return;

      console.log("[useProxyStream] hanabira48 token response:", tokenData);

      // Extract headers from various response shapes
      const headers = buildHeaders(tokenData);

      if (!headers) {
        throw new Error("Token response tidak valid — headers tidak ditemukan");
      }

      console.log("[useProxyStream] Headers ready:", Object.keys(headers));

      setCustomHeaders(headers);
      setPlaybackUrl("https://proxy.mediastream48.workers.dev/api/proxy/playback");
      setLoading(false);

      // Refresh token every 4 minutes
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (isMounted.current) {
          console.log("[useProxyStream] Refreshing token...");
          fetchToken();
        }
      }, 4 * 60 * 1000);
    } catch (err: any) {
      if (!isMounted.current) return;
      console.error("[useProxyStream] Error:", err);
      setError(err.message || "Gagal memuat proxy stream");
      setLoading(false);
      setPlaybackUrl(null);
      setCustomHeaders(null);

      // Retry after 10 seconds on error
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (isMounted.current) {
          console.log("[useProxyStream] Retrying after error...");
          fetchToken();
        }
      }, 10_000);
    }
  }, [isProxy, externalShowId, refreshKey]);

  useEffect(() => {
    isMounted.current = true;
    setPlaybackUrl(null);
    setCustomHeaders(null);
    if (isProxy && externalShowId) fetchToken();

    return () => {
      isMounted.current = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [fetchToken]);

  return { playbackUrl, customHeaders, loading, error };
}

/**
 * Extract auth headers from hanabira48 token response.
 * Supports multiple payload shapes.
 */
function buildHeaders(data: any): Record<string, string> | null {
  if (!data) return null;

  // Shape 1: { apiToken, secKey, showId, tokenId }
  if (data.apiToken && data.secKey) {
    return {
      "x-api-token": data.apiToken,
      "x-sec-key": data.secKey,
      "x-showid": String(data.showId || ""),
      "x-token-id": String(data.tokenId || ""),
    };
  }

  // Shape 2: { token: { apiToken, secKey, ... } }
  if (data.token?.apiToken && data.token?.secKey) {
    return {
      "x-api-token": data.token.apiToken,
      "x-sec-key": data.token.secKey,
      "x-showid": String(data.token.showId || ""),
      "x-token-id": String(data.token.tokenId || ""),
    };
  }

  // Shape 3: { data: { apiToken, secKey, ... } }
  if (data.data?.apiToken && data.data?.secKey) {
    return {
      "x-api-token": data.data.apiToken,
      "x-sec-key": data.data.secKey,
      "x-showid": String(data.data.showId || ""),
      "x-token-id": String(data.data.tokenId || ""),
    };
  }

  // Shape 4: headers already in x-api-token format
  if (data["x-api-token"] && data["x-sec-key"]) {
    return {
      "x-api-token": data["x-api-token"],
      "x-sec-key": data["x-sec-key"],
      "x-showid": data["x-showid"] || "",
      "x-token-id": data["x-token-id"] || "",
    };
  }

  return null;
}
