import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SignedUrlResult {
  signedUrl: string | null;
  loading: boolean;
  error: string | null;
  proxyType: string | null;
}

/**
 * Hook for the public /restream page. Authenticates via a restream code
 * (validated server-side) instead of a viewer token.
 */
export function useRestreamSignedStreamUrl(
  playlist: { id: string; type: string; url: string } | null,
  restreamCode: string,
  refreshKey = 0
): SignedUrlResult {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proxyType, setProxyType] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const generate = useCallback(async () => {
    if (!playlist || !restreamCode) return;
    try {
      setLoading(true);
      setError(null);
      const response = await supabase.functions.invoke("stream-proxy", {
        method: "POST",
        body: {
          playlist_id: playlist.id,
          restream_code: restreamCode,
        },
      });
      if (response.error) throw new Error(response.error.message || "Gagal membuat URL");
      const data = response.data as { signed_url: string; expires_in: number; type: string };
      if (!isMounted.current) return;
      setSignedUrl(data.signed_url);
      setProxyType(data.type || null);
      setLoading(false);
      const refreshIn = Math.max((data.expires_in - 90) * 1000, 30000);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (isMounted.current) generate();
      }, refreshIn);
    } catch (err: any) {
      if (!isMounted.current) return;
      console.error("[useRestreamSignedStreamUrl]", err);
      setError(err.message || "Gagal memuat stream");
      setSignedUrl(null);
      setProxyType(null);
      setLoading(false);
    }
  }, [playlist?.id, playlist?.type, playlist?.url, restreamCode, refreshKey]);

  useEffect(() => {
    isMounted.current = true;
    setSignedUrl(null);
    setProxyType(null);
    generate();
    return () => {
      isMounted.current = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [generate]);

  return { signedUrl, loading, error, proxyType };
}
