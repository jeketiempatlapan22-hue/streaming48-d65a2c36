import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, useInView } from "framer-motion";
import { Users, Ticket, Coins, Film } from "lucide-react";

const useCountUp = (target: number, duration: number, inView: boolean) => {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (!inView || target === 0) return;
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCurrent(target); clearInterval(timer); }
      else setCurrent(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration, inView]);
  return current;
};

const LandingStats = () => {
  const [stats, setStats] = useState({ users: 0, shows: 0, coins: 0, replays: 0 });
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });

  useEffect(() => {
    const fetch = async () => {
      const [profiles, shows, balances, replays] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("shows").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("coin_balances").select("balance"),
        supabase.from("shows").select("id", { count: "exact", head: true }).eq("is_replay", true).eq("is_active", true),
      ]);
      const totalCoins = (balances.data || []).reduce((s, r) => s + (r.balance || 0), 0);
      setStats({
        users: profiles.count || 0,
        shows: shows.count || 0,
        coins: totalCoins,
        replays: replays.count || 0,
      });
    };
    fetch();
  }, []);

  const cards = [
    { label: "Penonton", value: stats.users, icon: Users, color: "text-primary" },
    { label: "Total Show", value: stats.shows, icon: Ticket, color: "text-[hsl(var(--success))]" },
    { label: "Koin Beredar", value: stats.coins, icon: Coins, color: "text-[hsl(var(--warning))]" },
    { label: "Replay", value: stats.replays, icon: Film, color: "text-accent" },
  ];

  return (
    <section ref={ref} className="px-4 py-12">
      <div className="mx-auto grid max-w-4xl grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c, i) => {
          const Icon = c.icon;
          const animated = useCountUp(c.value, 1200, inView);
          return (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="group rounded-2xl border border-border bg-card/80 p-5 text-center transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-secondary transition-colors group-hover:bg-primary/10">
                <Icon className={`h-5 w-5 ${c.color}`} />
              </div>
              <p className={`text-2xl font-black tabular-nums ${c.color}`}>
                {animated.toLocaleString("id-ID")}
              </p>
              <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {c.label}
              </p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
};

export default LandingStats;
