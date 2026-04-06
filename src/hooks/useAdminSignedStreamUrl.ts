import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SignedUrlResult {
  signedUrl: string | null;
  loading: boolean;
  error: string | null;
  proxyType: string | null;
}

export function useAdminSignedStreamUrl(
  playlist: { id: string; type: string; url: string } | null,
  refreshKey = 0
): SignedUrlResult {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proxyType, setProxyType] = useState<string | null>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMounted = useRef(true);

  const generateSignedUrl = useCallback(async () => {
    if (!playlist) return;

    try {
      setLoading(true);
      setError(null);

      const response = await supabase.functions.invoke("stream-proxy", {
        method: "POST",
        body: {
          playlist_id: playlist.id,
          admin_preview: true,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Failed to generate admin preview URL");
      }

      const data = response.data as { signed_url: string; expires_in: number; type: string };

      if (!isMounted.current) return;

      setSignedUrl(data.signed_url);
      setProxyType(data.type || null);
      setLoading(false);

      const refreshIn = Math.max((data.expires_in - 90) * 1000, 30000);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        if (isMounted.current) generateSignedUrl();
      }, refreshIn);
    } catch (err: any) {
      if (!isMounted.current) return;
      console.error("[useAdminSignedStreamUrl] Error:", err);
      setError(err.message || "Failed to get stream URL");
      setLoading(false);
      setSignedUrl(null);
      setProxyType(null);
    }
  }, [playlist?.id, playlist?.type, playlist?.url, refreshKey]);

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
