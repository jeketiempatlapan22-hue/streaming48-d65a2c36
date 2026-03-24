import { useState, useEffect } from "react";
import logo from "@/assets/logo.png";
import { supabase } from "@/integrations/supabase/client";
import SharedNavbar from "@/components/SharedNavbar";
import CountdownTimer from "@/components/CountdownTimer";
import { Calendar, Shield, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Show } from "@/types/show";
import ShowCard from "@/components/viewer/ShowCard";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { usePurchasedShows } from "@/hooks/usePurchasedShows";

const SchedulePage = () => {
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [settings, setSettings] = useState<{ whatsapp_number: string }>({ whatsapp_number: "" });
  const {
    coinUser, redeemedTokens, accessPasswords, replayPasswords,
    addRedeemedToken, addAccessPassword,
  } = usePurchasedShows();

  useEffect(() => {
    const fetchData = async () => {
      const [showsRes, settingsRes] = await Promise.all([
        supabase.rpc("get_public_shows"),
        supabase.from("site_settings").select("*").in("key", ["whatsapp_number"]),
      ]);
      if (showsRes.data) {
        const upcoming = (showsRes.data as Show[]).filter(s => !s.is_subscription && !s.is_replay && s.schedule_date);
        upcoming.sort((a, b) => {
          const parseDate = (d: string, t: string) => {
            if (!d) return Infinity;
            const cleanT = (t || "00:00").replace(/\s*WIB\s*/i, "").trim().replace(/\./g, ":");
            const iso = new Date(`${d}T${cleanT.padStart(5, "0")}:00`);
            if (!isNaN(iso.getTime())) return iso.getTime();
            const months: Record<string, number> = { januari:0, februari:1, maret:2, april:3, mei:4, juni:5, juli:6, agustus:7, september:8, oktober:9, november:10, desember:11 };
            const parts = d.toLowerCase().trim().split(/\s+/);
            if (parts.length === 3) {
              const [day, mon, year] = [parseInt(parts[0]), months[parts[1]], parseInt(parts[2])];
              const [h, m] = cleanT.split(":").map(Number);
              if (!isNaN(day) && mon !== undefined && !isNaN(year)) return new Date(year, mon, day, h || 0, m || 0).getTime();
            }
            return Infinity;
          };
          return parseDate(a.schedule_date, a.schedule_time) - parseDate(b.schedule_date, b.schedule_time);
        });
        setShows(upcoming);
      }
      if (settingsRes.data) {
        const s: any = {};
        settingsRes.data.forEach((row: any) => { s[row.key] = row.value; });
        setSettings(prev => ({ ...prev, ...s }));
      }
      setLoading(false);
    };
    fetchData();
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setCoinUser(session.user);
        try { setRedeemedTokens(JSON.parse(localStorage.getItem(`redeemed_tokens_${session.user.id}`) || "{}")); } catch {}
        try { setAccessPasswords(JSON.parse(localStorage.getItem(`access_passwords_${session.user.id}`) || "{}")); } catch {}
        try { setReplayPasswords(JSON.parse(localStorage.getItem(`replay_passwords_${session.user.id}`) || "{}")); } catch {}
      }
    };
    checkAuth();
    const ch = supabase.channel("sched-shows").on("postgres_changes", { event: "*", schema: "public", table: "shows" }, () => fetchData()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleBuy = (show: Show) => {
    if (!settings.whatsapp_number) { toast.error("Nomor WhatsApp admin belum diset"); return; }
    window.open(`https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent(`🎬 Beli tiket: ${show.title} (${show.price})`)}`, "_blank");
  };

  const handleCoinBuy = async (show: Show) => {
    if (!coinUser) { toast.error("Login terlebih dahulu"); return; }
    const { data, error } = await supabase.rpc("redeem_coins_for_token", { _show_id: show.id });
    const result = data as any;
    if (error || !result?.success) { toast.error(result?.error || "Gagal"); return; }
    toast.success(`Token: ${result.token_code}`);
    const stored = JSON.parse(localStorage.getItem(`redeemed_tokens_${coinUser.id}`) || "{}");
    stored[show.id] = result.token_code;
    localStorage.setItem(`redeemed_tokens_${coinUser.id}`, JSON.stringify(stored));
    setRedeemedTokens(prev => ({ ...prev, [show.id]: result.token_code }));
  };

  const filteredShows = shows.filter(s => {
    const q = searchQuery.toLowerCase();
    return s.title.toLowerCase().includes(q) || (s.schedule_date || "").toLowerCase().includes(q) || (s.lineup || "").toLowerCase().includes(q);
  });

  // Find next upcoming show for featured countdown
  const nextShow = shows.find(s => {
    if (!s.schedule_date || !s.schedule_time) return false;
    const timeStr = s.schedule_time.replace(/\s*WIB\s*/i, "").trim();
    const d = new Date(`${s.schedule_date} ${timeStr}`);
    return !isNaN(d.getTime()) && d > new Date();
  });

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <div className="mx-auto max-w-6xl px-4 py-6 pt-20">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold text-foreground">📅 Jadwal Show</h1>
          <p className="mt-2 text-sm text-muted-foreground">Lihat semua show yang akan datang</p>
        </motion.div>

        {/* Search */}
        <div className="relative mx-auto mb-6 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari show, lineup, atau tanggal..." className="bg-card pl-10" />
        </div>

        {/* Featured countdown */}
        {nextShow && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="mx-auto mb-8 max-w-lg rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/5 to-primary/10 p-5">
            <p className="text-xs font-medium text-muted-foreground mb-1">Show Berikutnya</p>
            <p className="text-lg font-bold text-foreground mb-2">{nextShow.title}</p>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
              <span>{nextShow.schedule_date}</span>
              <span>{nextShow.schedule_time}</span>
            </div>
            <CountdownTimer dateStr={nextShow.schedule_date} timeStr={nextShow.schedule_time} />
          </motion.div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12"><div className="h-10 w-10 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center animate-pulse"><img src={logo} alt="RT48" className="h-5 w-5 rounded-full object-cover" /></div></div>
        ) : filteredShows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-12 text-center"><Calendar className="mx-auto mb-4 h-12 w-12 text-muted-foreground" /><p className="text-lg font-medium text-foreground">{searchQuery ? "Tidak ada show ditemukan" : "Belum ada jadwal show"}</p></div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredShows.map((show, i) => (
              <motion.div key={show.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.08 }}>
                <ShowCard show={show} index={i} isReplayMode={false} redeemedToken={redeemedTokens[show.id]} accessPassword={accessPasswords[show.id]} replayPassword={replayPasswords[show.id]} onBuy={handleBuy} onCoinBuy={handleCoinBuy} showCountdown={true} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SchedulePage;
