import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePurchasedShows } from "@/hooks/usePurchasedShows";

/**
 * Mengembalikan status live + token akses milik user untuk show yang sedang aktif.
 * Digunakan oleh MobileBottomNav agar tombol "Live" bisa langsung membawa user
 * ke `/live?t=...` jika sudah membeli, atau menolak akses jika belum.
 *
 * Sumber kebenaran:
 * - `site_settings.active_show_id` → show yang ditandai admin sebagai aktif.
 * - `streams.is_live` (active stream) → status streaming.
 * - `usePurchasedShows` → token yang sudah dimiliki user (per show / universal).
 */
export const useActiveLiveAccess = () => {
  const { redeemedTokens, membershipToken, bundleToken, customToken } = usePurchasedShows();
  const [isLive, setIsLive] = useState(false);
  const [activeShowId, setActiveShowId] = useState<string | null>(null);
  const [activeShowTitle, setActiveShowTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [settingsRes, streamRes] = await Promise.all([
          supabase.from("site_settings").select("key,value").eq("key", "active_show_id").maybeSingle(),
          supabase.from("streams").select("is_live, title").eq("is_active", true).limit(1).maybeSingle(),
        ]);
        if (cancelled) return;
        const showId = (settingsRes.data?.value as string) || null;
        setActiveShowId(showId);
        setIsLive(Boolean(streamRes.data?.is_live));

        // Resolve judul show aktif untuk pesan toast yang lebih informatif.
        // Fallback ke judul stream jika RPC tidak menemukan.
        let title: string | null = (streamRes.data as any)?.title || null;
        if (showId) {
          try {
            const { data: rows } = await (supabase as any).rpc("get_public_shows");
            const match = (rows || []).find((s: any) => s?.id === showId);
            if (match?.title) title = match.title;
          } catch {
            // Abaikan; gunakan fallback
          }
        }
        if (!cancelled) setActiveShowTitle(title);
      } catch {
        // Diam — bottom nav tetap berfungsi sebagai link biasa
      }
    };

    load();

    // Realtime: ikut update ketika admin toggle stream is_live
    const channel = supabase
      .channel("mobile-nav-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "streams" },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "site_settings", filter: "key=eq.active_show_id" },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const universalToken = membershipToken || bundleToken || customToken || null;
  const liveAccessToken = (activeShowId ? redeemedTokens[activeShowId] : null) || universalToken || null;

  return { isLive, activeShowId, activeShowTitle, liveAccessToken };
};
