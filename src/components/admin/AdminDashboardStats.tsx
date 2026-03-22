import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Coins, ShoppingCart, Ticket, TrendingUp, Radio } from "lucide-react";

const AdminDashboardStats = () => {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalCoinOrders: 0,
    totalSubOrders: 0,
    totalTokens: 0,
    totalCoinsCirculating: 0,
    pendingOrders: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const [profiles, coinOrders, subOrders, tokens, balances, pending] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("coin_orders").select("id", { count: "exact", head: true }),
        supabase.from("subscription_orders").select("id", { count: "exact", head: true }),
        supabase.from("tokens").select("id", { count: "exact", head: true }),
        supabase.from("coin_balances").select("balance"),
        supabase.from("coin_orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      const totalCoins = (balances.data || []).reduce((s, r) => s + (r.balance || 0), 0);
      setStats({
        totalUsers: profiles.count || 0,
        totalCoinOrders: coinOrders.count || 0,
        totalSubOrders: subOrders.count || 0,
        totalTokens: tokens.count || 0,
        totalCoinsCirculating: totalCoins,
        pendingOrders: pending.count || 0,
      });
      setLoading(false);
    };
    fetch();
  }, []);

  const cards = [
    { label: "Total User", value: stats.totalUsers, icon: Users, color: "text-primary" },
    { label: "Koin Beredar", value: stats.totalCoinsCirculating, icon: Coins, color: "text-[hsl(var(--warning))]" },
    { label: "Order Koin", value: stats.totalCoinOrders, icon: ShoppingCart, color: "text-[hsl(var(--success))]" },
    { label: "Order Langganan", value: stats.totalSubOrders, icon: TrendingUp, color: "text-[hsl(280,70%,60%)]" },
    { label: "Token Aktif", value: stats.totalTokens, icon: Ticket, color: "text-primary" },
    { label: "Pending Order", value: stats.pendingOrders, icon: Radio, color: "text-destructive" },
  ];

  if (loading) return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card" />
      ))}
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`h-4 w-4 ${c.color}`} />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{c.label}</span>
            </div>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value.toLocaleString("id-ID")}</p>
          </div>
        );
      })}
    </div>
  );
};

export default AdminDashboardStats;
