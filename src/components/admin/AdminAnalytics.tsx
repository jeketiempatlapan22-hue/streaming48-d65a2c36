import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Coins, Users, ShoppingCart, Calendar } from "lucide-react";

type Period = "7d" | "30d" | "all";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--warning, 45 93% 47%))",
  "hsl(var(--success, 142 71% 45%))",
  "hsl(var(--accent))",
  "hsl(var(--destructive))",
];

const AdminAnalytics = () => {
  const [period, setPeriod] = useState<Period>("30d");
  const [coinOrders, setCoinOrders] = useState<any[]>([]);
  const [subOrders, setSubOrders] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const [co, so, tx, pr] = await Promise.all([
        supabase.from("coin_orders").select("created_at, status, coin_amount").order("created_at"),
        supabase.from("subscription_orders").select("created_at, status").order("created_at"),
        supabase.from("coin_transactions").select("created_at, amount, type").order("created_at"),
        supabase.from("profiles").select("created_at").order("created_at"),
      ]);
      setCoinOrders(co.data || []);
      setSubOrders(so.data || []);
      setTransactions(tx.data || []);
      setProfiles(pr.data || []);
      setLoading(false);
    };
    fetch();
  }, []);

  const cutoff = useMemo(() => {
    if (period === "all") return 0;
    const days = period === "7d" ? 7 : 30;
    return Date.now() - days * 86400000;
  }, [period]);

  const filterByDate = <T extends { created_at: string }>(arr: T[]) =>
    cutoff === 0 ? arr : arr.filter(i => new Date(i.created_at).getTime() >= cutoff);

  const dailyOrders = useMemo(() => {
    const filtered = filterByDate(coinOrders);
    const map: Record<string, { date: string; total: number; confirmed: number }> = {};
    filtered.forEach(o => {
      const d = new Date(o.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
      if (!map[d]) map[d] = { date: d, total: 0, confirmed: 0 };
      map[d].total++;
      if (o.status === "confirmed") map[d].confirmed++;
    });
    return Object.values(map);
  }, [coinOrders, cutoff]);

  const dailyUsers = useMemo(() => {
    const filtered = filterByDate(profiles);
    const map: Record<string, { date: string; count: number }> = {};
    filtered.forEach(p => {
      const d = new Date(p.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
      if (!map[d]) map[d] = { date: d, count: 0 };
      map[d].count++;
    });
    return Object.values(map);
  }, [profiles, cutoff]);

  const txTypeBreakdown = useMemo(() => {
    const filtered = filterByDate(transactions);
    const map: Record<string, number> = {};
    filtered.forEach(t => {
      const label = t.type === "purchase" ? "Pembelian" : t.type === "redeem" ? "Tukar Token" : t.type === "referral_claim" ? "Referral" : t.type === "admin_add" ? "Admin" : t.type;
      map[label] = (map[label] || 0) + Math.abs(t.amount);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [transactions, cutoff]);

  const stats = useMemo(() => {
    const fCo = filterByDate(coinOrders);
    const fSo = filterByDate(subOrders);
    const fTx = filterByDate(transactions);
    const fPr = filterByDate(profiles);
    const totalCoins = fTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    return {
      coinOrders: fCo.length,
      confirmedOrders: fCo.filter(o => o.status === "confirmed").length,
      subOrders: fSo.length,
      newUsers: fPr.length,
      totalCoins,
    };
  }, [coinOrders, subOrders, transactions, profiles, cutoff]);

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Analitik</h2>
        </div>
        <div className="flex rounded-lg border border-border bg-card p-0.5 gap-0.5">
          {([["7d", "7 Hari"], ["30d", "30 Hari"], ["all", "Semua"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setPeriod(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${period === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Order Koin", value: stats.coinOrders, sub: `${stats.confirmedOrders} dikonfirmasi`, icon: ShoppingCart, color: "text-primary" },
          { label: "Order Langganan", value: stats.subOrders, icon: Calendar, color: "text-[hsl(var(--warning))]" },
          { label: "User Baru", value: stats.newUsers, icon: Users, color: "text-[hsl(var(--success))]" },
          { label: "Total Koin", value: stats.totalCoins.toLocaleString("id-ID"), icon: Coins, color: "text-[hsl(var(--warning))]" },
        ].map(c => (
          <div key={c.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <c.icon className={`h-4 w-4 ${c.color}`} />
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </div>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            {c.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Order Trend */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-4 text-sm font-bold text-foreground">📊 Tren Order Koin</h3>
          {dailyOrders.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Belum ada data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyOrders.slice(-14)}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Total" />
                <Bar dataKey="confirmed" fill="hsl(var(--success, 142 71% 45%))" radius={[4, 4, 0, 0]} name="Dikonfirmasi" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* User Growth */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-4 text-sm font-bold text-foreground">📈 Pertumbuhan User</h3>
          {dailyUsers.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Belum ada data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyUsers.slice(-14)}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} name="User Baru" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Transaction Breakdown */}
        <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h3 className="mb-4 text-sm font-bold text-foreground">🪙 Distribusi Transaksi Koin</h3>
          {txTypeBreakdown.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Belum ada data</p>
          ) : (
            <div className="flex flex-col items-center gap-4 md:flex-row md:justify-center">
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie data={txTypeBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                    {txTypeBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {txTypeBreakdown.map((t, i) => (
                  <div key={t.name} className="flex items-center gap-2 text-sm">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground">{t.name}</span>
                    <span className="font-bold text-foreground">{t.value.toLocaleString("id-ID")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminAnalytics;
