import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Coins, Save, User, History, BarChart3, Shield, Ticket, Key, Copy } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

const ViewerProfile = () => {
  const [user, setUser] = useState<any>(null);
  const [username, setUsername] = useState("");
  const [originalUsername, setOriginalUsername] = useState("");
  const [balance, setBalance] = useState(0);
  const [orders, setOrders] = useState<any[]>([]);
  const [subOrders, setSubOrders] = useState<any[]>([]);
  const [tokens, setTokens] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"orders" | "subscriptions" | "tokens">("orders");
  const navigate = useNavigate();

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/auth"); return; }
      const u = session.user;
      setUser(u);
      const [profileRes, balRes, ordersRes, subRes, tokensRes] = await Promise.all([
        supabase.from("profiles").select("username").eq("id", u.id).maybeSingle(),
        supabase.from("coin_balances").select("balance").eq("user_id", u.id).maybeSingle(),
        supabase.from("coin_orders").select("*").eq("user_id", u.id).order("created_at", { ascending: false }).limit(30),
        supabase.from("subscription_orders").select("*, shows(title)").eq("user_id", u.id).order("created_at", { ascending: false }).limit(30),
        supabase.from("tokens").select("*").eq("user_id", u.id).order("created_at", { ascending: false }).limit(30),
      ]);
      const name = profileRes.data?.username || u.user_metadata?.username || "";
      setUsername(name); setOriginalUsername(name);
      setBalance(balRes.data?.balance || 0);
      setOrders(ordersRes.data || []);
      setSubOrders(subRes.data || []);
      setTokens(tokensRes.data || []);
      setLoading(false);
    };
    init();
  }, [navigate]);

  const handleSave = async () => {
    if (!user || !username.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({ id: user.id, username: username.trim() }, { onConflict: "id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else { setOriginalUsername(username.trim()); toast.success("Username diperbarui!"); }
  };

  const copyText = (text: string) => { navigator.clipboard.writeText(text); toast.success("Disalin!"); };

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

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><div className="h-12 w-12 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center animate-pulse"><Shield className="h-6 w-6 text-primary" /></div></div>;

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
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-card p-6">
          <div className="mb-5 flex flex-col items-center gap-3"><div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10"><User className="h-8 w-8 text-primary" /></div><p className="text-xs text-muted-foreground">{user?.email || ""}</p></div>
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

        {/* Buy Coins CTA */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
            <div><p className="text-xs text-muted-foreground">Saldo Koin</p><div className="flex items-center gap-2 mt-1"><Coins className="h-5 w-5 text-[hsl(var(--warning))]" /><span className="text-2xl font-bold text-[hsl(var(--warning))]">{balance}</span></div></div>
            <Button size="sm" variant="outline" onClick={() => navigate("/coins")}><Coins className="mr-1.5 h-3.5 w-3.5" /> Beli Koin</Button>
          </div>
        </motion.div>

        {/* Tabs */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <div className="flex rounded-lg border border-border bg-card p-1 gap-1">
            {([["orders", "Order Koin", History], ["subscriptions", "Langganan", Ticket], ["tokens", "Token", Key]] as const).map(([key, label, Icon]) => (
              <button key={key} onClick={() => setTab(key)} className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-all active:scale-[0.97] ${tab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Tab Content */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-xl border border-border bg-card p-4">
          {tab === "orders" && (
            orders.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">Belum ada order koin</p> : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-lg bg-background p-3">
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
                  <div key={o.id} className="flex items-center justify-between rounded-lg bg-background p-3">
                    <div className="min-w-0 flex-1"><p className="text-xs font-medium text-foreground">{(o as any).shows?.title || "Show"}</p><p className="text-[10px] text-muted-foreground">{o.payment_method} • {new Date(o.created_at).toLocaleString("id-ID")}</p></div>
                    {statusBadge(o.status)}
                  </div>
                ))}
              </div>
            )
          )}
          {tab === "tokens" && (
            tokens.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">Belum ada token</p> : (
              <div className="space-y-2">
                {tokens.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg bg-background p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-mono font-medium text-foreground">{t.code}</p>
                        <button onClick={() => copyText(t.code)} className="text-muted-foreground hover:text-primary active:scale-[0.95]"><Copy className="h-3 w-3" /></button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {t.expires_at ? `Exp: ${new Date(t.expires_at).toLocaleString("id-ID")}` : "Tanpa batas"}
                      </p>
                    </div>
                    {statusBadge(t.status)}
                  </div>
                ))}
              </div>
            )
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default ViewerProfile;
