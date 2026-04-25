import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook ringan untuk membaca avatar & username pengguna yang sedang login.
 * Mendengarkan event `profile:updated` agar UI tetap sinkron tanpa refresh
 * saat profil diubah dari halaman Profil.
 */
export const useProfileAvatar = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsLoggedIn(false);
        setAvatarUrl(null);
        setUsername(null);
        return;
      }
      setIsLoggedIn(true);
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url, username")
        .eq("id", user.id)
        .maybeSingle();
      setAvatarUrl(data?.avatar_url ?? null);
      setUsername(data?.username ?? null);
    } catch {
      // diam — biarkan default state
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    const onUpdated = () => fetchProfile();
    window.addEventListener("profile:updated", onUpdated);

    const { data: sub } = supabase.auth.onAuthStateChange(() => fetchProfile());

    return () => {
      window.removeEventListener("profile:updated", onUpdated);
      sub?.subscription?.unsubscribe();
    };
  }, [fetchProfile]);

  return { isLoggedIn, avatarUrl, username, refresh: fetchProfile };
};

export const broadcastProfileUpdated = () => {
  try { window.dispatchEvent(new CustomEvent("profile:updated")); } catch {}
};
