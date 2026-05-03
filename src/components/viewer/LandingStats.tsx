import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, useInView } from "framer-motion";
import { Users, Ticket, Coins, Film } from "lucide-react";
import { fetchCachedEndpoint, cachedQuery } from "@/lib/queryCache";
import { useViewerCount } from "@/hooks/useViewerCount";

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
  const [stats, setStats] = useState({ viewers: 0, shows: 0, coins: 0, replays: 0 });
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });

  useEffect(() => {
    const fetchData = async () => {
      const cached = await fetchCachedEndpoint("all");
      if (cached?.shows) {
        const showsList = cached.shows as any[];
        setStats(prev => ({
          ...prev,
          shows: showsList.filter((s: any) => !s.is_replay).length,
          coins: cached.totalCoins ?? 0,
          replays: showsList.filter((s: any) => s.is_replay).length,
        }));
        return;
      }
      const showsList = await cachedQuery("public_shows", async () => {
        const { data } = await supabase.rpc("get_public_shows");
        return data || [];
      }, 60_000);
      setStats(prev => ({
        ...prev,
        shows: showsList.filter((s: any) => !s.is_replay).length,
        replays: showsList.filter((s: any) => s.is_replay).length,
      }));
    };
    fetchData();
  }, []);

  // Single source of truth for viewer count (shared global poller, watchdog-protected)
  const liveViewers = useViewerCount();
  useEffect(() => {
    setStats(prev => (prev.viewers === liveViewers ? prev : { ...prev, viewers: liveViewers }));
  }, [liveViewers]);

  const cards = [
    { label: "Sedang Menonton", value: stats.viewers, icon: Users, color: "text-destructive" },
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
              className="group rounded-2xl glass p-5 text-center transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
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
