import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ProxyStreamResult {
  playbackUrl: string | null;
  /** Always-current headers ref — read inside xhrSetup without re-mounting HLS */
  customHeadersRef: React.MutableRefObject<Record<string, string> | null>;
  loading: boolean;
  error: string | null;
}

const TOKEN_REFRESH_MS = 115 * 60 * 1000; // 1 h 55 min (JWT exp = 2 h)
const PLAYBACK_URL = "https://proxy.mediastream48.workers.dev/api/stream/v2/playback";
const TOKEN_TO_PLAYBACK_DELAY_MS = 1500; // 1.5s buffer setelah token siap

/**
 * Hook: minta header auth ke edge function `idn-stream-token` (server-side JWT
 * generator) lalu inject langsung ke HLS.js xhr requests menuju
 * `/api/stream/v2/playback` via setRequestHeader.
 *
 * Persyaratan akses ditegakkan di edge function — caller harus login (Bearer JWT)
 * atau melampirkan token_code aktif. Frontend tinggal kirim show_id (opsional).
 */
export function useProxyStream(
  isProxy: boolean,
  externalShowId: string | null,
  refreshKey = 0,
  tokenCode?: string | null,
  restreamCode?: string | null,
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

      console.log("[ProxyStream] Requesting IDN token via edge function:", externalShowId);
      const { data, error: invokeErr } = await supabase.functions.invoke("idn-stream-token", {
        body: {
          show_id: externalShowId,
          ...(tokenCode ? { token_code: tokenCode } : {}),
          ...(restreamCode ? { restream_code: restreamCode } : {}),
        },
      });

      if (invokeErr) throw new Error(invokeErr.message || "Edge function error");
      if (!data?.success || !data?.headers) {
        throw new Error(data?.error || "Token response tidak valid");
      }
      if (!isMounted.current) return;

      const headers = data.headers as Record<string, string>;
      console.log("[ProxyStream] Headers received:", Object.keys(headers).join(", "));

      // Update headers ref (read by xhrSetup on every HLS request)
      customHeadersRef.current = {
        "x-api-token": String(headers["x-api-token"] || ""),
        "x-sec-key": String(headers["x-sec-key"] || ""),
        "x-token-id": String(headers["x-token-id"] || ""),
        "x-showid": String(headers["x-showid"] || ""),
      };

      if (isInitial) {
        // Buffer kecil agar token sudah ter-propagate di sisi proxy
        await new Promise((r) => setTimeout(r, TOKEN_TO_PLAYBACK_DELAY_MS));
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
  }, [isProxy, externalShowId, refreshKey, tokenCode, restreamCode]);

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
