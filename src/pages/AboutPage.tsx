import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import SharedNavbar from "@/components/SharedNavbar";
import { Info, Shield, Zap, Users, Coins, Radio, Globe } from "lucide-react";
import logo from "@/assets/logo.png";

const AboutPage = () => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [stats, setStats] = useState({ shows: 0, users: 0 });

  useEffect(() => {
    Promise.all([
      supabase.from("site_settings").select("key, value"),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("shows").select("id", { count: "exact", head: true }),
    ]).then(([settingsRes, usersRes, showsRes]) => {
      if (settingsRes.data) {
        const s: Record<string, string> = {};
        settingsRes.data.forEach(r => { s[r.key] = r.value; });
        setSettings(s);
      }
      setStats({
        users: usersRes.count || 0,
        shows: showsRes.count || 0,
      });
    });
  }, []);

  const features = [
    { icon: Shield, title: "Keamanan Tinggi", desc: "Watermark, batas perangkat, dan token akses untuk melindungi konten." },
    { icon: Zap, title: "Streaming Real-Time", desc: "Dukungan HLS dan multi-source untuk kualitas streaming terbaik." },
    { icon: Coins, title: "Sistem Koin", desc: "Beli koin, tukar token, dan nikmati show dengan mudah." },
    { icon: Users, title: "Komunitas", desc: "Live chat, polling, dan leaderboard untuk interaksi real-time." },
    { icon: Radio, title: "Multi-Platform", desc: "Tonton di browser manapun, dengan dukungan Picture-in-Picture." },
    { icon: Globe, title: "Akses Global", desc: "Streaming dari mana saja, kapan saja, tanpa batasan geografis." },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <div className="mx-auto max-w-4xl px-4 pt-20 pb-16">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-12 text-center">
          <div className="mx-auto mb-6 h-24 w-24 rounded-full border-2 border-primary/40 bg-primary/10 flex items-center justify-center shadow-[0_0_30px_hsl(var(--primary)/0.2)] overflow-hidden">
            <img src={logo} alt="RT48" className="h-full w-full object-cover" />
          </div>
          <h1 className="text-3xl font-extrabold text-foreground md:text-4xl">
            Tentang <span className="text-primary">RealTime48</span>
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground leading-relaxed">
            {settings.site_title || "Platform streaming eksklusif dengan keamanan tinggi dan fitur lengkap untuk pengalaman menonton terbaik."}
          </p>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="mb-12 grid grid-cols-2 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <p className="text-3xl font-black text-primary">{stats.shows}</p>
            <p className="mt-1 text-xs text-muted-foreground">Show Tersedia</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <p className="text-3xl font-black text-[hsl(var(--success))]">{stats.users}</p>
            <p className="mt-1 text-xs text-muted-foreground">User Terdaftar</p>
          </div>
        </motion.div>

        {/* Features */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h2 className="mb-6 text-center text-xl font-bold text-foreground">Fitur Unggulan</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.05 }}
                className="rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-1 text-sm font-bold text-foreground">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Contact */}
        {settings.whatsapp_number && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
            className="mt-12 rounded-xl border border-border bg-card p-8 text-center">
            <h3 className="mb-2 text-lg font-bold text-foreground">Ada Pertanyaan?</h3>
            <p className="mb-4 text-sm text-muted-foreground">Hubungi admin kami untuk bantuan lebih lanjut</p>
            <a
              href={`https://wa.me/${settings.whatsapp_number}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--success))] px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-[hsl(var(--success))]/90 active:scale-[0.97]"
            >
              💬 Hubungi WhatsApp
            </a>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default AboutPage;
