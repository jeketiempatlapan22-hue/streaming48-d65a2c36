import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SignedUrlResult {
  signedUrl: string | null;
  loading: boolean;
  error: string | null;
  proxyType: string | null;
}

/**
 * Hook that generates signed proxy URLs for all stream types.
 * YouTube and m3u8 go through the stream-proxy edge function.
 * Cloudflare streams also get proxied.
 */
export function useSignedStreamUrl(
  playlist: { id: string; type: string; url: string } | null,
  tokenCode: string,
  fingerprint?: string
): SignedUrlResult {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proxyType, setProxyType] = useState<string | null>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMounted = useRef(true);

  const generateSignedUrl = useCallback(async () => {
    if (!playlist || !tokenCode) return;

    try {
      setLoading(true);
      setError(null);

      const response = await supabase.functions.invoke("stream-proxy", {
        method: "POST",
        body: {
          token_code: tokenCode,
          playlist_id: playlist.id,
          fingerprint: fingerprint || undefined,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Failed to generate signed URL");
      }

      const data = response.data as { signed_url: string; expires_in: number; type: string };

      if (!isMounted.current) return;

      setSignedUrl(data.signed_url);
      setProxyType(data.type || null);
      setLoading(false);

      // Auto-refresh 60 seconds before expiry
      const refreshIn = Math.max((data.expires_in - 60) * 1000, 30000);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (isMounted.current) generateSignedUrl();
      }, refreshIn);
    } catch (err: any) {
      if (!isMounted.current) return;
      console.error("[useSignedStreamUrl] Error:", err);
      setError(err.message || "Failed to get stream URL");
      setLoading(false);
      // No fallback to raw URL - keep it protected
      setSignedUrl(null);
    }
  }, [playlist?.id, playlist?.type, tokenCode, fingerprint]);

  useEffect(() => {
    isMounted.current = true;
    setSignedUrl(null);
    setProxyType(null);
    generateSignedUrl();

    return () => {
      isMounted.current = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [generateSignedUrl]);

  return { signedUrl, loading, error, proxyType };
}
