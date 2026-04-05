import { useState, useEffect, useRef, useCallback } from "react";

interface ProxyStreamResult {
  playbackUrl: string | null;
  customHeaders: Record<string, string> | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook that fetches stream token directly from hanabira48.com (no edge function),
 * then provides the playback URL + custom headers for HLS.js to use directly.
 * Browser → hanabira48 (token) → proxy.mediastream48 (playback with headers).
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

      const tokenUrl = `https://hanabira48.com/api/stream-token?showId=${encodeURIComponent(externalShowId)}`;
      console.log("[useProxyStream] Fetching token directly:", tokenUrl);

      const res = await fetch(tokenUrl, {
        headers: {
          "Accept": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`Token API error: ${res.status}`);
      }

      const tokenPayload = await res.json();
      console.log("[useProxyStream] Token response keys:", Object.keys(tokenPayload));

      if (!isMounted.current) return;

      // Extract headers from token response (support nested .data or flat)
      const source = tokenPayload?.data && typeof tokenPayload.data === "object"
        ? tokenPayload.data
        : tokenPayload;

      const apiToken = source?.apiToken ?? source?.api_token ?? source?.["x-api-token"] ?? source?.xapi;
      const secKey = source?.secKey ?? source?.sec_key ?? source?.["x-sec-key"] ?? source?.xsec;
      const showId = source?.showId ?? source?.show_id ?? source?.["x-showid"] ?? source?.xshowid;
      const tokenId = source?.tokenId ?? source?.token_id ?? source?.["x-token-id"] ?? source?.xtoken ?? source?.x;

      if (!apiToken || !secKey || !showId || !tokenId) {
        console.error("[useProxyStream] Missing token fields:", { apiToken: !!apiToken, secKey: !!secKey, showId: !!showId, tokenId: !!tokenId });
        throw new Error("Token response tidak lengkap");
      }

      const headers: Record<string, string> = {
        "x-api-token": String(apiToken),
        "x-sec-key": String(secKey),
        "x-showid": String(showId),
        "x-token-id": String(tokenId),
        xapi: String(apiToken),
        xsec: String(secKey),
        xshowid: String(showId),
        x: String(tokenId),
      };

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
