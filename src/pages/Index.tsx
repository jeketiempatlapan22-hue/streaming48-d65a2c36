import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import LandingFloatingEmojis from "@/components/viewer/LandingFloatingEmojis";
import ConnectionStatus from "@/components/viewer/ConnectionStatus";
import InstallBanner from "@/components/viewer/InstallBanner";
import LiveViewerCount from "@/components/viewer/LiveViewerCount";
import ThemeToggle from "@/components/ThemeToggle";
import LiveNowBanner from "@/components/viewer/LiveNowBanner";
import ViewerBroadcast from "@/components/viewer/ViewerBroadcast";
import LandingStats from "@/components/viewer/LandingStats";
import {
  Calendar, Clock, Users, MessageCircle, Ticket, Star, Upload, CheckCircle, Crown, Sparkles,
  Menu, X, Phone, Info, Radio, CreditCard, Mail, Coins, User, Copy, Play, Lock, Film, Home, Settings,
} from "lucide-react";
import logo from "@/assets/logo.png";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import type { Show } from "@/types/show";
import ShowCard from "@/components/viewer/ShowCard";
import { SHOW_CATEGORIES } from "@/types/show";
import { toast } from "sonner";

interface SiteSettings {
  whatsapp_number: string;
  purchase_message: string;
  site_title: string;
  whatsapp_channel: string;
  subscription_info: string;
  announcement_text: string;
  announcement_enabled: string;
  [key: string]: string;
}

