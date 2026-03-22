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

const SchedulePage = () => {
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<{ whatsapp_number: string }>({ whatsapp_number: "" });
  const [coinUser, setCoinUser] = useState<any>(null);
  const [redeemedTokens, setRedeemedTokens] = useState<Record<string, string>>({});
  const [accessPasswords, setAccessPasswords] = useState<Record<string, string>>({});
  const [replayPasswords, setReplayPasswords] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchData = async () => {
      const [showsRes, settingsRes] = await Promise.all([
        supabase.rpc("get_public_shows"),
        supabase.from("site_settings").select("*").in("key", ["whatsapp_number"]),
      ]);
      if (showsRes.data) {
        const upcoming = (showsRes.data as Show[]).filter(s => !s.is_subscription && !s.is_replay && s.schedule_date);
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

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <div className="mx-auto max-w-6xl px-4 py-6 pt-20">
        <div className="mb-8 flex items-center gap-3"><Calendar className="h-6 w-6 text-primary" /><h1 className="text-xl font-bold text-foreground">Jadwal Show</h1></div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><div className="h-10 w-10 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center animate-pulse"><img src={logo} alt="RT48" className="h-5 w-5 rounded-full object-cover" /></div></div>
        ) : shows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-12 text-center"><Calendar className="mx-auto mb-4 h-12 w-12 text-muted-foreground" /><p className="text-lg font-medium text-foreground">Belum ada jadwal show</p></div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {shows.map((show, i) => <ShowCard key={show.id} show={show} index={i} isReplayMode={false} redeemedToken={redeemedTokens[show.id]} accessPassword={accessPasswords[show.id]} replayPassword={replayPasswords[show.id]} onBuy={handleBuy} onCoinBuy={handleCoinBuy} />)}
          </div>
        )}
      </div>
    </div>
  );
};

export default SchedulePage;
