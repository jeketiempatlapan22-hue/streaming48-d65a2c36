import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ProxyStreamResult {
  playbackUrl: string | null;
  customHeaders: Record<string, string> | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook that fetches stream token via proxy-token edge function (avoids CORS),
 * then provides the playback URL + custom headers for HLS.js to use directly.
 * Browser → Edge Function (proxy-token) → hanabira48 (token) → proxy.mediastream48 (playback with headers).
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

      console.log("[useProxyStream] Calling proxy-token edge function for showId:", externalShowId);

      const { data, error: fnError } = await supabase.functions.invoke("proxy-token", {
        body: { show_id: externalShowId },
      });

      if (fnError) {
        throw new Error(`Edge function error: ${fnError.message}`);
      }

      if (!isMounted.current) return;

      console.log("[useProxyStream] proxy-token response:", data);

      if (!data?.success || !data?.headers) {
        throw new Error(data?.error || "Token response tidak valid");
      }

      const headers = data.headers as Record<string, string>;
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
