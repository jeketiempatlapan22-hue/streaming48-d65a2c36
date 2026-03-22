import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SignedUrlResult {
  signedUrl: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook that generates and auto-refreshes signed proxy URLs for m3u8 playlists.
 * For non-m3u8 playlists, returns the original URL directly.
 */
export function useSignedStreamUrl(
  playlist: { id: string; type: string; url: string } | null,
  tokenCode: string
): SignedUrlResult {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMounted = useRef(true);

  const generateSignedUrl = useCallback(async () => {
    if (!playlist || !tokenCode) return;

    // Only tokenize m3u8 streams
    if (playlist.type !== "m3u8") {
      setSignedUrl(playlist.url);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await supabase.functions.invoke("stream-proxy", {
        method: "POST",
        body: {
          token_code: tokenCode,
          playlist_id: playlist.id,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Failed to generate signed URL");
      }

      const data = response.data as { signed_url: string; expires_in: number };

      if (!isMounted.current) return;

      setSignedUrl(data.signed_url);
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

      // Fallback: use raw URL if signing fails (degraded mode)
      setSignedUrl(playlist.url);
    }
  }, [playlist?.id, playlist?.type, playlist?.url, tokenCode]);

  useEffect(() => {
    isMounted.current = true;
    setSignedUrl(null);
    generateSignedUrl();

    return () => {
      isMounted.current = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [generateSignedUrl]);

  return { signedUrl, loading, error };
}
