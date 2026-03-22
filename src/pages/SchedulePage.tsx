import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, Clock, Users, Ticket, Coins } from "lucide-react";
import { motion } from "framer-motion";
import SharedNavbar from "@/components/SharedNavbar";
import CountdownTimer from "@/components/CountdownTimer";

interface Show {
  id: string;
  title: string;
  price: string;
  lineup: string;
  schedule_date: string;
  schedule_time: string;
  background_image_url: string | null;
  qris_image_url: string | null;
  coin_price: number;
  category: string;
  is_order_closed: boolean;
  is_replay: boolean;
  replay_coin_price: number;
  access_password?: string;
}

const CATEGORIES: Record<string, { label: string; color: string }> = {
  regular: { label: "🎭 Reguler", color: "bg-primary/20 text-primary" },
  birthday: { label: "🎂 Ulang Tahun", color: "bg-pink-500/20 text-pink-400" },
  special: { label: "⭐ Spesial", color: "bg-yellow-500/20 text-yellow-400" },
  anniversary: { label: "🎉 Anniversary", color: "bg-purple-500/20 text-purple-400" },
  last_show: { label: "👋 Last Show", color: "bg-red-500/20 text-red-400" },
};

const SchedulePage = () => {
  const [shows, setShows] = useState<Show[]>([]);

  useEffect(() => {
    const fetchShows = async () => {
      const { data } = await supabase.rpc("get_public_shows");
      if (data) setShows(data as Show[]);
    };
    fetchShows();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SharedNavbar />

      <div className="mx-auto max-w-4xl px-4 py-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <p className="text-sm font-bold uppercase tracking-widest text-primary mb-2">Jadwal</p>
          <h1 className="text-3xl font-extrabold text-foreground">Jadwal <span className="text-primary">Show</span></h1>
        </motion.div>

        {shows.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-16">Belum ada show terjadwal.</p>
        ) : (
          <div className="space-y-4">
            {shows.filter(s => !s.is_replay).map((show, i) => (
              <motion.div
                key={show.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="rounded-2xl border border-border bg-card p-5 hover:border-primary/30 transition-all"
              >
                <div className="flex items-start gap-4">
                  {show.background_image_url ? (
                    <img src={show.background_image_url} alt={show.title} className="h-20 w-20 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="h-20 w-20 rounded-xl bg-gradient-to-br from-primary/20 to-accent/10 flex items-center justify-center shrink-0">
                      <Ticket className="h-8 w-8 text-primary/30" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-foreground truncate">{show.title}</h3>
                      {show.category && show.category !== "regular" && (
                        <span className={`text-[10px] rounded-full px-2 py-0.5 font-bold ${CATEGORIES[show.category]?.color || ""}`}>
                          {CATEGORIES[show.category]?.label}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                      {show.schedule_date && (
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3 text-primary" />{show.schedule_date}</span>
                      )}
                      {show.schedule_time && (
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-primary" />{show.schedule_time}</span>
                      )}
                      {show.lineup && (
                        <span className="flex items-center gap-1"><Users className="h-3 w-3 text-primary" />{show.lineup}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">{show.price}</span>
                      {show.coin_price > 0 && (
                        <span className="flex items-center gap-1 text-xs font-semibold text-[hsl(var(--warning))]">
                          <Coins className="h-3 w-3" />{show.coin_price} Koin
                        </span>
                      )}
                      {show.schedule_date && show.schedule_time && (
                        <CountdownTimer dateStr={show.schedule_date} timeStr={show.schedule_time} />
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-8">
          <a href="/" className="text-primary hover:underline">← Kembali ke beranda</a>
        </p>
      </div>
    </div>
  );
};

export default SchedulePage;