const Index = () => {
  const [shows, setShows] = useState<Show[]>([]);
  const [isStreamLive, setIsStreamLive] = useState(false);
  const [descriptions, setDescriptions] = useState<any[]>([]);
  const [settings, setSettings] = useState<SiteSettings>({
    whatsapp_number: "",
    purchase_message: "",
    site_title: "RealTime48 Streaming",
    whatsapp_channel: "",
    subscription_info: "",
    announcement_text: "",
    announcement_enabled: "",
    landing_desc_layout: "list",
    landing_desc_title: "",
    landing_desc_subtitle: "",
    landing_desc_quote: "",
  });
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [purchaseStep, setPurchaseStep] = useState<"qris" | "upload" | "info" | "done">("qris");
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofUrl, setProofUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // Coin state
  const [coinUser, setCoinUser] = useState<any>(null);
  const [coinBalance, setCoinBalance] = useState(0);
  const [coinUsername, setCoinUsername] = useState("");
  const [coinShowTarget, setCoinShowTarget] = useState<Show | null>(null);
  const [coinRedeeming, setCoinRedeeming] = useState(false);
  const [coinResult, setCoinResult] = useState<{ token_code: string; remaining_balance: number; replay_password?: string; access_password?: string } | null>(null);
  const [redeemedTokens, setRedeemedTokens] = useState<Record<string, string>>({});
  const [replayPasswords, setReplayPasswords] = useState<Record<string, string>>({});
  const [accessPasswords, setAccessPasswords] = useState<Record<string, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);

  const fetchData = async () => {
    const [showsRes, settingsRes, streamRes, descRes] = await Promise.all([
      supabase.rpc("get_public_shows"),
      supabase.from("site_settings").select("*"),
      supabase.from("streams").select("is_live").limit(1).single(),
      supabase.from("landing_descriptions").select("*").eq("is_active", true).order("sort_order"),
    ]);
    if (streamRes.data) setIsStreamLive(streamRes.data.is_live);
    if (showsRes.data) setShows(showsRes.data as Show[]);
    if (descRes.data) setDescriptions(descRes.data as any[]);
    if (settingsRes.data) {
      const s: any = {};
      settingsRes.data.forEach((row: any) => { s[row.key] = row.value; });
      setSettings((prev) => ({ ...prev, ...s }));
    }
  };

  useEffect(() => {
    fetchData();

    const fetchCoinUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;
      setCoinUser(user);
      const [balRes, profileRes] = await Promise.all([
        supabase.from("coin_balances").select("balance").eq("user_id", user.id).maybeSingle(),
        supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
      ]);
      setCoinBalance(balRes.data?.balance || 0);
      setCoinUsername(profileRes.data?.username || user.user_metadata?.username || "");

      try {
        const stored = JSON.parse(localStorage.getItem(`redeemed_tokens_${user.id}`) || "{}");
        setRedeemedTokens(stored);
      } catch {}
      try {
        const storedPw = JSON.parse(localStorage.getItem(`replay_passwords_${user.id}`) || "{}");
        setReplayPasswords(storedPw);
      } catch {}
      try {
        const storedAp = JSON.parse(localStorage.getItem(`access_passwords_${user.id}`) || "{}");
        setAccessPasswords(storedAp);
      } catch {}

      const balCh = supabase
        .channel(`idx-balance-${user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "coin_balances", filter: `user_id=eq.${user.id}` }, (payload: any) => {
          if (payload.new?.balance !== undefined) {
            const oldBal = payload.old?.balance ?? 0;
            const newBal = payload.new.balance;
            setCoinBalance(newBal);
            if (newBal > oldBal) toast.success(`+${newBal - oldBal} koin telah masuk! Saldo: ${newBal}`);
          }
        })
        .subscribe();

      return () => { supabase.removeChannel(balCh); };
    };
    const cleanupBalance = fetchCoinUser();

    const showCh = supabase.channel("idx-shows")
      .on("postgres_changes", { event: "*", schema: "public", table: "shows" }, () => fetchData())
      .subscribe();
    const streamCh = supabase.channel("idx-streams")
      .on("postgres_changes", { event: "*", schema: "public", table: "streams" }, (payload: any) => {
        if (payload.new?.is_live !== undefined) setIsStreamLive(payload.new.is_live);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(showCh);
      supabase.removeChannel(streamCh);
      cleanupBalance.then((cleanup) => cleanup?.());
    };
  }, []);

  const handleBuy = (show: Show) => {
    setSelectedShow(show);
    setPurchaseStep(show.is_subscription ? "qris" : "info");
    setProofUrl("");
    setPhone("");
    setEmail("");
  };

  const handleCoinBuy = (show: Show) => {
    if (!coinUser) {
      toast.error("Login terlebih dahulu di halaman /auth");
      return;
    }
    setCoinShowTarget(show);
    setCoinResult(null);
  };

  const handleCoinRedeem = async () => {
    if (!coinShowTarget) return;
    setCoinRedeeming(true);
    const { data, error } = await supabase.rpc("redeem_coins_for_token", { _show_id: coinShowTarget.id });
    setCoinRedeeming(false);
    const result = data as any;
    if (error || !result?.success) {
      toast.error(result?.error || error?.message || "Gagal menukar koin");
      return;
    }
    setCoinResult({ token_code: result.token_code, remaining_balance: result.remaining_balance, replay_password: result.replay_password, access_password: result.access_password });
    setCoinBalance(result.remaining_balance);

    if (coinUser) {
      const stored = JSON.parse(localStorage.getItem(`redeemed_tokens_${coinUser.id}`) || "{}");
      stored[coinShowTarget.id] = result.token_code;
      localStorage.setItem(`redeemed_tokens_${coinUser.id}`, JSON.stringify(stored));
      setRedeemedTokens((prev) => ({ ...prev, [coinShowTarget.id]: result.token_code }));

      if (result.replay_password) {
        const storedPw = JSON.parse(localStorage.getItem(`replay_passwords_${coinUser.id}`) || "{}");
        storedPw[coinShowTarget.id] = result.replay_password;
        localStorage.setItem(`replay_passwords_${coinUser.id}`, JSON.stringify(storedPw));
        setReplayPasswords((prev) => ({ ...prev, [coinShowTarget.id]: result.replay_password }));
      }
      if (result.access_password) {
        const storedAp = JSON.parse(localStorage.getItem(`access_passwords_${coinUser.id}`) || "{}");
        storedAp[coinShowTarget.id] = result.access_password;
        localStorage.setItem(`access_passwords_${coinUser.id}`, JSON.stringify(storedAp));
        setAccessPasswords((prev) => ({ ...prev, [coinShowTarget.id]: result.access_password }));
      }
    }
  };

  const handleConfirmRegular = () => {
    if (!selectedShow || !settings.whatsapp_number) return;
    const now = new Date().toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" });
    const msg = encodeURIComponent(
      `━━━━━━━━━━━━━━━━━━━━\n🎬 *PESANAN TIKET BARU*\n━━━━━━━━━━━━━━━━━━━━\n\n🎭 *Show:* ${selectedShow.title}\n💰 *Harga:* ${selectedShow.price}\n${selectedShow.schedule_date ? `📅 *Jadwal:* ${selectedShow.schedule_date} ${selectedShow.schedule_time}\n` : ""}${selectedShow.lineup ? `👥 *Lineup:* ${selectedShow.lineup}\n` : ""}\n📋 *DATA PEMBELI*\n📧 Email: ${email}\n🕐 Waktu Order: ${now}\n\n━━━━━━━━━━━━━━━━━━━━\n_Dikirim dari RealTime48_ ✨`
    );
    window.open(`https://wa.me/${settings.whatsapp_number}?text=${msg}`, "_blank");
    setSelectedShow(null);
  };

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedShow) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("File terlalu besar (max 5MB)"); return; }
    setUploadingProof(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("coin-proofs").upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("coin-proofs").getPublicUrl(path);
      setProofUrl(urlData.publicUrl);
      if (selectedShow.is_subscription) setPurchaseStep("info");
    } catch {
      toast.error("Upload gagal, coba lagi");
    }
    setUploadingProof(false);
  };

  const handleSubmitSubscription = async () => {
    if (!selectedShow || !proofUrl) return;
    const { data: orderData } = await supabase.from("subscription_orders").insert({
      show_id: selectedShow.id, phone, email, payment_proof_url: proofUrl,
    }).select("id").single();
    setPurchaseStep("done");

    if (orderData?.id) {
      supabase.functions.invoke("notify-subscription-order", {
        body: { order_id: orderData.id, show_title: selectedShow.title, phone, email, payment_proof_url: proofUrl },
      }).catch(() => {});
    }
  };

  const regularShows = shows.filter((s) => !s.is_subscription && !s.is_replay);
  const replayShows = shows.filter((s) => !s.is_subscription && s.is_replay && s.replay_coin_price > 0);

  const menuItems = [
    { icon: <Home className="h-5 w-5 text-primary" />, label: "Beranda", description: "Halaman utama", href: "/" },
    { icon: <Calendar className="h-5 w-5 text-primary" />, label: "Jadwal Show", description: "Lihat jadwal & countdown", href: "/schedule" },
    { icon: <Film className="h-5 w-5 text-accent" />, label: "Replay Show", description: "Tonton ulang show yang sudah berlalu", href: "/schedule" },
    ...(settings.whatsapp_channel ? [{
      icon: <Radio className="h-5 w-5 text-primary" />, label: "Saluran WhatsApp", description: "Ikuti saluran info terbaru",
      href: settings.whatsapp_channel,
    }] : []),
    ...(settings.whatsapp_number ? [{
      icon: <Phone className="h-5 w-5 text-[hsl(var(--success))]" />, label: "Hubungi Admin", description: "Chat langsung via WhatsApp",
      href: `https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent("Halo admin")}`,
    }] : []),
    { icon: <Coins className="h-5 w-5 text-[hsl(var(--warning))]" />, label: "Coin Shop", description: "Beli koin untuk akses nonton show", href: "/coins" },
    { icon: <Info className="h-5 w-5 text-primary" />, label: "Tentang", description: "Info lengkap tentang platform", href: "/about" },
    { icon: <MessageCircle className="h-5 w-5 text-primary" />, label: "FAQ", description: "Pertanyaan yang sering diajukan", href: "/faq" },
    { icon: <Ticket className="h-5 w-5 text-primary" />, label: "Data Show", description: `${regularShows.length} show tersedia`, href: "#shows" },
  ];

  return (
    <div className="relative min-h-screen bg-background">
      <ConnectionStatus />
      <LandingFloatingEmojis />
      <LiveNowBanner isLive={isStreamLive} />

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shadow-[0_0_8px_hsl(var(--primary)/0.3)]">
              <img src={logo} alt="RT48" className="h-4 w-4 rounded-full object-cover" />
            </div>
            <span className="text-sm font-bold text-foreground">Real<span className="text-primary">Time48</span></span>
          </div>
          <div className="flex items-center gap-2">
            <LiveViewerCount isLive={isStreamLive} />
            <ThemeToggle />
            {!sheetOpen && (
              <a href="/coins" className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5 text-[hsl(var(--warning))] transition hover:bg-[hsl(var(--warning))]/20" title="Coin Shop">
                <Coins className="h-4 w-4" />
                <span className="text-xs font-semibold">Beli Koin</span>
              </a>
            )}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <button className="rounded-lg bg-secondary p-2 text-secondary-foreground transition hover:bg-secondary/80 active:scale-[0.95]">
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 border-border bg-card">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-foreground">
                    <div className="h-6 w-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                      <img src={logo} alt="RT48" className="h-3 w-3 rounded-full object-cover" />
                    </div>
                    RealTime48
                  </SheetTitle>
                </SheetHeader>

                {coinUser && (
                  <div className="mt-4 rounded-xl border border-border bg-background p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{coinUsername || "User"}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Coins className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />
                          <span className="text-xs font-bold text-[hsl(var(--warning))]">{coinBalance} Koin</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <a href="/profile" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-secondary/80">
                        <User className="h-3.5 w-3.5 text-primary" /> Profil
                      </a>
                      <a href="/coins" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-2 text-xs font-semibold text-[hsl(var(--warning))] transition hover:bg-[hsl(var(--warning))]/20">
                        <Coins className="h-3.5 w-3.5" /> Coin Shop
                      </a>
                    </div>
                  </div>
                )}
                {!coinUser && (
                  <div className="mt-4 rounded-xl border border-border bg-background p-4">
                    <a href="/auth" className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
                      <User className="h-4 w-4" /> Login / Daftar
                    </a>
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  {menuItems.map((item, i) => (
                    <a
                      key={i}
                      href={item.href}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-background p-4 text-left transition hover:border-primary/30 hover:bg-primary/5"
                    >
                      <div className="mt-0.5 shrink-0">{item.icon}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{item.label}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-3">{item.description}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative flex min-h-[70vh] items-center justify-center overflow-hidden pt-16">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0e1a] via-[#0d1226] to-background" />
        {/* Starfield overlay */}
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(1px 1px at 20% 30%, hsl(var(--primary)/0.6) 1px, transparent 0), radial-gradient(1px 1px at 80% 70%, hsl(var(--primary)/0.4) 1px, transparent 0), radial-gradient(1px 1px at 50% 50%, hsl(var(--primary)/0.5) 1px, transparent 0)', backgroundSize: '200px 200px, 150px 150px, 300px 300px' }} />

        {/* Floating particles */}
        <div className="absolute inset-0 overflow-hidden">
          {Array.from({ length: 20 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute h-1 w-1 rounded-full bg-primary/40"
              style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
              animate={{ y: [0, -30, 0], opacity: [0.2, 0.8, 0.2] }}
              transition={{ duration: 3 + Math.random() * 4, repeat: Infinity, delay: Math.random() * 3 }}
            />
          ))}
        </div>

        <div className="relative z-10 text-center px-4">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
            <div className="mx-auto mb-6 h-28 w-28 md:h-36 md:w-36 rounded-full border-[3px] border-[#c9a96e]/60 flex items-center justify-center shadow-[0_0_30px_rgba(201,169,110,0.3),0_0_60px_rgba(201,169,110,0.1)] animate-float overflow-hidden">
              <img src={logo} alt="RT48" className="h-full w-full object-cover" />
            </div>
          </motion.div>
          <motion.h1
            className="mb-3 text-4xl font-extrabold tracking-tight md:text-6xl"
            style={{ lineHeight: "1.05" }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2 }}
          >
            <span className="text-foreground">Real</span><span className="text-primary">Time48</span>
          </motion.h1>
          <motion.p
            className="mx-auto mb-4 max-w-md text-muted-foreground md:text-lg"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.4 }}
          >
            {settings.site_title}
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.6 }}>
            <a
              href="#shows"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 active:scale-[0.97]"
            >
              <Ticket className="h-5 w-5" /> Lihat Show
            </a>
          </motion.div>
        </div>
      </section>

      {/* Announcement Banner */}
      {settings.announcement_enabled === "true" && settings.announcement_text && (
        <section className="px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mx-auto max-w-4xl"
          >
            <div className="relative overflow-hidden rounded-2xl border border-[hsl(var(--warning))]/30 bg-gradient-to-r from-[hsl(var(--warning))]/10 via-[hsl(var(--warning))]/5 to-primary/10 p-5 md:p-6">
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[hsl(var(--warning))]/10 blur-2xl" />
              <div className="absolute -left-6 -bottom-6 h-20 w-20 rounded-full bg-primary/10 blur-2xl" />
              <div className="relative flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--warning))]/20">
                  <Info className="h-5 w-5 text-[hsl(var(--warning))]" />
                </div>
                <div>
                  <h3 className="mb-1.5 text-sm font-bold text-foreground">📢 Pengumuman</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground md:text-sm whitespace-pre-line">
                    {settings.announcement_text}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </section>
      )}

      {/* Regular Shows Section */}
      <section id="shows" className="px-4 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <motion.h2
            className="mb-12 text-center text-3xl font-bold text-foreground md:text-4xl"
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          >
            🎭 Jadwal Show
          </motion.h2>

          {regularShows.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-12 text-center">
              <MessageCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-lg font-medium text-foreground">Belum ada show tersedia</p>
              <p className="mt-2 text-muted-foreground">{settings.purchase_message}</p>
              {settings.whatsapp_number && (
                <a
                  href={`https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent("Halo, saya ingin bertanya tentang streaming")}`}
                  target="_blank" rel="noopener noreferrer"
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-[hsl(var(--success))] px-6 py-3 font-semibold text-primary-foreground transition hover:bg-[hsl(var(--success))]/90"
                >
                  <MessageCircle className="h-4 w-4" /> Hubungi WhatsApp
                </a>
              )}
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {regularShows.map((show, i) => (
                <ShowCard
                  key={show.id}
                  show={show}
                  index={i}
                  isReplayMode={show.is_replay}
                  redeemedToken={redeemedTokens[show.id]}
                  accessPassword={accessPasswords[show.id]}
                  replayPassword={replayPasswords[show.id]}
                  onBuy={handleBuy}
                  onCoinBuy={handleCoinBuy}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Replay Shows Section */}
      {replayShows.length > 0 && (
        <section className="px-4 py-10">
          <div className="mx-auto max-w-6xl">
            <motion.h2
              className="mb-8 text-center text-2xl font-bold text-foreground md:text-3xl"
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            >
              🎬 Replay Show
            </motion.h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {replayShows.map((show, i) => (
                <ShowCard
                  key={show.id}
                  show={show}
                  index={i}
                  isReplayMode={true}
                  redeemedToken={redeemedTokens[show.id]}
                  accessPassword={accessPasswords[show.id]}
                  replayPassword={replayPasswords[show.id]}
                  onBuy={handleBuy}
                  onCoinBuy={handleCoinBuy}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Descriptions Section */}
      {descriptions.length > 0 && (
        <section className="py-10">
          <div className={`mx-auto px-4 ${settings.landing_description_width === "small" ? "max-w-2xl" : settings.landing_description_width === "large" ? "max-w-6xl" : settings.landing_description_width === "full" ? "max-w-full" : "max-w-4xl"}`}>
            {(settings.landing_desc_subtitle || settings.landing_desc_title || settings.landing_desc_quote) && (
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-12 text-center">
                {settings.landing_desc_subtitle && <p className="mb-3 text-sm font-bold uppercase tracking-widest text-primary">{settings.landing_desc_subtitle}</p>}
                {settings.landing_desc_title && (
                  <h2 className="mb-4 text-3xl font-extrabold text-foreground md:text-4xl">
                    {settings.landing_desc_title.split(/(\*[^*]+\*)/).map((part: string, idx: number) =>
                      part.startsWith("*") && part.endsWith("*") ? <span key={idx} className="text-primary">{part.slice(1, -1)}</span> : <span key={idx}>{part}</span>
                    )}
                  </h2>
                )}
                {settings.landing_desc_quote && <p className="mx-auto max-w-2xl text-sm italic text-muted-foreground md:text-base">"{settings.landing_desc_quote}"</p>}
              </motion.div>
            )}

            {settings.landing_desc_layout === "cards" ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {descriptions.map((desc: any, i: number) => (
                  <motion.div key={desc.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}
                    className={`group relative overflow-hidden rounded-2xl border border-primary/20 bg-card/90 backdrop-blur-sm p-6 md:p-8 transition-all duration-300 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10 ${desc.text_align === "right" ? "text-right" : desc.text_align === "center" ? "text-center" : "text-left"}`}>
                    {desc.image_url && <img src={desc.image_url} alt={desc.title} className="mb-4 h-40 w-full rounded-xl object-cover" />}
                    <span className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-2xl ${desc.text_align === "center" ? "mx-auto" : desc.text_align === "right" ? "ml-auto" : ""}`}>{desc.icon}</span>
                    <h3 className="mb-3 text-lg font-bold text-foreground md:text-xl">{desc.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{desc.content}</p>
                  </motion.div>
                ))}
              </div>
            ) : settings.landing_desc_layout === "grid" ? (
              <div className="grid gap-6 md:grid-cols-2">
                {descriptions.map((desc: any, i: number) => (
                  <motion.div key={desc.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }}
                    className={`group overflow-hidden rounded-2xl border border-border bg-card/80 p-6 transition-all hover:border-primary/40 hover:shadow-xl ${desc.text_align === "right" ? "text-right" : desc.text_align === "center" ? "text-center" : "text-left"}`}>
                    {desc.image_url && <img src={desc.image_url} alt={desc.title} className="mb-4 h-40 w-full rounded-xl object-cover" />}
                    <span className="mb-3 inline-block text-3xl">{desc.icon}</span>
                    <h3 className="mb-3 text-xl font-bold text-foreground">{desc.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{desc.content}</p>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {descriptions.map((desc: any, i: number) => (
                  <motion.div key={desc.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.1 }}
                    className={`group relative w-full overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur-sm transition-all duration-300 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 ${desc.text_align === "right" ? "text-right" : desc.text_align === "center" ? "text-center" : "text-left"}`}>
                    {desc.image_url ? (
                      <div className="md:flex">
                        <div className="relative h-52 overflow-hidden md:h-auto md:w-2/5 lg:w-1/3">
                          <img src={desc.image_url} alt={desc.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        </div>
                        <div className="flex flex-1 flex-col justify-center p-6 md:p-8">
                          <span className="mb-3 inline-block text-3xl">{desc.icon}</span>
                          <h3 className="mb-3 text-xl font-bold text-foreground md:text-2xl">{desc.title}</h3>
                          <p className="text-sm text-muted-foreground leading-relaxed md:text-base whitespace-pre-line">{desc.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="p-6 md:p-8">
                        <span className="mb-3 inline-block text-3xl">{desc.icon}</span>
                        <h3 className="mb-3 text-xl font-bold text-foreground md:text-2xl">{desc.title}</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed md:text-base whitespace-pre-line">{desc.content}</p>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 md:grid-cols-3">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shadow-[0_0_8px_hsl(var(--primary)/0.3)]">
                  <img src={logo} alt="RT48" className="h-4 w-4 rounded-full object-cover" />
                </div>
                <span className="text-sm font-bold text-foreground">Real<span className="text-primary">Time48</span></span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">Platform streaming eksklusif dengan keamanan tinggi. Nikmati live show dan replay kapanpun.</p>
            </div>
            {/* Links */}
            <div>
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Navigasi</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Jadwal Show", href: "/schedule" },
                  { label: "Replay", href: "/replay" },
                  { label: "Coin Shop", href: "/coins" },
                  { label: "Membership", href: "/membership" },
                  { label: "FAQ", href: "/faq" },
                  { label: "Tentang", href: "/about" },
                  { label: "Install App", href: "/install" },
                ].map(l => (
                  <a key={l.href} href={l.href} className="text-xs text-muted-foreground hover:text-primary transition">{l.label}</a>
                ))}
              </div>
            </div>
            {/* Contact */}
            <div>
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Hubungi Kami</h4>
              <div className="space-y-2">
                {settings.whatsapp_number && (
                  <a href={`https://wa.me/${settings.whatsapp_number}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-[hsl(var(--success))] transition">
                    <Phone className="h-3 w-3" /> WhatsApp Admin
                  </a>
                )}
                {settings.whatsapp_channel && (
                  <a href={settings.whatsapp_channel} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition">
                    <Radio className="h-3 w-3" /> Saluran WhatsApp
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="mt-8 border-t border-border pt-4 text-center">
            <p className="text-[10px] text-muted-foreground">© {new Date().getFullYear()} RealTime48 • Secure Streaming Platform</p>
          </div>
        </div>
      </footer>

      <InstallBanner />

      {/* Purchase Modal */}
      {selectedShow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6"
          >
            <h3 className="mb-1 text-lg font-bold text-foreground">{selectedShow.title}</h3>
            <p className="mb-4 text-sm text-muted-foreground">{selectedShow.price}</p>

            {!selectedShow.is_subscription && purchaseStep === "info" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-sm text-muted-foreground">
                    Silakan scan QRIS di bawah, lalu kirim bukti transfer secara manual ke admin via WhatsApp.
                  </p>
                </div>
                {selectedShow.qris_image_url ? (
                  <img src={selectedShow.qris_image_url} alt="QRIS" className="mx-auto w-full max-w-sm rounded-lg object-contain" />
                ) : (
                  <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">
                    QRIS belum tersedia
                  </div>
                )}
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" /> Email Anda
                  </label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" className="bg-background" />
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="mb-2 text-xs font-semibold text-foreground">📋 Ringkasan Pesanan</p>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>🎭 {selectedShow.title}</p>
                    <p>💰 {selectedShow.price}</p>
                    {selectedShow.schedule_date && <p>📅 {selectedShow.schedule_date} {selectedShow.schedule_time}</p>}
                    {selectedShow.lineup && <p>👥 {selectedShow.lineup}</p>}
                  </div>
                </div>
                <Button onClick={handleConfirmRegular} disabled={!email.trim()} className="w-full gap-2 bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90 text-primary-foreground">
                  <MessageCircle className="h-4 w-4" /> Kirim Pesanan via WhatsApp
                </Button>
                <p className="text-[10px] text-center text-muted-foreground">
                  * Anda akan diarahkan ke WhatsApp
                </p>
              </div>
            )}

            {selectedShow.is_subscription && purchaseStep === "qris" && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Silakan scan QRIS di bawah untuk melakukan pembayaran:</p>
                {selectedShow.qris_image_url ? (
                  <img src={selectedShow.qris_image_url} alt="QRIS" className="mx-auto w-full max-w-sm rounded-lg object-contain" />
                ) : (
                  <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">QRIS belum tersedia</div>
                )}
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-4 text-sm font-medium text-primary transition hover:border-primary hover:bg-primary/10"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*,.heic,.heif";
                    input.capture = "environment";
                    input.onchange = (e) => handleUploadProof(e as any);
                    input.click();
                  }}
                  disabled={uploadingProof}
                >
                  <Upload className="h-4 w-4" />
                  {uploadingProof ? "Mengupload..." : "Upload Bukti Pembayaran"}
                </button>
              </div>
            )}

            {purchaseStep === "info" && selectedShow.is_subscription && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-[hsl(var(--success))]">
                  <CheckCircle className="h-4 w-4" /> Bukti pembayaran berhasil diupload
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Nomor HP</label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="bg-background" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" className="bg-background" />
                </div>
                <Button onClick={handleSubmitSubscription} disabled={!phone || !email} className="w-full">
                  Kirim Data Langganan
                </Button>
              </div>
            )}

            {purchaseStep === "done" && selectedShow.is_subscription && (
              <div className="space-y-4 text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
                <h4 className="text-lg font-bold text-foreground">Pendaftaran Berhasil!</h4>
                <p className="text-sm text-muted-foreground">Admin akan mengkonfirmasi pembayaran Anda.</p>
              </div>
            )}

            <button
              onClick={() => setSelectedShow(null)}
              className="mt-4 w-full rounded-xl bg-secondary py-3 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80"
            >
              Tutup
            </button>
          </motion.div>
        </div>
      )}

      {/* Coin Purchase Dialog */}
      <Dialog open={!!coinShowTarget} onOpenChange={() => { setCoinShowTarget(null); setCoinResult(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>🪙 Beli dengan Koin</DialogTitle>
            <DialogDescription>{coinShowTarget?.title}</DialogDescription>
          </DialogHeader>
          {!coinResult ? (
            <div className="space-y-4">
              {coinShowTarget?.qris_image_url && (
                <div className="text-center">
                  <p className="text-xs font-medium text-muted-foreground mb-2">📱 Scan QRIS untuk pembayaran</p>
                  <img src={coinShowTarget.qris_image_url} alt="QRIS" className="mx-auto max-h-48 rounded-lg object-contain" />
                </div>
              )}
              <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Show</span>
                  <span className="font-semibold text-foreground">{coinShowTarget?.title}</span>
                </div>
                {coinShowTarget?.schedule_date && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Jadwal</span>
                    <span className="text-foreground">{coinShowTarget.schedule_date} {coinShowTarget.schedule_time}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Harga</span>
                  <span className="font-bold text-[hsl(var(--warning))]">{coinShowTarget?.coin_price} Koin</span>
                </div>
                <div className="flex items-center justify-between text-sm border-t border-border pt-2">
                  <span className="text-muted-foreground">Saldo Anda</span>
                  <span className={`font-bold ${coinBalance >= (coinShowTarget?.coin_price || 0) ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                    {coinBalance} Koin
                  </span>
                </div>
              </div>
              {coinBalance < (coinShowTarget?.coin_price || 0) ? (
                <div className="space-y-3">
                  <p className="text-center text-sm text-destructive">Koin tidak cukup.</p>
                  <Button className="w-full" variant="outline" onClick={() => { setCoinShowTarget(null); window.location.href = "/coins"; }}>
                    <Coins className="mr-2 h-4 w-4" /> Beli Koin
                  </Button>
                </div>
              ) : (
                <Button className="w-full gap-2" onClick={handleCoinRedeem} disabled={coinRedeeming}>
                  <Coins className="h-4 w-4" />
                  {coinRedeeming ? "Memproses..." : `Bayar ${coinShowTarget?.coin_price} Koin`}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
              <p className="font-semibold text-foreground">Pembelian Berhasil!</p>
              <div className="rounded-lg bg-secondary p-4">
                <p className="font-mono text-lg font-bold text-primary">{coinResult.token_code}</p>
              </div>
              {coinResult.replay_password && (
                <div className="rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">🔐 Sandi Replay</p>
                  <p className="font-mono text-lg font-bold text-[hsl(var(--warning))]">{coinResult.replay_password}</p>
                </div>
              )}
              {coinResult.access_password && (
                <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">🔐 Sandi Akses Show</p>
                  <p className="font-mono text-lg font-bold text-primary">{coinResult.access_password}</p>
                </div>
              )}
              <div className="flex gap-2">
                <Button className="flex-1 gap-2" variant="outline"
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/live?t=${coinResult.token_code}`); toast.success("Link disalin!"); }}>
                  <Copy className="h-4 w-4" /> Salin Link
                </Button>
                <Button className="flex-1 gap-2" asChild>
                  <a href={`/live?t=${coinResult.token_code}`}>
                    <Play className="h-4 w-4" /> Tonton
                  </a>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
