import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook global: melacak apakah admin sedang menjeda akses membership.
 * Saat true, hooks/komponen yang memakai ini sebaiknya menonaktifkan
 * `membershipToken` dari `universalToken` agar kartu show kembali ke mode beli.
 */
export const useMembershipPaused = () => {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "membership_paused")
        .maybeSingle();
      if (mounted) setPaused(data?.value === "true");
    })();

    const broadcastCh = supabase
      .channel("membership-control-viewer")
      .on("broadcast", { event: "membership_paused" }, () => setPaused(true))
      .on("broadcast", { event: "membership_resumed" }, () => setPaused(false))
      .subscribe();

    const dbCh = supabase
      .channel("membership-pause-viewer-db")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_settings", filter: "key=eq.membership_paused" },
        (payload: any) => {
          const v = payload.new?.value ?? "false";
          setPaused(v === "true");
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(broadcastCh);
      supabase.removeChannel(dbCh);
    };
  }, []);

  return paused;
};
