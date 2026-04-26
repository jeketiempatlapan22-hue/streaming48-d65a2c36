import { useState, useEffect, lazy, Suspense } from "react";
import MobileBottomNav from "@/components/viewer/MobileBottomNav";
import { useActiveLiveAccess } from "@/hooks/useActiveLiveAccess";
import ProfileAvatarEditor from "@/components/viewer/ProfileAvatarEditor";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withTimeout } from "@/lib/queryCache";
import { ArrowLeft, Coins, Save, User, History, BarChart3, Shield, Ticket, Key, Copy, LogOut, Phone, Pencil, Award, Crown, Receipt, PlayCircle, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import BannedScreen from "@/components/viewer/BannedScreen";
import { useProtectedAuth } from "@/hooks/useProtectedAuth";
import { ProfileSkeleton } from "@/components/viewer/SkeletonLoaders";

const ReferralSection = lazy(() => import("@/components/viewer/ReferralSection"));
const UserStatsPanel = lazy(() => import("@/components/viewer/UserStatsPanel"));
const UserBadges = lazy(() => import("@/components/viewer/UserBadges"));
const UserTransactionHistory = lazy(() => import("@/components/viewer/UserTransactionHistory"));

const ViewerProfile = () => {
  const { user: authUser, isBanned, banReason, loading: authLoading, signOut: authSignOut } = useProtectedAuth();
  const { isLive: liveActive, liveAccessToken, activeShowId, activeShowTitle } = useActiveLiveAccess();
  const [username, setUsername] = useState("");
  const [originalUsername, setOriginalUsername] = useState("");
  const [balance, setBalance] = useState(0);
  const [orders, setOrders] = useState<any[]>([]);
  const [subOrders, setSubOrders] = useState<any[]>([]);
  const [tokens, setTokens] = useState<any[]>([]);
  const [showTitles, setShowTitles] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"history" | "orders" | "subscriptions" | "tokens" | "membership" | "stats">("history");
  const [editingPhone, setEditingPhone] = useState<Record<string, string>>({});
  const [savingPhone, setSavingPhone] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) { navigate("/auth"); return; }

    const loadData = async () => {
      try {
        const u = authUser;
        const [profileRes, balRes, ordersRes, subRes, tokensRes] = await Promise.allSettled([
          withTimeout((async () => await supabase.from("profiles").select("username").eq("id", u.id).maybeSingle())(), 8_000, "Profile timeout"),
          withTimeout((async () => await supabase.from("coin_balances").select("balance").eq("user_id", u.id).maybeSingle())(), 8_000, "Balance timeout"),
          withTimeout((async () => await supabase.from("coin_orders").select("*").eq("user_id", u.id).order("created_at", { ascending: false }).limit(30))(), 8_000, "Orders timeout"),
          withTimeout((async () => await supabase.from("subscription_orders").select("*, shows(title)").eq("user_id", u.id).order("created_at", { ascending: false }).limit(30))(), 8_000, "Subscriptions timeout"),
          withTimeout((async () => await supabase.from("tokens").select("*").eq("user_id", u.id).order("created_at", { ascending: false }).limit(30))(), 8_000, "Tokens timeout"),
        ]);

        const name =
          (profileRes.status === "fulfilled" ? profileRes.value.data?.username : "") ||
          u.user_metadata?.username ||
          "";

        setUsername(name);
        setOriginalUsername(name);
        setBalance(balRes.status === "fulfilled" ? (balRes.value.data?.balance || 0) : 0);
        setOrders(ordersRes.status === "fulfilled" ? (ordersRes.value.data || []) : []);
        setSubOrders(subRes.status === "fulfilled" ? (subRes.value.data || []) : []);
        const tokenRows = tokensRes.status === "fulfilled" ? (tokensRes.value.data || []) : [];
        setTokens(tokenRows);

        // Resolve show titles for tokens (RLS on shows is admin-only, so use the
        // public RPC if available; fall back gracefully if any title cannot be
        // resolved — token row remains usable without a title).
        const showIds = Array.from(
          new Set((tokenRows as any[]).map((t) => t.show_id).filter(Boolean))
        ) as string[];
        if (showIds.length > 0) {
          try {
            const { data: rows } = await (supabase as any).rpc("get_public_shows");
            const map: Record<string, string> = {};
            (rows || []).forEach((s: any) => {
              if (s?.id && showIds.includes(s.id)) map[s.id] = s.title;
            });
            setShowTitles(map);
          } catch {
            setShowTitles({});
          }
        }
      } catch {
        toast.error("Gagal memuat data profil, coba muat ulang halaman.");
      } finally {
        setLoading(false);
      }
    };
    loadData();

    // Realtime: when admin deletes a token belonging to this user, drop it from
    // the profile UI immediately so the user can't see/use stale links.
    const ch = supabase
      .channel(`profile-tokens-${authUser.id}`)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "tokens" },
        (payload: any) => {
          const oldId = payload.old?.id;
          if (!oldId) return;
          setTokens((prev) => prev.filter((t) => t.id !== oldId));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tokens", filter: `user_id=eq.${authUser.id}` },
        (payload: any) => {
          const updated = payload.new;
          if (!updated?.id) return;
          setTokens((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [authUser, authLoading, navigate]);

  const handleSave = async () => {
    if (!authUser || !username.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({ id: authUser.id, username: username.trim() }, { onConflict: "id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else { setOriginalUsername(username.trim()); toast.success("Username diperbarui!"); }
  };

  const copyText = (text: string) => { navigator.clipboard.writeText(text); toast.success("Disalin!"); };

  const saveOrderPhone = async (orderId: string) => {
    const newPhone = editingPhone[orderId]?.trim();
    if (!newPhone) return;
    setSavingPhone(orderId);
    const { error } = await (supabase as any).from("subscription_orders").update({ phone: newPhone }).eq("id", orderId);
    setSavingPhone(null);
    if (error) { toast.error("Gagal menyimpan nomor HP"); return; }
    setSubOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, phone: newPhone } : o));
    setEditingPhone((prev) => { const n = { ...prev }; delete n[orderId]; return n; });
    toast.success("Nomor HP berhasil diperbarui!");
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      confirmed: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
      pending: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
      active: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
      blocked: "bg-destructive/10 text-destructive",
      expired: "bg-muted text-muted-foreground",
    };
    const label: Record<string, string> = { confirmed: "Dikonfirmasi", pending: "Menunggu", active: "Aktif", blocked: "Diblokir", expired: "Kedaluwarsa" };
    return <span className={`text-xs font-bold px-2 py-0.5 rounded ${map[status] || "bg-muted text-muted-foreground"}`}>{label[status] || status}</span>;
  };

  if (loading) return (
    <>
      <ProfileSkeleton />
      <MobileBottomNav loading />
    </>
  );
  if (isBanned) return <BannedScreen reason={banReason} onSignOut={authSignOut} />;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3"><button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground active:scale-[0.95]"><ArrowLeft className="h-5 w-5" /></button><span className="text-sm font-bold text-foreground">Profil Saya</span></div>
          <div className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5"><Coins className="h-4 w-4 text-[hsl(var(--warning))]" /><span className="text-sm font-bold text-[hsl(var(--warning))]">{balance}</span></div>
        </div>
      </header>
      <div className="mx-auto max-w-lg px-4 py-6 space-y-5">
        {/* Profile Card */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl glass p-6">
          <div className="mb-5 flex flex-col items-center gap-3">
            <ProfileAvatarEditor username={username} />
            <p className="text-xs text-muted-foreground">{authUser?.email || ""}</p>
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">Username</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Masukkan username" className="bg-background" maxLength={30} />
            <Button className="w-full gap-2" disabled={username.trim() === originalUsername || saving || !username.trim()} onClick={handleSave}><Save className="h-4 w-4" /> {saving ? "Menyimpan..." : "Simpan Username"}</Button>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-lg font-bold text-[hsl(var(--warning))]">{balance}</p><p className="text-[10px] text-muted-foreground">Saldo Koin</p></div>
          <div className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-lg font-bold text-primary">{orders.length}</p><p className="text-[10px] text-muted-foreground">Order Koin</p></div>
          <div className="rounded-xl border border-border bg-card p-3 text-center"><p className="text-lg font-bold text-[hsl(var(--success))]">{tokens.filter(t => t.status === "active").length}</p><p className="text-[10px] text-muted-foreground">Token Aktif</p></div>
        </motion.div>

        {/* Token Live Aktif — quick-access list of all live tokens with show name */}
        {(() => {
          const liveTokens = tokens.filter((t: any) => {
            if (t.status !== "active") return false;
            if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now()) return false;
            return true;
          });
          if (liveTokens.length === 0) return null;
          return (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-accent/5 p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <PlayCircle className="h-4 w-4 text-primary" />
                <h3 className="text-xs font-bold text-foreground">Akses Live Aktif ({liveTokens.length})</h3>
              </div>
              <p className="text-[10px] text-muted-foreground -mt-1">
                Token yang Anda miliki — klik <span className="text-primary font-semibold">Tonton Live</span> untuk masuk ke ruang siaran.
              </p>
              <div className="space-y-2">
                {liveTokens.map((t: any) => {
                  const liveLink = `${window.location.origin}/live?t=${encodeURIComponent(t.code)}`;
                  const showTitle = (t.show_id && showTitles[t.show_id]) || "Show";
                  return (
                    <div key={`live-${t.id}`} className="rounded-lg bg-background/60 border border-border/50 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-foreground truncate">{showTitle}</p>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">{t.code}</p>
                        </div>
                        <span className="shrink-0 rounded bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] text-[10px] font-bold px-2 py-0.5">
                          Aktif
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          className="flex-1 h-8 gap-1.5 text-xs"
                          onClick={() => navigate(`/live?t=${encodeURIComponent(t.code)}`)}
                        >
                          <PlayCircle className="h-3.5 w-3.5" /> Tonton Live
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2"
                          onClick={() => copyText(liveLink)}
                          title="Salin link"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })()}

        {/* Membership/Bundle Duration Card */}
        {(() => {
          const membershipTokens = tokens.filter((t: any) => {
            if (t.status !== "active" || !t.expires_at) return false;
            const code = (t.code || "").toUpperCase();
            return code.startsWith("MBR-") || code.startsWith("MRD-") || code.startsWith("BDL-") || code.startsWith("RT48-");
          });
          if (membershipTokens.length === 0) return null;
          return (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 }} className="space-y-2">
              {membershipTokens.map((t: any) => {
                const code = (t.code || "").toUpperCase();
                const isMembership = code.startsWith("MBR-") || code.startsWith("MRD-");
                const isBundle = code.startsWith("BDL-");
                const isCustom = code.startsWith("RT48-");
                const expiresAt = new Date(t.expires_at);
                const now = new Date();
                const diffMs = expiresAt.getTime() - now.getTime();
                const isExpired = diffMs <= 0;
                const daysLeft = Math.ceil(diffMs / 86400000);
                const hoursLeft = Math.ceil(diffMs / 3600000);

                const label = isMembership ? "👑 Membership" : isBundle ? "📦 Bundle" : "🎫 Token Custom";
                const iconColor = isExpired ? "text-muted-foreground" : isMembership ? "text-yellow-500" : isCustom ? "text-cyan-400" : "text-primary";
                const borderClass = isExpired ? "border-border bg-muted/30" : isMembership ? "border-yellow-500/30 bg-gradient-to-r from-yellow-500/10 to-primary/5" : isCustom ? "border-cyan-400/30 bg-gradient-to-r from-cyan-400/10 to-primary/5" : "border-primary/30 bg-gradient-to-r from-primary/10 to-accent/5";

                const liveUrl = `/live?t=${encodeURIComponent(t.code)}`;
                return (
                  <div
                    key={t.id}
                    role={!isExpired ? "button" : undefined}
                    tabIndex={!isExpired ? 0 : undefined}
                    onClick={() => { if (!isExpired) navigate(liveUrl); }}
                    onKeyDown={(e) => { if (!isExpired && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); navigate(liveUrl); } }}
                    className={`rounded-xl border p-4 ${borderClass} ${!isExpired ? "cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-transform" : "opacity-70"}`}
                    title={!isExpired ? "Klik untuk masuk ke halaman live" : undefined}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Crown className={`h-4 w-4 ${iconColor}`} />
                        <span className="text-xs font-bold text-foreground">{label}</span>
                      </div>
                      {isExpired ? (
                        <span className="text-[10px] font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded">Kedaluwarsa</span>
                      ) : (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${daysLeft <= 3 ? "text-destructive bg-destructive/10" : "text-[hsl(var(--success))] bg-[hsl(var(--success))]/10"}`}>
                          {daysLeft > 0 ? `${daysLeft} hari lagi` : `${hoursLeft} jam lagi`}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">Token: <span className="font-mono">{t.code}</span></p>
                    <p className="text-[10px] text-muted-foreground">Berakhir: {expiresAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</p>
                    {!isExpired && daysLeft <= 3 && (
                      <p className="text-[10px] text-destructive mt-1">⚠️ Segera berakhir!</p>
                    )}
                    {!isExpired && (
                      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] font-bold text-primary">
                        <PlayCircle className="h-3.5 w-3.5" />
                        <span>Masuk Live</span>
                        <ExternalLink className="h-3 w-3" />
                      </div>
                    )}
                  </div>
                );
              })}
            </motion.div>
          );
        })()}

        {/* Badges */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="rounded-xl glass p-4">
          <Suspense fallback={<div className="h-24 skeleton rounded-xl" />}>
            {authUser && <UserBadges user={authUser} />}
          </Suspense>
        </motion.div>

        {/* Buy Coins CTA */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="flex items-center justify-between rounded-xl glass p-4">
            <div><p className="text-xs text-muted-foreground">Saldo Koin</p><div className="flex items-center gap-2 mt-1"><Coins className="h-5 w-5 text-[hsl(var(--warning))]" /><span className="text-2xl font-bold text-[hsl(var(--warning))]">{balance}</span></div></div>
            <Button size="sm" variant="outline" onClick={() => navigate("/coins")}><Coins className="mr-1.5 h-3.5 w-3.5" /> Beli Koin</Button>
          </div>
        </motion.div>

        {/* Tabs */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <div className="flex rounded-lg glass p-1 gap-0.5 overflow-x-auto">
            {([["history", "Riwayat", Receipt], ["orders", "Order", History], ["subscriptions", "Langganan", Ticket], ["tokens", "Token", Key], ["membership", "Membership", Crown], ["stats", "Statistik", BarChart3]] as const).map(([key, label, Icon]) => (
              <button key={key} onClick={() => setTab(key as any)} className={`flex-1 min-w-[60px] flex items-center justify-center gap-1 rounded-md py-2 text-[10px] font-medium transition-all active:scale-[0.97] ${tab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon className="h-3 w-3" />{label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Tab Content */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-xl glass p-4">
          {tab === "history" && authUser && (
            <Suspense fallback={<div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 skeleton rounded-lg" />)}</div>}>
              <UserTransactionHistory userId={authUser.id} />
            </Suspense>
          )}
          {tab === "orders" && (
            orders.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">Belum ada order koin</p> : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-lg bg-background/50 p-3">
                    <div className="min-w-0 flex-1"><p className="text-xs font-medium text-foreground">{o.coin_amount} Koin {o.price ? `• ${o.price}` : ""}</p><p className="text-[10px] text-muted-foreground">{new Date(o.created_at).toLocaleString("id-ID")}</p></div>
                    {statusBadge(o.status)}
                  </div>
                ))}
              </div>
            )
          )}
          {tab === "subscriptions" && (
            subOrders.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">Belum ada langganan</p> : (
              <div className="space-y-2">
                {subOrders.map((o) => (
                  <div key={o.id} className="rounded-lg bg-background/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground">{(o as any).shows?.title || "Show"}</p>
                        <p className="text-[10px] text-muted-foreground">{o.payment_method} • {new Date(o.created_at).toLocaleString("id-ID")}</p>
                      </div>
                      {statusBadge(o.status)}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                      {editingPhone[o.id] !== undefined ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            value={editingPhone[o.id]}
                            onChange={(e) => setEditingPhone((prev) => ({ ...prev, [o.id]: e.target.value }))}
                            placeholder="08xxxxxxxxxx"
                            className="h-7 text-xs flex-1"
                          />
                          <Button size="sm" variant="outline" className="h-7 px-2" disabled={savingPhone === o.id} onClick={() => saveOrderPhone(o.id)}>
                            <Save className="h-3 w-3" />
                          </Button>
                          <button className="text-[10px] text-muted-foreground hover:text-foreground px-1" onClick={() => setEditingPhone((prev) => { const n = { ...prev }; delete n[o.id]; return n; })}>Batal</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingPhone((prev) => ({ ...prev, [o.id]: o.phone || "" }))}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {o.phone || <span className="italic text-muted-foreground/60">Belum ada HP</span>}
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                    {o.status === "pending" && !o.phone && (
                      <p className="text-[10px] text-[hsl(var(--warning))]">⚠️ Tambahkan nomor HP agar admin bisa mengirim link akses!</p>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
          {tab === "tokens" && (
            tokens.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">Belum ada token</p> : (
              <div className="space-y-2">
                {tokens.map((t) => {
                  const liveLink = `${window.location.origin}/live?t=${encodeURIComponent(t.code)}`;
                  const showTitle = (t.show_id && showTitles[t.show_id]) || null;
                  const isLiveActive = t.status === "active" && (!t.expires_at || new Date(t.expires_at).getTime() > Date.now());
                  return (
                    <div key={t.id} className="rounded-lg bg-background/50 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {showTitle && (
                            <p className="text-xs font-bold text-foreground truncate">{showTitle}</p>
                          )}
                          <div className="flex items-center gap-2">
                            <p className="text-[11px] font-mono font-medium text-muted-foreground truncate">{t.code}</p>
                            <button onClick={() => copyText(t.code)} className="text-muted-foreground hover:text-primary active:scale-[0.95] shrink-0"><Copy className="h-3 w-3" /></button>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {t.expires_at ? `Exp: ${new Date(t.expires_at).toLocaleString("id-ID")}` : "Tanpa batas"}
                          </p>
                        </div>
                        {statusBadge(t.status)}
                      </div>
                      {isLiveActive && (
                        <>
                          <div className="flex items-center gap-1.5 rounded-md bg-primary/5 border border-primary/20 px-2.5 py-1.5">
                            <Key className="h-3 w-3 text-primary shrink-0" />
                            <p className="text-[10px] text-primary font-medium truncate flex-1">{liveLink}</p>
                            <button onClick={() => copyText(liveLink)} className="text-primary hover:text-primary/80 active:scale-[0.95] shrink-0"><Copy className="h-3 w-3" /></button>
                          </div>
                          <Button
                            size="sm"
                            className="w-full h-8 gap-1.5 text-xs"
                            onClick={() => navigate(`/live?t=${encodeURIComponent(t.code)}`)}
                          >
                            <PlayCircle className="h-3.5 w-3.5" /> Tonton Live
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}
          {tab === "stats" && (
            <Suspense fallback={<div className="h-40 skeleton rounded-xl" />}>
              {authUser && <UserStatsPanel user={authUser} />}
            </Suspense>
          )}
        </motion.div>

        {/* Referral */}
        <Suspense fallback={null}>
          <ReferralSection />
        </Suspense>

        {/* Logout */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <Button
            variant="destructive"
            className="w-full gap-2"
            onClick={async () => {
              await authSignOut();
              navigate("/");
            }}
          >
            <LogOut className="h-4 w-4" /> Keluar dari Akun
          </Button>
        </motion.div>
      </div>
      <MobileBottomNav isLive={liveActive} liveAccessToken={liveAccessToken} activeShowId={activeShowId} activeShowTitle={activeShowTitle} />
    </div>
  );
};

export default ViewerProfile;
