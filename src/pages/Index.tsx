import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompressor";
import { motion, AnimatePresence } from "framer-motion";
import { cachedQuery, invalidateCache, preloadLandingData, fetchCachedEndpoint } from "@/lib/queryCache";
import {
  getInstallPrompt,
  clearInstallPrompt,
  onInstallPromptChange,
  waitForInstallPrompt,
  isAppInstalled,
} from "@/lib/installPrompt";
import { usePurchasedShows } from "@/hooks/usePurchasedShows";
import LandingFloatingEmojis from "@/components/viewer/LandingFloatingEmojis";
import ConnectionStatus from "@/components/viewer/ConnectionStatus";

import LiveViewerCount from "@/components/viewer/LiveViewerCount";

import LiveNowBanner from "@/components/viewer/LiveNowBanner";
import ViewerBroadcast from "@/components/viewer/ViewerBroadcast";
import LandingStats from "@/components/viewer/LandingStats";
import {
  Calendar, Clock, Users, MessageCircle, Ticket, Star, Upload, CheckCircle, Crown, Sparkles,
  Menu, X, Phone, Info, Radio, CreditCard, Mail, Coins, User, Copy, Play, Lock, Film, Home, Settings, Download, LogIn, Loader2,
} from "lucide-react";
import logo from "@/assets/logo.png";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Show } from "@/types/show";
import ShowCard from "@/components/viewer/ShowCard";
import InstallBanner from "@/components/viewer/InstallBanner";
import BundleShowCard from "@/components/viewer/BundleShowCard";
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
  const [activeShowId, setActiveShowId] = useState<string | null>(null);
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
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [proofFilePath, setProofFilePath] = useState("");
  const [orderShortId, setOrderShortId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Dynamic QRIS state
  const [dynamicQrisStep, setDynamicQrisStep] = useState<"phone" | "qris" | "done">("phone");
  const [dynamicQrString, setDynamicQrString] = useState("");
  const [dynamicOrderId, setDynamicOrderId] = useState("");
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [dynamicPaid, setDynamicPaid] = useState(false);
  const [QRCodeSVG, setQRCodeSVG] = useState<any>(null);

  // Coin & purchase state from DB + localStorage
  const {
    coinUser, coinBalance, coinUsername, redeemedTokens, accessPasswords, replayPasswords,
    addRedeemedToken, addAccessPassword, addReplayPassword, setCoinBalance,
    membershipToken, bundleToken, customToken,
  } = usePurchasedShows();
  const [coinShowTarget, setCoinShowTarget] = useState<Show | null>(null);
  const [coinRedeeming, setCoinRedeeming] = useState(false);
  const [coinResult, setCoinResult] = useState<{ token_code: string; remaining_balance: number; replay_password?: string; access_password?: string } | null>(null);
  const [coinPhone, setCoinPhone] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loginPopup, setLoginPopup] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(getInstallPrompt());
  const [isStandalone, setIsStandalone] = useState(false);

  const fetchData = async () => {
    // Use preloaded data (already started fetching on module import)
    const cachedData = await preloadLandingData();

    if (cachedData?.shows) {
      // All data from a single cached edge function call (0 direct DB queries!)
      setShows(cachedData.shows as Show[]);
      if (cachedData.isStreamLive !== undefined) setIsStreamLive(cachedData.isStreamLive);
      if (cachedData.descriptions) setDescriptions(cachedData.descriptions);
      if (cachedData.settings) {
        setSettings((prev) => ({ ...prev, ...cachedData.settings }));
        if (cachedData.settings.active_show_id) setActiveShowId(cachedData.settings.active_show_id);
      }
      return;
    }

    // Fallback: direct DB queries (only if edge function unavailable)
    const [showsData, streamRes] = await Promise.all([
      cachedQuery("public_shows", async () => {
        const { data } = await supabase.rpc("get_public_shows");
        return data || [];
      }, 30_000),
      (supabase.rpc as any)("get_stream_status"),
    ]);
    setShows(showsData as Show[]);
    if (streamRes.data) setIsStreamLive((streamRes.data as any)?.is_live || false);

    // Stagger non-critical
    setTimeout(async () => {
      const [settingsRes, descRes] = await Promise.all([
        supabase.from("site_settings").select("*"),
        supabase.from("landing_descriptions").select("*").eq("is_active", true).order("sort_order"),
      ]);
      if (descRes.data) setDescriptions(descRes.data as any[]);
      if (settingsRes.data) {
        const s: any = {};
        settingsRes.data.forEach((row: any) => { s[row.key] = row.value; });
        setSettings((prev) => ({ ...prev, ...s }));
        if (s.active_show_id) setActiveShowId(s.active_show_id);
      }
    }, 300);
  };

  // Load QR component for dynamic QRIS
  useEffect(() => {
    import("qrcode.react").then(mod => setQRCodeSVG(() => mod.QRCodeSVG));
  }, []);

  // Poll dynamic QRIS payment status
  useEffect(() => {
    if (!dynamicOrderId || dynamicPaid) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("subscription_orders")
        .select("payment_status, status")
        .eq("id", dynamicOrderId)
        .maybeSingle();
      if (data && (data.payment_status === "paid" || data.status === "confirmed")) {
        setDynamicPaid(true);
        clearInterval(interval);
        toast.success("✅ Pembayaran berhasil dikonfirmasi!");
        setTimeout(() => setDynamicQrisStep("done"), 1500);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [dynamicOrderId, dynamicPaid]);

  useEffect(() => {
    fetchData();

    setIsStandalone(isAppInstalled());
    const unsub = onInstallPromptChange((p) => {
      setInstallPrompt(p);
    });

    const handleInstalled = () => {
      setIsStandalone(true);
      setInstallPrompt(null);
    };

    // Single combined realtime channel instead of 4 separate ones — reduces DB connections
    const realtimeCh = supabase.channel("idx-combined")
      .on("postgres_changes", { event: "*", schema: "public", table: "shows" }, () => { invalidateCache("public_shows"); fetchData(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "streams" }, (payload: any) => {
        if (payload.new?.is_live !== undefined) setIsStreamLive(payload.new.is_live);
      })
      .subscribe();

    // Poll for settings/descriptions changes every 60s instead of realtime (less DB pressure)
    const settingsPoll = setInterval(() => {
      fetchCachedEndpoint("landing").then((data) => {
        if (data?.descriptions) setDescriptions(data.descriptions);
        if (data?.settings) setSettings((prev: any) => ({ ...prev, ...data.settings }));
      }).catch(() => {});
    }, 60_000);

    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      supabase.removeChannel(realtimeCh);
      clearInterval(settingsPoll);
      unsub();
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    const prompt = installPrompt || getInstallPrompt() || await waitForInstallPrompt();
    if (!prompt) {
      window.location.href = "/install";
      return;
    }

    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setIsStandalone(true);
    } finally {
      clearInstallPrompt();
      setInstallPrompt(null);
    }
  };

  const useDynamicQris = settings.use_dynamic_qris === "true";

  const handleBuy = (show: Show) => {
    setSelectedShow(show);
    if (useDynamicQris && !show.is_subscription) {
      setDynamicQrisStep("phone");
      setDynamicQrString("");
      setDynamicOrderId("");
      setDynamicPaid(false);
      setDynamicLoading(false);
      setPurchaseStep("info"); // placeholder, dynamic flow uses dynamicQrisStep
    } else {
      setPurchaseStep(show.is_subscription ? "qris" : "info");
    }
    setProofUrl(""); setProofFilePath("");
    setPhone("");
    setEmail("");
    setUploadingProof(false);
  };

  const handleStartDynamicQrisShow = async () => {
    if (!selectedShow) return;
    setDynamicLoading(true);
    setDynamicQrisStep("qris");
    try {
      const priceNum = selectedShow.qris_price || parseInt(selectedShow.price.replace(/[^\d]/g, "")) || 0;
      if (priceNum <= 0) { toast.error("Harga tidak valid"); setDynamicLoading(false); return; }
      const { data, error } = await supabase.functions.invoke("create-dynamic-qris", {
        body: { show_id: selectedShow.id, amount: priceNum, phone: phone.replace(/^0/, "62").replace(/[^0-9]/g, ""), order_type: "regular" },
      });
      if (error || !data?.success) {
        toast.error(data?.error || "Gagal membuat QRIS");
        setDynamicQrisStep("phone");
        setDynamicLoading(false);
        return;
      }
      setDynamicQrString(data.qr_string);
      setDynamicOrderId(data.order_id);
    } catch (err: any) {
      toast.error("Gagal membuat QRIS: " + (err?.message || "Coba lagi"));
      setDynamicQrisStep("phone");
    }
    setDynamicLoading(false);
  };

  const handleCoinBuy = (show: Show) => {
    if (!coinUser) {
      toast.error("Login terlebih dahulu di halaman /auth");
      return;
    }
    setCoinShowTarget(show);
    setCoinResult(null);
    setCoinPhone("");
  };

  const handleCoinRedeem = async () => {
    if (!coinShowTarget) return;
    if (!coinPhone.trim() || coinPhone.replace(/[\s-]/g, "").length < 10) {
      toast.error("Masukkan nomor WhatsApp yang valid");
      return;
    }
    setCoinRedeeming(true);
    const isReplay = coinShowTarget.is_replay;
    const { data, error } = isReplay
      ? await supabase.rpc("redeem_coins_for_replay", { _show_id: coinShowTarget.id })
      : await supabase.rpc("redeem_coins_for_token", { _show_id: coinShowTarget.id });
    setCoinRedeeming(false);
    const result = data as any;
    if (error || !result?.success) {
      toast.error(result?.error || error?.message || "Gagal menukar koin");
      return;
    }
    setCoinResult({ token_code: result.token_code, remaining_balance: result.remaining_balance, replay_password: result.replay_password, access_password: result.access_password });
    setCoinBalance(result.remaining_balance);

    if (coinUser && result.token_code) {
      addRedeemedToken(coinShowTarget.id, result.token_code);
      if (result.replay_password) addReplayPassword(coinShowTarget.id, result.replay_password);
      if (result.access_password) addAccessPassword(coinShowTarget.id, result.access_password);

      // Send WhatsApp notification with token + replay info
      const purchaseType = coinShowTarget.is_bundle ? "bundle" : coinShowTarget.is_replay ? "replay" : (coinShowTarget.is_subscription ? "membership" : "regular");
      supabase.functions.invoke("notify-coin-show-purchase", {
        body: {
          user_id: coinUser.id,
          show_id: coinShowTarget.id,
          token_code: result.token_code,
          access_password: result.access_password || result.replay_password,
          show_title: coinShowTarget.title,
          purchase_type: purchaseType,
          phone: coinPhone.replace(/[\s-]/g, ""),
        },
      }).then(res => { if (res.error) console.warn("Notify WA error:", res.error); }).catch(e => console.warn("Notify WA failed:", e));
    }
  };

  const openWhatsAppOrderDetail = (show: Show, orderPhone: string, orderEmail: string) => {
    if (!settings.whatsapp_number) return;
    const emailLine = orderEmail ? `\n📧 Email: ${orderEmail}` : '';
    const msg = `📋 *Pesanan Show Baru*\n\n🎭 Show: ${show.title}\n💰 Harga: ${show.price}\n📅 Jadwal: ${show.schedule_date || '-'} ${show.schedule_time || ''}\n👥 Lineup: ${show.lineup || '-'}\n📱 HP: ${orderPhone}${emailLine}\n\nSaya sudah melakukan pembayaran dan mengirim bukti transfer. Mohon dikonfirmasi 🙏`;
    window.open(`https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleSubmitRegular = async () => {
    if (!selectedShow) return;
    let signedUrl = "";
    if (proofFilePath) {
      const { data: urlData } = await supabase.storage.from("payment-proofs").createSignedUrl(proofFilePath, 86400);
      signedUrl = urlData?.signedUrl || "";
    }
    let orderId: string | null = null;
    let shortId: string | null = null;
    try {
      const { data, error } = await supabase.rpc("create_show_order", {
        _show_id: selectedShow.id, _phone: phone, _email: email || null, _payment_proof_url: signedUrl || null,
      });
      const result = data as any;
      if (error || !result?.success) {
        console.error("Order insert error:", error?.message || result);
        toast.error("Gagal menyimpan pesanan: " + (error?.message || "Coba lagi"));
      } else {
        orderId = result.order_id;
        shortId = result.short_id;
        setOrderShortId(shortId || "");
        toast.success("✅ Pesanan berhasil dikirim! Admin akan segera memproses.");
      }
    } catch (e: any) {
      console.error("Order insert exception:", e);
      toast.error("Gagal menyimpan pesanan: " + (e?.message || "Coba lagi"));
    }
    setPurchaseStep("done");
    if (orderId) {
      supabase.functions.invoke("notify-subscription-order", {
        body: { order_id: orderId, show_title: selectedShow.title, phone, email: email || null, proof_file_path: proofFilePath || null, proof_bucket: "payment-proofs", order_type: "show", schedule_date: selectedShow.schedule_date || null, schedule_time: selectedShow.schedule_time || null },
      }).catch((e) => console.warn("Notify error:", e));
    }
    openWhatsAppOrderDetail(selectedShow, phone, email);
  };

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile || !selectedShow) return;
    if (rawFile.size > 5 * 1024 * 1024) { toast.error("File terlalu besar (max 5MB)"); return; }
    setUploadingProof(true);
    try {
      const file = await compressImage(rawFile);
      const ext = file.name.split(".").pop();
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("payment-proofs").upload(path, file);
      if (error) throw error;
      const { data: urlData } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 86400);
      setProofUrl(urlData?.signedUrl || "");
      setProofFilePath(path);
      setPurchaseStep("info");
    } catch {
      toast.error("Upload gagal, coba lagi");
    }
    setUploadingProof(false);
  };

  const handleSubmitSubscription = async () => {
    if (!selectedShow || !proofFilePath) return;
    const { data: urlData } = await supabase.storage.from("payment-proofs").createSignedUrl(proofFilePath, 86400);
    const signedUrl = urlData?.signedUrl || "";
    let orderId: string | null = null;
    let shortId: string | null = null;
    try {
      const { data, error } = await supabase.rpc("create_show_order", {
        _show_id: selectedShow.id, _phone: phone, _email: email || null, _payment_proof_url: signedUrl || null,
      });
      const result = data as any;
      if (error || !result?.success) {
        console.error("Order insert error:", error?.message || result);
        toast.error("Gagal menyimpan pesanan: " + (error?.message || "Coba lagi"));
      } else {
        orderId = result.order_id;
        shortId = result.short_id;
        setOrderShortId(shortId || "");
        toast.success("✅ Pesanan berhasil dikirim! Admin akan segera memproses.");
      }
    } catch (e: any) {
      console.error("Order insert exception:", e);
      toast.error("Gagal menyimpan pesanan: " + (e?.message || "Coba lagi"));
    }
    setPurchaseStep("done");
    if (orderId) {
      supabase.functions.invoke("notify-subscription-order", {
        body: { order_id: orderId, show_title: selectedShow.title, phone, email, proof_file_path: proofFilePath, proof_bucket: "payment-proofs", order_type: "subscription", schedule_date: selectedShow.schedule_date || null, schedule_time: selectedShow.schedule_time || null },
      }).then(res => { if (res.error) console.warn("Notify sub error:", res.error); }).catch(e => console.warn("Notify sub failed:", e));
    }
    openWhatsAppOrderDetail(selectedShow, phone, email);
  };

  // Parse Indonesian date format like "28 Juni 2025" + "20.00 WIB" into a timestamp
  const parseShowSchedule = (s: Show): number => {
    if (!s.schedule_date) return Infinity;
    const months: Record<string, number> = {
      januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
      juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
    };
    const parts = s.schedule_date.trim().toLowerCase().split(/\s+/);
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = months[parts[1]];
      const year = parseInt(parts[2]);
      if (!isNaN(day) && month !== undefined && !isNaN(year)) {
        let hour = 0, minute = 0;
        if (s.schedule_time) {
          const t = s.schedule_time.replace(/\s*WIB\s*/i, "").replace(".", ":");
          const tp = t.split(":");
          hour = parseInt(tp[0]) || 0;
          minute = parseInt(tp[1]) || 0;
        }
        return new Date(year, month, day, hour, minute).getTime();
      }
    }
    // Fallback: try native Date parse
    try {
      const d = new Date(s.schedule_date).getTime();
      return isNaN(d) ? Infinity : d;
    } catch { return Infinity; }
  };

  const sortBySchedule = (list: Show[]) => {
    const now = Date.now();
    return [...list].sort((a, b) => {
      // Live shows always on top
      const aIsLive = isStreamLive && !a.is_replay;
      const bIsLive = isStreamLive && !b.is_replay;
      if (aIsLive && !bIsLive) return -1;
      if (!aIsLive && bIsLive) return 1;

      const tA = parseShowSchedule(a);
      const tB = parseShowSchedule(b);
      // Upcoming shows first (closest future), then past shows (most recent first)
      const aFuture = tA >= now;
      const bFuture = tB >= now;
      if (aFuture && bFuture) return tA - tB; // both future: nearest first
      if (aFuture && !bFuture) return -1; // a is future, b is past
      if (!aFuture && bFuture) return 1;
      return tB - tA; // both past: most recent first
    });
  };

  // Universal access token for membership/bundle/custom users
  const universalToken = membershipToken || bundleToken || customToken || null;

  const regularShows = sortBySchedule(shows.filter((s) => !s.is_subscription && !s.is_replay && !s.is_bundle));
  const replayShows = sortBySchedule(shows.filter((s) => !s.is_subscription && s.is_replay && s.replay_coin_price > 0 && !s.is_bundle));
  const membershipShows = shows.filter((s) => s.is_subscription && !s.is_bundle);
  const bundleShows = sortBySchedule(shows.filter((s) => s.is_bundle));
  const hasMembershipOpen = membershipShows.some((s) => !s.is_order_closed);

  const menuItems = [
    { icon: <Home className="h-5 w-5 text-primary" />, label: "Beranda", description: "Halaman utama", href: "/" },
    { icon: <Calendar className="h-5 w-5 text-primary" />, label: "Jadwal Show", description: "Lihat jadwal & countdown", href: "/schedule" },
    { icon: <Crown className="h-5 w-5 text-yellow-500" />, label: "Membership", description: membershipShows.length > 0 ? (hasMembershipOpen ? `${membershipShows.length} paket tersedia` : "Pendaftaran ditutup") : "Belum tersedia", href: "/membership" },
    { icon: <Film className="h-5 w-5 text-accent" />, label: "Replay Show", description: `Tonton ulang show${replayShows.length > 0 ? ` (${replayShows.length})` : ""}`, href: "/replay" },
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
      <ViewerBroadcast />
      <LandingFloatingEmojis />
      <LiveNowBanner isLive={isStreamLive} />

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-full border border-border/60 overflow-hidden shadow-sm">
              <img src={logo} alt="RT48" className="h-full w-full object-cover" />
            </div>
            <span className="text-sm font-bold text-foreground">Real<span className="text-primary">Time48</span></span>
          </div>
          <div className="flex items-center gap-2">
            <LiveViewerCount isLive={isStreamLive} readOnly />
            
            {!sheetOpen && coinUser && (
              <a href="/coins" className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5 text-[hsl(var(--warning))] transition hover:bg-[hsl(var(--warning))]/20" title="Coin Shop">
                <Coins className="h-4 w-4" />
                <span className="text-xs font-semibold">{coinBalance}</span>
              </a>
            )}
            {!sheetOpen && !coinUser && (
              <button
                onClick={() => setLoginPopup(true)}
                className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5 text-[hsl(var(--warning))] transition hover:bg-[hsl(var(--warning))]/20"
              >
                <Coins className="h-4 w-4" />
                <span className="text-xs font-semibold">Beli Koin</span>
              </button>
            )}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <button className="rounded-lg bg-secondary p-2 text-secondary-foreground transition hover:bg-secondary/80 active:scale-[0.95]">
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 border-border bg-card p-0 flex flex-col">
                <SheetHeader className="px-6 pt-6 pb-2">
                  <SheetTitle className="flex items-center gap-2 text-foreground">
                    <div className="h-7 w-7 rounded-full border border-border/60 overflow-hidden">
                      <img src={logo} alt="RT48" className="h-full w-full object-cover" />
                    </div>
                    RealTime48
                  </SheetTitle>
                </SheetHeader>

                <ScrollArea className="flex-1 px-6 pb-6">
                  {coinUser ? (
                    <div className="mt-2 rounded-xl border border-border bg-background p-4">
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
                  ) : (
                    <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                          <LogIn className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">Belum Login</p>
                          <p className="text-xs text-muted-foreground">Login untuk akses semua fitur</p>
                        </div>
                      </div>
                      <a href="/auth" className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition active:scale-[0.98]">
                        <LogIn className="h-4 w-4" /> Login / Daftar
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
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>

      {/* Hero Section with Parallax */}
      <section className="relative flex min-h-[50vh] md:min-h-[60vh] items-center justify-center overflow-hidden pt-14">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0e1a] via-[#0d1226] to-background animate-gradient" />
        {/* Starfield overlay */}
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(1px 1px at 20% 30%, hsl(var(--primary)/0.6) 1px, transparent 0), radial-gradient(1px 1px at 80% 70%, hsl(var(--primary)/0.4) 1px, transparent 0), radial-gradient(1px 1px at 50% 50%, hsl(var(--primary)/0.5) 1px, transparent 0)', backgroundSize: '200px 200px, 150px 150px, 300px 300px' }} />

        {/* Glow orbs */}
        <div className="absolute top-1/4 left-1/4 h-64 w-64 rounded-full bg-primary/10 blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 h-48 w-48 rounded-full bg-accent/8 blur-[80px]" />

        {/* Floating particles */}
        <div className="absolute inset-0 overflow-hidden">
          {Array.from({ length: 25 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                width: `${2 + Math.random() * 3}px`,
                height: `${2 + Math.random() * 3}px`,
                background: `hsl(var(--primary) / ${0.2 + Math.random() * 0.4})`,
              }}
              animate={{ y: [0, -40, 0], opacity: [0.1, 0.8, 0.1], scale: [1, 1.5, 1] }}
              transition={{ duration: 3 + Math.random() * 5, repeat: Infinity, delay: Math.random() * 4 }}
            />
          ))}
        </div>

        <div className="relative z-10 text-center px-4">
          <motion.div initial={{ opacity: 0, y: 30, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 1, type: "spring" }}>
            <div className="mx-auto mb-4 h-24 w-24 md:h-32 md:w-32 rounded-full border-[3px] border-[#c9a96e]/60 flex items-center justify-center shadow-[0_0_40px_rgba(201,169,110,0.3),0_0_80px_rgba(201,169,110,0.1)] animate-float overflow-hidden">
              <img src={logo} alt="RT48" className="h-full w-full object-cover" />
            </div>
          </motion.div>
          <motion.h1
            className="mb-3 text-4xl font-extrabold tracking-tight font-heading md:text-6xl"
            style={{ lineHeight: "1.05" }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2 }}
          >
            <span className="text-foreground">Real</span><span className="text-primary">Time48</span>
          </motion.h1>
          <motion.p
            className="mx-auto mb-4 max-w-md text-sm text-muted-foreground md:text-base"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.4 }}
          >
            {settings.site_title}
          </motion.p>
          <motion.div
            className="flex items-center justify-center gap-3"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.6 }}
          >
            <a
              href="#shows"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97]"
            >
              <Ticket className="h-5 w-5" /> Lihat Show
            </a>
          </motion.div>
        </div>
      </section>

      {/* Announcement Banner - Prominent, above descriptions */}
      {settings.announcement_enabled === "true" && settings.announcement_text && (
        <section className="px-4 py-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="mx-auto max-w-4xl"
          >
            <div className="relative overflow-hidden rounded-2xl border-2 border-[hsl(var(--warning))]/50 bg-gradient-to-r from-[hsl(var(--warning))]/15 via-[hsl(var(--warning))]/10 to-primary/15 p-5 md:p-7 shadow-lg shadow-[hsl(var(--warning))]/10">
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[hsl(var(--warning))]/15 blur-2xl" />
              <div className="absolute -left-8 -bottom-8 h-28 w-28 rounded-full bg-primary/15 blur-2xl" />
              <div className="relative flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--warning))]/25 ring-2 ring-[hsl(var(--warning))]/20">
                  <Info className="h-6 w-6 text-[hsl(var(--warning))]" />
                </div>
                <div className="min-w-0">
                  <h3 className="mb-2 text-base font-extrabold text-foreground md:text-lg">📢 Pengumuman</h3>
                  <p className="text-sm leading-relaxed text-foreground/80 md:text-base whitespace-pre-line">
                    {settings.announcement_text}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </section>
      )}

      {/* Descriptions Section - ABOVE shows */}
      {descriptions.length > 0 && (
        <section className="py-8 md:py-10">
          <div className={`mx-auto px-4 ${settings.landing_description_width === "small" ? "max-w-2xl" : settings.landing_description_width === "large" ? "max-w-6xl" : settings.landing_description_width === "full" ? "max-w-full" : "max-w-4xl"}`}>
            {(settings.landing_desc_subtitle || settings.landing_desc_title || settings.landing_desc_quote) && (
              <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-8 text-center">
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
                    className={`group relative overflow-hidden rounded-2xl glass p-6 md:p-8 transition-all duration-300 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10 ${desc.text_align === "right" ? "text-right" : desc.text_align === "center" ? "text-center" : desc.text_align === "justify" ? "text-justify" : "text-left"}`}>
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
                    className={`group overflow-hidden rounded-2xl border border-border bg-card/80 p-6 transition-all hover:border-primary/40 hover:shadow-xl ${desc.text_align === "right" ? "text-right" : desc.text_align === "center" ? "text-center" : desc.text_align === "justify" ? "text-justify" : "text-left"}`}>
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
                    className={`group relative w-full overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur-sm transition-all duration-300 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 ${desc.text_align === "right" ? "text-right" : desc.text_align === "center" ? "text-center" : desc.text_align === "justify" ? "text-justify" : "text-left"}`}>
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

      {/* Membership Banner */}
      <section className="px-4 pb-6">
        <div className="mx-auto max-w-6xl">
          <motion.div
            className={`rounded-2xl border p-6 text-center ${hasMembershipOpen ? "border-yellow-500/30 bg-gradient-to-r from-yellow-500/10 via-yellow-500/5 to-primary/5" : "border-border bg-card/50"}`}
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          >
            <Crown className={`mx-auto mb-2 h-8 w-8 ${hasMembershipOpen ? "text-yellow-500" : "text-muted-foreground"}`} />
            {membershipShows.length > 0 ? (
              hasMembershipOpen ? (
                <>
                  <h3 className="text-lg font-bold text-foreground mb-1">👑 Membership Dibuka!</h3>
                  <p className="text-sm text-muted-foreground mb-4">{membershipShows.filter(s => !s.is_order_closed).length} paket membership tersedia</p>
                  <a href="/membership" className="inline-flex items-center gap-2 rounded-xl bg-yellow-500 px-6 py-2.5 text-sm font-bold text-background transition hover:bg-yellow-500/90 active:scale-[0.97]">
                    <Crown className="h-4 w-4" /> Lihat Membership
                  </a>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-foreground mb-1">Membership Ditutup</h3>
                  <p className="text-sm text-muted-foreground">Pendaftaran membership sedang tidak tersedia. Pantau terus untuk info terbaru.</p>
                </>
              )
            ) : (
              <>
                <h3 className="text-lg font-bold text-foreground mb-1">Membership Belum Tersedia</h3>
                <p className="text-sm text-muted-foreground">Belum ada paket membership saat ini. Pantau terus untuk update terbaru.</p>
              </>
            )}
          </motion.div>
        </div>
      </section>

      {/* Regular Shows Section */}
      <section id="shows" className="px-4 py-10 md:py-16">
        <div className="mx-auto max-w-6xl">
          <a href="/schedule" className="block mb-8 text-center no-underline group">
            <motion.h2
              className="text-2xl font-bold text-foreground md:text-3xl inline-flex items-center gap-2 group-hover:text-primary transition-colors"
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            >
              🎭 Jadwal Show
              <Calendar className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </motion.h2>
          </a>

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
                  redeemedToken={redeemedTokens[show.id] || (!show.is_replay ? universalToken : null) || undefined}
                  accessPassword={accessPasswords[show.id]}
                  replayPassword={replayPasswords[show.id]}
                  onBuy={handleBuy}
                  onCoinBuy={handleCoinBuy}
                  isLive={isStreamLive && show.id === activeShowId}
                  isUniversalAccess={!!universalToken}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Bundle Shows Section */}
      {bundleShows.length > 0 && (
        <section className="px-4 py-8">
          <div className="mx-auto max-w-6xl">
            <motion.h2
              className="mb-6 text-center text-2xl font-bold text-foreground md:text-3xl"
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            >
              📦 Paket Bundle
            </motion.h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {bundleShows.map((show, i) => (
                <BundleShowCard
                  key={show.id}
                  show={show}
                  index={i}
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

      {/* Replay Shows Section - Link to /replay */}
      {replayShows.length > 0 && (
        <section className="px-4 py-8">
          <div className="mx-auto max-w-6xl">
            <motion.div
              className="rounded-2xl border border-border bg-card p-8 text-center"
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            >
              <Film className="mx-auto mb-3 h-10 w-10 text-primary" />
              <h2 className="text-2xl font-bold text-foreground mb-2">🎬 Replay Show</h2>
              <p className="text-sm text-muted-foreground mb-4">{replayShows.length} show tersedia untuk ditonton ulang</p>
              <a
                href="/replay"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.97]"
              >
                <Play className="h-4 w-4" /> Lihat Semua Replay
              </a>
            </motion.div>
          </div>
        </section>
      )}

      {/* Stats Section */}
      <LandingStats />

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

            {/* Hidden file input for gallery */}
            <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { handleUploadProof(e as any); if (galleryInputRef.current) galleryInputRef.current.value = ""; }} />

            {/* Dynamic QRIS flow for regular shows */}
            {useDynamicQris && !selectedShow.is_subscription && dynamicQrisStep === "phone" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-sm text-muted-foreground">Pembayaran otomatis via QRIS dinamis. Masukkan nomor WhatsApp Anda.</p>
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" /> Nomor WhatsApp <span className="text-destructive">*</span>
                  </label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="bg-background" />
                </div>
                <Button onClick={handleStartDynamicQrisShow} disabled={!phone.trim()} className="w-full">
                  Lanjut ke Pembayaran
                </Button>
              </div>
            )}

            {useDynamicQris && !selectedShow.is_subscription && dynamicQrisStep === "qris" && (
              <div className="space-y-4">
                {dynamicLoading ? (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Membuat QRIS...</p>
                  </div>
                ) : dynamicPaid ? (
                  <div className="space-y-3 text-center py-4">
                    <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
                    <p className="font-semibold text-foreground">Pembayaran Berhasil!</p>
                    <p className="text-sm text-muted-foreground">Pesanan dikonfirmasi otomatis. Token dikirim via WhatsApp.</p>
                  </div>
                ) : dynamicQrString && QRCodeSVG ? (
                  <>
                    <p className="text-sm text-muted-foreground">Scan QRIS di bawah untuk membayar:</p>
                    <div className="flex justify-center rounded-lg border border-border bg-white p-4">
                      <QRCodeSVG value={dynamicQrString} size={240} level="M" />
                    </div>
                    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Menunggu pembayaran...
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <p className="mb-2 text-xs font-semibold text-foreground">📋 Ringkasan Pesanan</p>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>🎭 {selectedShow.title}</p>
                        <p>💰 {selectedShow.price}</p>
                        {selectedShow.schedule_date && <p>📅 {selectedShow.schedule_date} {selectedShow.schedule_time}</p>}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">
                    QRIS gagal dimuat
                  </div>
                )}
              </div>
            )}

            {useDynamicQris && !selectedShow.is_subscription && dynamicQrisStep === "done" && (
              <div className="space-y-4 text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
                <h4 className="text-lg font-bold text-foreground">Pembayaran Berhasil!</h4>
                <p className="text-sm text-muted-foreground">Pesanan telah dikonfirmasi otomatis. Token akses akan dikirim via WhatsApp.</p>
              </div>
            )}

            {/* Regular show: Static QRIS + Phone + optional upload in one step */}
            {!useDynamicQris && !selectedShow.is_subscription && purchaseStep === "info" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-sm text-muted-foreground">
                    Silakan scan QRIS di bawah, lalu isi data dan kirim pesanan.
                  </p>
                </div>
                {selectedShow.qris_image_url ? (
                  <img src={selectedShow.qris_image_url} alt="QRIS" className="mx-auto w-full max-w-sm rounded-lg object-contain" />
                ) : (
                  <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">
                    QRIS belum tersedia
                  </div>
                )}
                <div className="rounded-xl border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 p-3">
                  <p className="text-xs font-semibold text-[hsl(var(--warning))] mb-1">⚠️ Penting!</p>
                  <p className="text-xs text-muted-foreground">
                    Masukkan nomor HP WhatsApp yang <strong>aktif dan benar</strong>. Admin akan mengirimkan <strong>link live streaming dan token akses</strong> ke nomor ini setelah pembayaran dikonfirmasi.
                  </p>
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" /> Nomor WhatsApp <span className="text-destructive">*</span>
                  </label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="bg-background" />
                  <p className="mt-1 text-[10px] text-muted-foreground">Contoh: 081234567890 atau 628123456789</p>
                </div>
                {/* Optional proof upload - gallery only */}
                {proofFilePath ? (
                  <div className="flex items-center gap-2 text-sm text-[hsl(var(--success))]">
                    <CheckCircle className="h-4 w-4" /> Bukti pembayaran berhasil diupload
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/10 px-5 py-5 text-base font-semibold text-primary transition hover:border-primary hover:bg-primary/20"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={uploadingProof}
                  >
                    <Upload className="h-5 w-5" /> {uploadingProof ? "Mengupload..." : "📷 Upload Bukti Pembayaran (opsional)"}
                  </button>
                )}
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="mb-2 text-xs font-semibold text-foreground">📋 Ringkasan Pesanan</p>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>🎭 {selectedShow.title}</p>
                    <p>💰 {selectedShow.price}</p>
                    {selectedShow.schedule_date && <p>📅 {selectedShow.schedule_date} {selectedShow.schedule_time}</p>}
                    {selectedShow.lineup && <p>👥 {selectedShow.lineup}</p>}
                  </div>
                </div>
                <Button onClick={handleSubmitRegular} disabled={!phone.trim()} className="w-full gap-2 bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90 text-primary-foreground">
                  <CheckCircle className="h-4 w-4" /> Kirim Pesanan
                </Button>
              </div>
            )}

            {/* Regular show: Done */}
            {!useDynamicQris && !selectedShow.is_subscription && purchaseStep === "done" && (
              <div className="space-y-4 text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
                <h4 className="text-lg font-bold text-foreground">Pesanan Terkirim!</h4>
                {orderShortId && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <p className="text-[10px] font-medium text-muted-foreground mb-1">🆔 ID Pesanan</p>
                    <p className="font-mono text-lg font-bold text-primary">{orderShortId}</p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Data pesanan Anda telah dikirim. Admin akan mengirimkan <strong>link live streaming</strong> ke nomor <strong>{phone}</strong> setelah pembayaran dikonfirmasi.</p>
                {settings.whatsapp_number && (
                  <Button
                    onClick={() => openWhatsAppOrderDetail(selectedShow, phone, email)}
                    className="w-full gap-2 bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90 text-primary-foreground"
                  >
                    <MessageCircle className="h-4 w-4" /> Kirim Ulang ke WhatsApp Admin
                  </Button>
                )}
                <div className="rounded-xl border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 p-3">
                  <p className="text-xs text-muted-foreground">
                    📱 Nomor HP salah? Anda dapat mengubahnya di halaman <a href="/profile" className="text-primary underline font-medium">Profil</a> atau hubungi admin.
                  </p>
                </div>
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
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={uploadingProof}
                >
                  <Upload className="h-4 w-4" /> {uploadingProof ? "Mengupload..." : "Upload Bukti Pembayaran"}
                </button>
              </div>
            )}

            {purchaseStep === "info" && selectedShow.is_subscription && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-[hsl(var(--success))]">
                  <CheckCircle className="h-4 w-4" /> Bukti pembayaran berhasil diupload
                </div>
                <div className="rounded-xl border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 p-3">
                  <p className="text-xs font-semibold text-[hsl(var(--warning))] mb-1">⚠️ Penting!</p>
                  <p className="text-xs text-muted-foreground">
                    Masukkan nomor HP WhatsApp yang <strong>aktif dan benar</strong>. Admin akan mengirimkan <strong>informasi akses</strong> ke nomor ini setelah pembayaran dikonfirmasi.
                  </p>
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" /> Nomor WhatsApp <span className="text-destructive">*</span>
                  </label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="bg-background" />
                  <p className="mt-1 text-[10px] text-muted-foreground">Contoh: 081234567890 atau 628123456789</p>
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
                {orderShortId && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <p className="text-[10px] font-medium text-muted-foreground mb-1">🆔 ID Pesanan</p>
                    <p className="font-mono text-lg font-bold text-primary">{orderShortId}</p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Admin akan mengirimkan informasi akses ke nomor <strong>{phone}</strong> setelah pembayaran dikonfirmasi.</p>
                {settings.whatsapp_number && (
                  <Button
                    onClick={() => openWhatsAppOrderDetail(selectedShow, phone, email)}
                    className="w-full gap-2 bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90 text-primary-foreground"
                  >
                    <MessageCircle className="h-4 w-4" /> Kirim Ulang ke WhatsApp Admin
                  </Button>
                )}
                <div className="rounded-xl border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 p-3">
                  <p className="text-xs text-muted-foreground">
                    📱 Nomor HP salah? Anda dapat mengubahnya di halaman <a href="/profile" className="text-primary underline font-medium">Profil</a> atau hubungi admin.
                  </p>
                </div>
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

      {/* Coin Purchase Dialog - No upload needed */}
      <Dialog open={!!coinShowTarget} onOpenChange={() => { setCoinShowTarget(null); setCoinResult(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>🪙 Beli dengan Koin</DialogTitle>
            <DialogDescription>{coinShowTarget?.title}</DialogDescription>
          </DialogHeader>
          {!coinResult ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{coinShowTarget?.is_bundle ? "Paket" : "Show"}</span>
                  <span className="font-semibold text-foreground">{coinShowTarget?.title}</span>
                </div>
                {coinShowTarget?.is_bundle && coinShowTarget?.bundle_duration_days && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Durasi Token</span>
                    <span className="font-semibold text-[hsl(var(--warning))]">{coinShowTarget.bundle_duration_days} hari</span>
                  </div>
                )}
                {coinShowTarget?.schedule_date && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Jadwal</span>
                    <span className="text-foreground">{coinShowTarget.schedule_date} {coinShowTarget.schedule_time}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Harga</span>
                  <span className="font-bold text-[hsl(var(--warning))]">{coinShowTarget?.is_replay ? coinShowTarget?.replay_coin_price : coinShowTarget?.coin_price} Koin</span>
                </div>
                <div className="flex items-center justify-between text-sm border-t border-border pt-2">
                  <span className="text-muted-foreground">Saldo Anda</span>
                  <span className={`font-bold ${coinBalance >= (coinShowTarget?.is_replay ? (coinShowTarget?.replay_coin_price || 0) : (coinShowTarget?.coin_price || 0)) ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                    {coinBalance} Koin
                  </span>
                </div>
              </div>
              {/* Bundle description preview */}
              {coinShowTarget?.is_bundle && coinShowTarget?.bundle_description && (
                <div className="rounded-xl border border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/5 p-3">
                  <p className="text-xs font-semibold text-[hsl(var(--warning))] mb-1">📋 Termasuk dalam paket:</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-line">{coinShowTarget.bundle_description}</p>
                </div>
              )}
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  📱 Nomor WhatsApp <span className="text-destructive">*</span>
                </label>
                <Input value={coinPhone} onChange={(e) => setCoinPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="bg-background" />
                <p className="mt-1 text-[10px] text-muted-foreground">Token, link nonton & info replay akan dikirim ke nomor ini</p>
              </div>
              {coinBalance < (coinShowTarget?.is_replay ? (coinShowTarget?.replay_coin_price || 0) : (coinShowTarget?.coin_price || 0)) ? (
                <div className="space-y-3">
                  <p className="text-center text-sm text-destructive">Koin tidak cukup.</p>
                  <Button className="w-full" variant="outline" onClick={() => { setCoinShowTarget(null); window.location.href = "/coins"; }}>
                    <Coins className="mr-2 h-4 w-4" /> Beli Koin
                  </Button>
                </div>
              ) : (
                <Button className="w-full gap-2" onClick={handleCoinRedeem} disabled={coinRedeeming || !coinPhone.trim() || coinPhone.replace(/[\s-]/g, "").length < 10}>
                  <Coins className="h-4 w-4" />
                  {coinRedeeming ? "Memproses..." : `Bayar ${coinShowTarget?.is_replay ? coinShowTarget?.replay_coin_price : coinShowTarget?.coin_price} Koin`}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
              <p className="font-semibold text-foreground">
                {coinShowTarget?.is_bundle ? "📦 Pembelian Bundle Berhasil!" : "Pembelian Berhasil!"}
              </p>
              {coinShowTarget?.is_bundle && coinShowTarget?.bundle_duration_days && (
                <p className="text-xs text-muted-foreground">Token berlaku selama <span className="font-bold text-[hsl(var(--warning))]">{coinShowTarget.bundle_duration_days} hari</span></p>
              )}
              {coinResult.token_code && (
                <div className="rounded-lg bg-secondary p-4">
                  <p className="text-[10px] text-muted-foreground mb-1">🎫 Token Akses</p>
                  <p className="font-mono text-lg font-bold text-primary">{coinResult.token_code}</p>
                </div>
              )}
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
              {/* Bundle replay passwords */}
              {coinShowTarget?.is_bundle && Array.isArray(coinShowTarget?.bundle_replay_passwords) && coinShowTarget.bundle_replay_passwords.length > 0 && (
                <div className="rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 p-3 text-left">
                  <p className="text-xs font-semibold text-[hsl(var(--warning))] mb-2">📦 Sandi Replay Bundle:</p>
                  {coinShowTarget.bundle_replay_passwords.map((entry: any, i: number) => (
                    entry.show_name && entry.password ? (
                      <div key={i} className="flex items-center justify-between text-xs py-0.5">
                        <span className="text-muted-foreground">🎭 {entry.show_name}</span>
                        <span className="font-mono font-bold text-foreground">{entry.password}</span>
                      </div>
                    ) : null
                  ))}
                </div>
              )}
              {coinShowTarget?.is_bundle && coinShowTarget?.bundle_replay_info && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-left">
                  <p className="text-xs font-semibold text-primary mb-1">🎬 Info Replay:</p>
                  <p className="text-xs text-muted-foreground">{coinShowTarget.bundle_replay_info}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Info lengkap sudah dikirim ke WhatsApp Anda</p>
              <div className="flex gap-2">
                <Button className="flex-1 gap-2" variant="outline"
                  onClick={() => { navigator.clipboard.writeText(`https://realtime48stream.my.id/live?t=${coinResult.token_code}`); toast.success("Link disalin!"); }}>
                  <Copy className="h-4 w-4" /> Salin Link
                </Button>
                <Button className="flex-1 gap-2" asChild>
                  <a href={`/live?t=${coinResult.token_code}`}>
                    <Play className="h-4 w-4" /> Tonton
                  </a>
                </Button>
              </div>
              {settings.wa_fallback_enabled === "true" && settings.whatsapp_number && coinShowTarget && (
                <Button
                  className="w-full gap-2 bg-[hsl(var(--success))] text-primary-foreground hover:bg-[hsl(var(--success))]/90"
                  onClick={() => {
                    const purchaseType = coinShowTarget.is_bundle ? "Bundle" : coinShowTarget.is_replay ? "Replay" : (coinShowTarget.is_subscription ? "Membership" : "Regular");
                    const replayLine = coinResult.replay_password ? `\n🔐 Sandi Replay: ${coinResult.replay_password}` : "";
                    const accessLine = coinResult.access_password ? `\n🔐 Sandi Akses: ${coinResult.access_password}` : "";
                    const msg = `📋 *Konfirmasi Pesanan Show (Koin)*\n\n🎭 Show: ${coinShowTarget.title}\n📦 Tipe: ${purchaseType}\n🎫 Token: ${coinResult.token_code}${replayLine}${accessLine}\n📱 HP: ${coinPhone}\n💰 Pembayaran: Tukar Koin (Berhasil)\n\nMohon konfirmasi pesanan saya. Terima kasih 🙏`;
                    window.open(`https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent(msg)}`, '_blank');
                  }}
                >
                  📱 Kirim Konfirmasi via WA
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Login Required Popup */}
      <Dialog open={loginPopup} onOpenChange={setLoginPopup}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5 text-primary" />
              Login Diperlukan
            </DialogTitle>
            <DialogDescription>
              Kamu perlu login atau daftar terlebih dahulu untuk mengakses fitur ini.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <a
              href="/auth"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]"
            >
              <LogIn className="h-4 w-4" /> Login / Daftar
            </a>
            <button
              onClick={() => setLoginPopup(false)}
              className="flex w-full items-center justify-center rounded-xl bg-secondary px-4 py-3 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80"
            >
              Nanti
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <InstallBanner />
    </div>
  );
};

export default Index;
