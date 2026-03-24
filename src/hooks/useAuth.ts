import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

// In-memory session cache to avoid redundant getSession() calls
let cachedUser: User | null = null;
let cachedIsAdmin: boolean = false;
let cacheReady = false;

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(cachedUser);
  const [isAdmin, setIsAdmin] = useState(cachedIsAdmin);
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
          // Avoid duplicate admin checks for same user
          if (adminCheckRef.current !== currentUser.id) {
            adminCheckRef.current = currentUser.id;
            const { data } = await supabase.rpc("has_role", {
              _user_id: currentUser.id,
              _role: "admin",
            });
            cachedIsAdmin = !!data;
            setIsAdmin(cachedIsAdmin);
          }
        } else {
          adminCheckRef.current = null;
          cachedIsAdmin = false;
          setIsAdmin(false);
        }
        cacheReady = true;
        setLoading(false);
      }
    );

    // Only call getSession if cache is empty
    if (!cacheReady) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        const currentUser = session?.user ?? null;
        cachedUser = currentUser;
        setUser(currentUser);
        if (currentUser && adminCheckRef.current !== currentUser.id) {
          adminCheckRef.current = currentUser.id;
          supabase.rpc("has_role", { _user_id: currentUser.id, _role: "admin" })
            .then(({ data }) => {
              cachedIsAdmin = !!data;
              setIsAdmin(cachedIsAdmin);
            });
        }
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
    cacheReady = false;
    adminCheckRef.current = null;
    setUser(null);
    setIsAdmin(false);
  };

  return { user, isAdmin, loading, signOut };
};
