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
  /** Active custom token code (RT48-) if user has one */
  customToken: string | null;
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
    customToken: null,
  });

  const mergeAndPersist = useCallback((
    userId: string,
    dbTokens: Record<string, string>,
    dbAccessPw: Record<string, string>,
    dbReplayPw: Record<string, string>,
  ) => {
    // DB is the SINGLE SOURCE OF TRUTH for access passwords.
    // We must NOT merge stale localStorage values, otherwise a show that the admin
    // later marks as "Eksklusif" would still be openable by membership users whose
    // browser cached the old password.
    // localStorage is only refreshed FROM the DB, never read back into state.
    localStorage.setItem(`redeemed_tokens_${userId}`, JSON.stringify(dbTokens));
    localStorage.setItem(`access_passwords_${userId}`, JSON.stringify(dbAccessPw));
    localStorage.setItem(`replay_passwords_${userId}`, JSON.stringify(dbReplayPw));

    return {
      mergedTokens: dbTokens,
      mergedAccessPw: dbAccessPw,
      mergedReplayPw: dbReplayPw,
    };
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
    let customToken: string | null = null;
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
          // Detect custom tokens (created via bot command)
          if (code.startsWith("RT48-") && (!t.expires_at || new Date(t.expires_at) > new Date())) {
            customToken = t.code;
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

    // If user has membership/bundle/custom, fetch ALL show passwords
    if (membershipToken || bundleToken || customToken) {
      try {
        const { data: allPw } = await (supabase.rpc as any)("get_membership_show_passwords");
        if (allPw && typeof allPw === "object") {
          Object.assign(dbAccessPw, allPw as Record<string, string>);
        }
      } catch {}
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
      customToken,
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
    let cancelled = false;
    let balChannel: any;
    const channelId = `purchase-bal-${Math.random().toString(36).slice(2, 10)}`;

    const init = async () => {
      const { data: { session } } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<{ data: { session: null } }>((r) => setTimeout(() => r({ data: { session: null } }), 5000)),
      ]).catch(() => ({ data: { session: null } }));

      const user = session?.user;
      if (!user) {
        if (!cancelled) setState(prev => ({ ...prev, loading: false }));
        return;
      }

      await loadFromDB(user);
      if (cancelled) return;

      // Build channel before subscribing — once subscribed, .on() cannot be added.
      const ch = supabase.channel(channelId);
      ch.on("postgres_changes", {
        event: "*", schema: "public", table: "coin_balances",
        filter: `user_id=eq.${user.id}`,
      }, (payload: any) => {
        if (payload.new?.balance !== undefined) {
          setCoinBalance(payload.new.balance);
        }
      });
      if (cancelled) return;
      ch.subscribe();
      balChannel = ch;
    };

    init();

    return () => {
      cancelled = true;
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
