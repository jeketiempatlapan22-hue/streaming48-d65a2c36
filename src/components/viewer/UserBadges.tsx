import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Award, Star, Zap, Crown, Heart, Flame, Gem, Trophy } from "lucide-react";
import type { User } from "@supabase/supabase-js";

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  earned: boolean;
}

const UserBadges = ({ user }: { user: User }) => {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [balRes, ordRes, tokRes, subRes, txRes] = await Promise.allSettled([
          supabase.from("coin_balances").select("balance").eq("user_id", user.id).maybeSingle(),
          supabase.from("coin_orders").select("id").eq("user_id", user.id).eq("status", "confirmed"),
          supabase.from("tokens").select("id").eq("user_id", user.id),
          supabase.from("subscription_orders").select("id").eq("user_id", user.id).eq("status", "confirmed"),
          supabase.from("coin_transactions").select("amount").eq("user_id", user.id).lt("amount", 0),
        ]);

        const balance = balRes.status === "fulfilled" ? (balRes.value.data?.balance || 0) : 0;
        const coinOrders = ordRes.status === "fulfilled" ? (ordRes.value.data?.length || 0) : 0;
        const tokenCount = tokRes.status === "fulfilled" ? (tokRes.value.data?.length || 0) : 0;
        const subCount = subRes.status === "fulfilled" ? (subRes.value.data?.length || 0) : 0;
        const totalSpent = txRes.status === "fulfilled"
          ? (txRes.value.data || []).reduce((s: number, t: any) => s + Math.abs(t.amount), 0) : 0;

        // Days since registration
        const regDate = new Date(user.created_at);
        const daysSince = Math.floor((Date.now() - regDate.getTime()) / 86400000);

        const allBadges: Badge[] = [
          {
            id: "newcomer",
            name: "Pendatang Baru",
            description: "Bergabung dengan RealTime48",
            icon: <Star className="h-5 w-5" />,
            color: "text-primary",
            bg: "bg-primary/15",
            earned: true, // Everyone gets this
          },
          {
            id: "collector",
            name: "Kolektor Koin",
            description: "Membeli koin sebanyak 3 kali",
            icon: <Gem className="h-5 w-5" />,
            color: "text-[hsl(var(--warning))]",
            bg: "bg-[hsl(var(--warning))]/15",
            earned: coinOrders >= 3,
          },
          {
            id: "superfan",
            name: "Super Fan",
            description: "Menonton 5+ show",
            icon: <Heart className="h-5 w-5" />,
            color: "text-destructive",
            bg: "bg-destructive/15",
            earned: subCount >= 5,
          },
          {
            id: "bigspender",
            name: "Big Spender",
            description: "Menghabiskan 100+ koin",
            icon: <Crown className="h-5 w-5" />,
            color: "text-[hsl(var(--warning))]",
            bg: "bg-[hsl(var(--warning))]/15",
            earned: totalSpent >= 100,
          },
          {
            id: "veteran",
            name: "Veteran",
            description: "Anggota selama 30+ hari",
            icon: <Trophy className="h-5 w-5" />,
            color: "text-[hsl(var(--success))]",
            bg: "bg-[hsl(var(--success))]/15",
            earned: daysSince >= 30,
          },
          {
            id: "earlybird",
            name: "Early Bird",
            description: "Bergabung di 7 hari pertama",
            icon: <Zap className="h-5 w-5" />,
            color: "text-accent",
            bg: "bg-accent/15",
            earned: daysSince >= 0 && regDate < new Date("2026-05-01"),
          },
          {
            id: "tokenhoarder",
            name: "Token Master",
            description: "Memiliki 10+ token",
            icon: <Flame className="h-5 w-5" />,
            color: "text-destructive",
            bg: "bg-destructive/15",
            earned: tokenCount >= 10,
          },
          {
            id: "whale",
            name: "Whale 🐋",
            description: "Saldo koin 500+",
            icon: <Award className="h-5 w-5" />,
            color: "text-primary",
            bg: "bg-primary/15",
            earned: balance >= 500,
          },
        ];

        setBadges(allBadges);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user.id, user.created_at]);

  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-20 skeleton rounded-xl" />
        ))}
      </div>
    );
  }

  const earned = badges.filter(b => b.earned);
  const locked = badges.filter(b => !b.earned);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Award className="h-4 w-4 text-[hsl(var(--warning))]" />
        <span className="text-xs font-semibold text-foreground">Badge ({earned.length}/{badges.length})</span>
      </div>

      {/* Earned badges */}
      <div className="grid grid-cols-4 gap-2">
        {earned.map((b, i) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className={`glass rounded-xl p-2.5 text-center group cursor-default`}
            title={`${b.name}: ${b.description}`}
          >
            <div className={`mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-lg ${b.bg} transition-transform group-hover:scale-110`}>
              <span className={b.color}>{b.icon}</span>
            </div>
            <p className="text-[8px] font-bold text-foreground leading-tight">{b.name}</p>
          </motion.div>
        ))}
      </div>

      {/* Locked badges */}
      {locked.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {locked.map((b) => (
            <div
              key={b.id}
              className="rounded-xl border border-border/30 bg-muted/30 p-2.5 text-center opacity-40 cursor-default"
              title={`🔒 ${b.name}: ${b.description}`}
            >
              <div className="mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50">
                <span className="text-muted-foreground">{b.icon}</span>
              </div>
              <p className="text-[8px] font-bold text-muted-foreground leading-tight">🔒</p>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
};

export default UserBadges;
