import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

interface PurchasedShowsState {
  redeemedTokens: Record<string, string>;
  accessPasswords: Record<string, string>;
  replayPasswords: Record<string, string>;
  coinUser: User | null;
  coinBalance: number;
  coinUsername: string;
  loading: boolean;
  /** Active membership token code (MBR-/MRD-) if user has one */
  membershipToken: string | null;
  /** Active bundle token code (BDL-) if user has one */
  bundleToken: string | null;
}

/**
 * Loads purchased show state from BOTH the database and localStorage.
 * Database is the source of truth; localStorage is a fast cache layer.
 */
export function usePurchasedShows() {
  const [state, setState] = useState<PurchasedShowsState>({
    redeemedTokens: {},
    accessPasswords: {},
    replayPasswords: {},
    coinUser: null,
    coinBalance: 0,
    coinUsername: "",
    loading: true,
    membershipToken: null,
    bundleToken: null,
  });

  const mergeAndPersist = useCallback((
    userId: string,
    dbTokens: Record<string, string>,
    dbAccessPw: Record<string, string>,
    dbReplayPw: Record<string, string>,
  ) => {
    // Read localStorage
    let lsTokens: Record<string, string> = {};
    let lsAccessPw: Record<string, string> = {};
    let lsReplayPw: Record<string, string> = {};
    try { lsTokens = JSON.parse(localStorage.getItem(`redeemed_tokens_${userId}`) || "{}"); } catch {}
    try { lsAccessPw = JSON.parse(localStorage.getItem(`access_passwords_${userId}`) || "{}"); } catch {}
    try { lsReplayPw = JSON.parse(localStorage.getItem(`replay_passwords_${userId}`) || "{}"); } catch {}

    // Merge: DB overrides localStorage
    const mergedTokens = { ...lsTokens, ...dbTokens };
    const mergedAccessPw = { ...lsAccessPw, ...dbAccessPw };
    const mergedReplayPw = { ...lsReplayPw, ...dbReplayPw };

    // Persist merged data back to localStorage
    localStorage.setItem(`redeemed_tokens_${userId}`, JSON.stringify(mergedTokens));
    localStorage.setItem(`access_passwords_${userId}`, JSON.stringify(mergedAccessPw));
    localStorage.setItem(`replay_passwords_${userId}`, JSON.stringify(mergedReplayPw));

    return { mergedTokens, mergedAccessPw, mergedReplayPw };
  }, []);

  const loadFromDB = useCallback(async (user: User) => {
    // Fetch user's active tokens with show_id from database
    const [tokensRes, passwordsRes, balRes, profileRes] = await Promise.allSettled([
      supabase
        .from("tokens")
        .select("code, show_id, status, expires_at")
        .eq("user_id", user.id)
        .eq("status", "active"),
      supabase.rpc("get_purchased_show_passwords"),
      supabase.from("coin_balances").select("balance").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
    ]);

    // Build token map from DB: show_id -> token_code, and detect membership/bundle tokens
    const dbTokens: Record<string, string> = {};
    const dbAccessPw: Record<string, string> = {};
    let membershipToken: string | null = null;
    let bundleToken: string | null = null;
    if (tokensRes.status === "fulfilled" && tokensRes.value.data) {
      for (const t of tokensRes.value.data) {
        if (t.code) {
          const code = String(t.code).toUpperCase();
          // Detect membership tokens
          if ((code.startsWith("MBR-") || code.startsWith("MRD-")) && (!t.expires_at || new Date(t.expires_at) > new Date())) {
            membershipToken = t.code;
          }
          // Detect bundle tokens
          if (code.startsWith("BDL-") && (!t.expires_at || new Date(t.expires_at) > new Date())) {
            bundleToken = t.code;
          }
        }
        if (t.show_id && t.code) {
          // Only include non-expired tokens
          if (!t.expires_at || new Date(t.expires_at) > new Date()) {
            dbTokens[t.show_id] = t.code;
          }
        }
      }
    }

    // Build access password map from DB
    if (passwordsRes.status === "fulfilled" && passwordsRes.value.data) {
      const pwData = passwordsRes.value.data as Record<string, string>;
      Object.assign(dbAccessPw, pwData);
    }

    // Replay passwords come from coin_transactions with type 'replay_redeem'
    // The get_purchased_show_passwords RPC already includes both redeem and replay_redeem
    const dbReplayPw: Record<string, string> = { ...dbAccessPw };

    const { mergedTokens, mergedAccessPw, mergedReplayPw } = mergeAndPersist(
      user.id, dbTokens, dbAccessPw, dbReplayPw
    );

    const balance = balRes.status === "fulfilled" ? (balRes.value.data?.balance || 0) : 0;
    const username = profileRes.status === "fulfilled"
      ? (profileRes.value.data?.username || user.user_metadata?.username || "")
      : "";

    setState({
      redeemedTokens: mergedTokens,
      accessPasswords: mergedAccessPw,
      replayPasswords: mergedReplayPw,
      coinUser: user,
      coinBalance: balance,
      coinUsername: username,
      loading: false,
      membershipToken,
      bundleToken,
    });
  }, [mergeAndPersist]);

  // Update functions for after-purchase state changes
  const addRedeemedToken = useCallback((showId: string, tokenCode: string) => {
    setState(prev => {
      const updated = { ...prev.redeemedTokens, [showId]: tokenCode };
      if (prev.coinUser) {
        localStorage.setItem(`redeemed_tokens_${prev.coinUser.id}`, JSON.stringify(updated));
      }
      return { ...prev, redeemedTokens: updated };
    });
  }, []);

  const addAccessPassword = useCallback((showId: string, password: string) => {
    setState(prev => {
      const updated = { ...prev.accessPasswords, [showId]: password };
      if (prev.coinUser) {
        localStorage.setItem(`access_passwords_${prev.coinUser.id}`, JSON.stringify(updated));
      }
      return { ...prev, accessPasswords: updated };
    });
  }, []);

  const addReplayPassword = useCallback((showId: string, password: string) => {
    setState(prev => {
      const updated = { ...prev.replayPasswords, [showId]: password };
      if (prev.coinUser) {
        localStorage.setItem(`replay_passwords_${prev.coinUser.id}`, JSON.stringify(updated));
      }
      return { ...prev, replayPasswords: updated };
    });
  }, []);

  const setCoinBalance = useCallback((balance: number) => {
    setState(prev => ({ ...prev, coinBalance: balance }));
  }, []);

  useEffect(() => {
    let balChannel: any;

    const init = async () => {
      const { data: { session } } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<{ data: { session: null } }>((r) => setTimeout(() => r({ data: { session: null } }), 5000)),
      ]).catch(() => ({ data: { session: null } }));

      const user = session?.user;
      if (!user) {
        setState(prev => ({ ...prev, loading: false }));
        return;
      }

      await loadFromDB(user);

      // Listen for balance changes
      balChannel = supabase
        .channel(`purchase-bal-${user.id}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "coin_balances",
          filter: `user_id=eq.${user.id}`,
        }, (payload: any) => {
          if (payload.new?.balance !== undefined) {
            setCoinBalance(payload.new.balance);
          }
        })
        .subscribe();
    };

    init();

    return () => {
      if (balChannel) supabase.removeChannel(balChannel);
    };
  }, [loadFromDB, setCoinBalance]);

  return {
    ...state,
    addRedeemedToken,
    addAccessPassword,
    addReplayPassword,
    setCoinBalance,
    reload: async () => {
      if (state.coinUser) await loadFromDB(state.coinUser);
    },
  };
}
