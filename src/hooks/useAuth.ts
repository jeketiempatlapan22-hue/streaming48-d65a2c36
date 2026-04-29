import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

let cachedUser: User | null = null;
let cachedIsAdmin: boolean = false;
let cacheReady = false;

async function checkBanSafe(userId: string): Promise<{ banned: boolean; reason: string }> {
  try {
    const result = await Promise.race([
      (supabase.rpc as any)('get_ban_info', { _user_id: userId }),
      new Promise<{ data: null }>((resolve) => setTimeout(() => resolve({ data: null }), 3000)),
    ]);
    const info = result?.data as any;
    if (info?.banned) return { banned: true, reason: info.reason || '' };
    return { banned: false, reason: '' };
  } catch {
    return { banned: false, reason: '' };
  }
}

async function checkAdminSafe(userId: string): Promise<boolean> {
  try {
    const result = await Promise.race([
      Promise.resolve(supabase.rpc("has_role", { _user_id: userId, _role: "admin" })),
      new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: "Admin check timeout" } }), 6000)
      ),
    ]);
    return !!result.data;
  } catch {
    return cachedIsAdmin;
  }
}

/** Aggressively clear all auth-related localStorage entries to prevent stale-token relogin failures */
function clearStaleAuth() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.includes('supabase.auth') || k.startsWith('sb-') || k.includes('-auth-token'))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch {}
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(cachedUser);
  const [isAdmin, setIsAdmin] = useState(cachedIsAdmin);
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [loading, setLoading] = useState(!cacheReady);
  const adminCheckRef = useRef<string | null>(null);

  useEffect(() => {
    let banChannel: any = null;

    const setupBanListener = (userId: string) => {
      if (banChannel) supabase.removeChannel(banChannel);
      banChannel = supabase.channel(`user-ban-${userId}`).on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_bans", filter: `user_id=eq.${userId}` },
        (payload: any) => {
          const row = payload.new as any;
          if (row?.is_active) {
            setIsBanned(true);
            setBanReason(row.reason || "Akun Anda telah diblokir");
          } else {
            setIsBanned(false);
            setBanReason("");
          }
        }
      ).subscribe();
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Only clear local auth storage on EXPLICIT sign-out.
        // Do NOT clear on TOKEN_REFRESHED failures or transient network issues —
        // Supabase will retry refresh, and wiping tokens here would log the user out permanently.
        if (event === 'SIGNED_OUT') {
          clearStaleAuth();
        }

        const currentUser = session?.user ?? null;
        cachedUser = currentUser;
        setUser(currentUser);

        if (currentUser) {
          if (adminCheckRef.current !== currentUser.id) {
            adminCheckRef.current = currentUser.id;
            const isAdm = await checkAdminSafe(currentUser.id);
            cachedIsAdmin = isAdm;
            setIsAdmin(isAdm);
            checkBanSafe(currentUser.id).then((b) => {
              setIsBanned(b.banned);
              setBanReason(b.reason);
            });
            setupBanListener(currentUser.id);
          }
        } else {
          adminCheckRef.current = null;
          cachedIsAdmin = false;
          setIsAdmin(false);
          setIsBanned(false);
          setBanReason("");
          if (banChannel) { supabase.removeChannel(banChannel); banChannel = null; }
        }
        cacheReady = true;
        setLoading(false);
      }
    );

    if (!cacheReady) {
      Promise.race([
        supabase.auth.getSession(),
        new Promise<{ data: { session: null } }>((resolve) =>
          setTimeout(() => resolve({ data: { session: null } }), 8000)
        ),
      ]).then(async ({ data: { session } }) => {
        const currentUser = session?.user ?? null;
        cachedUser = currentUser;
        setUser(currentUser);
        if (currentUser && adminCheckRef.current !== currentUser.id) {
          adminCheckRef.current = currentUser.id;
          const isAdm = await checkAdminSafe(currentUser.id);
          cachedIsAdmin = isAdm;
          setIsAdmin(isAdm);
          checkBanSafe(currentUser.id).then((b) => {
            setIsBanned(b.banned);
            setBanReason(b.reason);
          });
          setupBanListener(currentUser.id);
        }
        cacheReady = true;
        setLoading(false);
      }).catch(() => {
        // If getSession itself fails (e.g., bad refresh token), clear it
        clearStaleAuth();
        cacheReady = true;
        setLoading(false);
      });
    }

    return () => {
      subscription.unsubscribe();
      if (banChannel) supabase.removeChannel(banChannel);
    };
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}
    clearStaleAuth();
    cachedUser = null;
    cachedIsAdmin = false;
    cacheReady = false;
    adminCheckRef.current = null;
    setUser(null);
    setIsAdmin(false);
    setIsBanned(false);
    setBanReason("");
  };

  return { user, isAdmin, isBanned, banReason, loading, signOut };
};
