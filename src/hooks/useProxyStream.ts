import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ProxyStreamResult {
  playbackUrl: string | null;
  customHeaders: Record<string, string> | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook that fetches proxy stream token via edge function (avoids CORS),
 * then provides the playback URL + custom headers for HLS.js to use directly.
 * Stream segments go directly from browser → proxy server (no edge function proxy).
 */
export function useProxyStream(
  isProxy: boolean,
  refreshKey = 0
): ProxyStreamResult {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [customHeaders, setCustomHeaders] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const fetchProxyHeaders = useCallback(async () => {
    console.log("[useProxyStream] fetchProxyHeaders called, isProxy:", isProxy);
    if (!isProxy) return;

    try {
      setLoading(true);
      setError(null);

      console.log("[useProxyStream] Fetching token via edge function...");

      // Call lightweight edge function to fetch token (bypasses CORS)
      const { data, error: fnError } = await supabase.functions.invoke("proxy-token", {
        method: "POST",
        body: {},
      });

      if (fnError) {
        throw new Error(`Edge function error: ${fnError.message}`);
      }

      if (!data?.success) {
        throw new Error(data?.error || "Gagal mengambil token stream");
      }

      if (!isMounted.current) return;

      const headers = data.headers as Record<string, string>;
      
      if (!headers || Object.keys(headers).length === 0) {
        throw new Error("Token response tidak mengandung header yang valid");
      }

      console.log("[useProxyStream] Got headers:", Object.keys(headers));
      console.log("[useProxyStream] Show ID:", data.show_id);

      setCustomHeaders(headers);
      setPlaybackUrl("https://proxy.mediastream48.workers.dev/api/proxy/playback");
      setLoading(false);

      // Refresh token every 4 minutes (tokens usually valid for ~5 min)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (isMounted.current) {
          console.log("[useProxyStream] Refreshing token...");
          fetchProxyHeaders();
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
          fetchProxyHeaders();
        }
      }, 10_000);
    }
  }, [isProxy, refreshKey]);

  useEffect(() => {
    isMounted.current = true;
    setPlaybackUrl(null);
    setCustomHeaders(null);
    if (isProxy) fetchProxyHeaders();

    return () => {
      isMounted.current = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [fetchProxyHeaders]);

  return { playbackUrl, customHeaders, loading, error };
}
