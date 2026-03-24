import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { checkBanStatus } from "@/lib/suspiciousActivity";
import type { User } from "@supabase/supabase-js";

// In-memory session cache to avoid redundant getSession() calls
let cachedUser: User | null = null;
let cachedIsAdmin: boolean = false;
let cachedIsBanned: boolean = false;
let cachedBanReason: string = "";
let cacheReady = false;

async function checkAdminSafe(userId: string): Promise<boolean> {
  try {
    // Race against a 6s timeout to prevent hanging
    const result = await Promise.race([
      Promise.resolve(supabase.rpc("has_role", { _user_id: userId, _role: "admin" })),
      new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: "Admin check timeout" } }), 6000)
      ),
    ]);
    return !!result.data;
  } catch {
    return cachedIsAdmin; // preserve last known state on error
  }
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(cachedUser);
  const [isAdmin, setIsAdmin] = useState(cachedIsAdmin);
  const [isBanned, setIsBanned] = useState(cachedIsBanned);
  const [banReason, setBanReason] = useState(cachedBanReason);
  const [loading, setLoading] = useState(!cacheReady);
  const adminCheckRef = useRef<string | null>(null);

  useEffect(() => {
    // Set up listener FIRST (per Supabase best practice)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const currentUser = session?.user ?? null;
        cachedUser = currentUser;
        setUser(currentUser);

        if (currentUser) {
          if (adminCheckRef.current !== currentUser.id) {
            adminCheckRef.current = currentUser.id;
            const [isAdm, banStatus] = await Promise.all([
              checkAdminSafe(currentUser.id),
              checkBanStatus(currentUser.id),
            ]);
            cachedIsAdmin = isAdm;
            setIsAdmin(isAdm);
            cachedIsBanned = banStatus.banned;
            cachedBanReason = banStatus.reason || "";
            setIsBanned(banStatus.banned);
            setBanReason(banStatus.reason || "");
          }
        } else {
          adminCheckRef.current = null;
          cachedIsAdmin = false;
          cachedIsBanned = false;
          cachedBanReason = "";
          setIsAdmin(false);
          setIsBanned(false);
          setBanReason("");
        }
        cacheReady = true;
        setLoading(false);
      }
    );

    // Only call getSession if cache is empty — with timeout
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
          const [isAdm, banStatus] = await Promise.all([
            checkAdminSafe(currentUser.id),
            checkBanStatus(currentUser.id),
          ]);
          cachedIsAdmin = isAdm;
          setIsAdmin(isAdm);
          cachedIsBanned = banStatus.banned;
          cachedBanReason = banStatus.reason || "";
          setIsBanned(banStatus.banned);
          setBanReason(banStatus.reason || "");
        }
        cacheReady = true;
        setLoading(false);
      }).catch(() => {
        // If getSession fails entirely, still mark as ready so UI isn't stuck
        cacheReady = true;
        setLoading(false);
      });
    }

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    cachedUser = null;
    cachedIsAdmin = false;
    cachedIsBanned = false;
    cachedBanReason = "";
    cacheReady = false;
    adminCheckRef.current = null;
    setUser(null);
    setIsAdmin(false);
    setIsBanned(false);
    setBanReason("");
  };

  return { user, isAdmin, isBanned, banReason, loading, signOut };
};
