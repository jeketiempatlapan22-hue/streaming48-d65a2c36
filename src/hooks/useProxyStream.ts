import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ProxyStreamResult {
  playbackUrl: string | null;
  customHeaders: Record<string, string> | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook that fetches proxy stream token from hanabira48.com directly from frontend,
 * then provides the playback URL + custom headers for HLS.js to use.
 * This avoids routing all segments through the edge function.
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
    if (!isProxy) return;

    try {
      setLoading(true);
      setError(null);

      // 1. Get active_show_id from site_settings
      const { data: settings } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "active_show_id")
        .single();

      if (!settings?.value) {
        throw new Error("Tidak ada show aktif");
      }

      // 2. Get external_show_id from shows table
      const { data: show } = await supabase
        .from("shows")
        .select("external_show_id")
        .eq("id", settings.value)
        .single();

      if (!show?.external_show_id) {
        throw new Error("Show tidak memiliki External Show ID");
      }

      // 3. Fetch token from hanabira48 API
      const tokenRes = await fetch(
        `https://hanabira48.com/api/stream-token?showId=${encodeURIComponent(show.external_show_id)}`
      );

      if (!tokenRes.ok) {
        throw new Error(`Gagal mengambil token stream (${tokenRes.status})`);
      }

      const tokenData = await tokenRes.json();

      if (!isMounted.current) return;

      // 4. Build headers from response
      const headers: Record<string, string> = {};
      if (tokenData["x-api-token"]) headers["x-api-token"] = tokenData["x-api-token"];
      if (tokenData["x-sec-key"]) headers["x-sec-key"] = tokenData["x-sec-key"];
      if (tokenData["x-showid"]) headers["x-showid"] = tokenData["x-showid"];
      if (tokenData["x-token-id"]) headers["x-token-id"] = tokenData["x-token-id"];

      // Also handle alternative key names (xapi, xsec, etc.)
      if (!headers["x-api-token"] && tokenData.xapi) headers["x-api-token"] = tokenData.xapi;
      if (!headers["x-sec-key"] && tokenData.xsec) headers["x-sec-key"] = tokenData.xsec;
      if (!headers["x-showid"] && tokenData.xshowid) headers["x-showid"] = tokenData.xshowid;
      if (!headers["x-token-id"] && tokenData.xtoken) headers["x-token-id"] = tokenData.xtoken;

      if (Object.keys(headers).length === 0) {
        throw new Error("Token response tidak mengandung header yang valid");
      }

      setCustomHeaders(headers);
      setPlaybackUrl("https://proxy.mediastream48.workers.dev/api/proxy/playback");
      setLoading(false);

      // Refresh token every 4 minutes (tokens usually valid for ~5 min)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (isMounted.current) fetchProxyHeaders();
      }, 4 * 60 * 1000);
    } catch (err: any) {
      if (!isMounted.current) return;
      console.error("[useProxyStream] Error:", err);
      setError(err.message || "Gagal memuat proxy stream");
      setLoading(false);
      setPlaybackUrl(null);
      setCustomHeaders(null);
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
