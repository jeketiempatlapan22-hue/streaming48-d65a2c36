import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { BarChart3, Coins, Ticket, TrendingUp, Calendar, Award } from "lucide-react";
import type { User } from "@supabase/supabase-js";

interface MonthlyData {
  month: string;
  coins: number;
  orders: number;
}

interface UserStatsData {
  totalSpent: number;
  totalOrders: number;
  totalTokens: number;
  totalShows: number;
  monthlyData: MonthlyData[];
}

const UserStatsPanel = ({ user }: { user: User }) => {
  const [stats, setStats] = useState<UserStatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [txRes, ordRes, tokRes, subRes] = await Promise.allSettled([
          supabase.from("coin_transactions").select("amount, created_at, type").eq("user_id", user.id),
          supabase.from("coin_orders").select("coin_amount, created_at, status").eq("user_id", user.id),
          supabase.from("tokens").select("id, created_at").eq("user_id", user.id),
          supabase.from("subscription_orders").select("id, created_at, status").eq("user_id", user.id),
        ]);

        const txs = txRes.status === "fulfilled" ? (txRes.value.data || []) : [];
        const ords = ordRes.status === "fulfilled" ? (ordRes.value.data || []) : [];
        const toks = tokRes.status === "fulfilled" ? (tokRes.value.data || []) : [];
        const subs = subRes.status === "fulfilled" ? (subRes.value.data || []) : [];

        const totalSpent = txs
          .filter((t: any) => t.amount < 0)
          .reduce((s: number, t: any) => s + Math.abs(t.amount), 0);

        // Monthly breakdown (last 6 months)
        const months: MonthlyData[] = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date();
          d.setMonth(d.getMonth() - i);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label = d.toLocaleDateString("id-ID", { month: "short", year: "2-digit" });

          const mCoins = txs
            .filter((t: any) => t.created_at?.startsWith(key) && t.amount < 0)
            .reduce((s: number, t: any) => s + Math.abs(t.amount), 0);
          const mOrders = ords.filter((o: any) => o.created_at?.startsWith(key)).length +
            subs.filter((o: any) => o.created_at?.startsWith(key)).length;

          months.push({ month: label, coins: mCoins, orders: mOrders });
        }

        setStats({
          totalSpent,
          totalOrders: ords.length + subs.length,
          totalTokens: toks.length,
          totalShows: subs.filter((s: any) => s.status === "confirmed").length,
          monthlyData: months,
        });
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user.id]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 skeleton rounded-xl" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const maxCoin = Math.max(...stats.monthlyData.map(m => m.coins), 1);

  const statCards = [
    { label: "Total Koin Dipakai", value: stats.totalSpent, icon: Coins, color: "text-[hsl(var(--warning))]", bg: "bg-[hsl(var(--warning))]/10" },
    { label: "Total Order", value: stats.totalOrders, icon: TrendingUp, color: "text-primary", bg: "bg-primary/10" },
    { label: "Token Dimiliki", value: stats.totalTokens, icon: Ticket, color: "text-[hsl(var(--success))]", bg: "bg-[hsl(var(--success))]/10" },
    { label: "Show Ditonton", value: stats.totalShows, icon: Award, color: "text-accent", bg: "bg-accent/10" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        {statCards.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              className="glass rounded-xl p-3 text-center"
            >
              <div className={`mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${c.bg}`}>
                <Icon className={`h-4 w-4 ${c.color}`} />
              </div>
              <p className={`text-lg font-bold ${c.color}`}>{c.value.toLocaleString("id-ID")}</p>
              <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{c.label}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Monthly Chart */}
      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">Aktivitas 6 Bulan Terakhir</span>
        </div>
        <div className="flex items-end gap-2 h-32">
          {stats.monthlyData.map((m, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[8px] font-bold text-muted-foreground">{m.coins > 0 ? m.coins : ""}</span>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${Math.max((m.coins / maxCoin) * 100, 4)}%` }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className="w-full rounded-t-md bg-gradient-to-t from-primary/80 to-primary/40 min-h-[4px]"
              />
              <span className="text-[8px] text-muted-foreground font-medium">{m.month}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-center gap-4 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-primary/60" /> Koin Dipakai
          </span>
        </div>
      </div>
    </motion.div>
  );
};

export default UserStatsPanel;
