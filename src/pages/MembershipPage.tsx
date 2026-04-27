import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { Crown, Sparkles, CheckCircle, Star, Users, Calendar, Coins, AlertTriangle, Clock, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import SharedNavbar from "@/components/SharedNavbar";
import { uploadPaymentProof } from "@/lib/uploadPaymentProof";

interface Show {
  id: string;
  title: string;
  price: string;
  lineup: string;
  schedule_date: string;
  schedule_time: string;
  background_image_url: string | null;
  qris_image_url: string | null;
  is_subscription: boolean;
  max_subscribers: number;
  subscription_benefits: string;
  group_link?: string;
  is_order_closed: boolean;
  coin_price: number;
  membership_duration_days?: number;
}

const MembershipPage = () => {
  const { toast } = useToast();
  const [shows, setShows] = useState<Show[]>([]);
  const [subscriberCounts, setSubscriberCounts] = useState<Record<string, number>>({});
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [purchaseStep, setPurchaseStep] = useState<"coin_info" | "coin_insufficient" | "qris" | "upload" | "qris_dynamic" | "done">("coin_info");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [coinBalance, setCoinBalance] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [closedPopup, setClosedPopup] = useState<Show | null>(null);
  const [myOrderedShows, setMyOrderedShows] = useState<Set<string>>(new Set());
  const [coinOnly, setCoinOnly] = useState(true);
  const [useDynamicQris, setUseDynamicQris] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  // Dynamic QRIS state
  const [dynamicQrString, setDynamicQrString] = useState("");
  const [dynamicOrderId, setDynamicOrderId] = useState("");
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [dynamicPaid, setDynamicPaid] = useState(false);
  const [QRCodeSVG, setQRCodeSVG] = useState<any>(null);
  const [membershipResult, setMembershipResult] = useState<{
    token_code?: string;
    expires_at?: string;
    duration_days?: number;
    access_password?: string;
    group_link?: string;
  } | null>(null);

  const fetchMyOrders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase
      .from("subscription_orders")
      .select("show_id")
      .eq("user_id", session.user.id);
    if (data) setMyOrderedShows(new Set(data.map((o: any) => o.show_id)));
  };

  const fetchData = async () => {
    const [showsRes, settingsRes] = await Promise.all([
      supabase.rpc("get_public_shows"),
      supabase.from("site_settings").select("key, value").in("key", ["membership_coin_only", "use_dynamic_qris"]),
    ]);
    const allShows = showsRes.data;
    const data = (allShows || []).filter((s: any) => s.is_subscription);
    const subShows = (data as Show[]) || [];
    setShows(subShows);

    const settingsMap: Record<string, string> = {};
    (settingsRes.data || []).forEach((s: any) => { settingsMap[s.key] = s.value; });
    setCoinOnly(settingsMap["membership_coin_only"] !== "false");
    setUseDynamicQris(settingsMap["use_dynamic_qris"] === "true");

    const counts: Record<string, number> = {};
    for (const s of subShows) {
      const { data: count } = await supabase.rpc("get_confirmed_order_count" as any, { _show_id: s.id });
      counts[s.id] = (count as number) || 0;
    }
    setSubscriberCounts(counts);
  };

  const fetchBalance = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data } = await supabase.from("coin_balances").select("balance").eq("user_id", session.user.id).maybeSingle();
      setCoinBalance(data?.balance || 0);
    }
  };

  useEffect(() => {
    fetchData();
    fetchBalance();
    fetchMyOrders();

    const showChannel = supabase.channel("membership-shows")
      .on("postgres_changes", { event: "*", schema: "public", table: "shows" }, () => fetchData())
      .subscribe();

    const orderChannel = supabase.channel("membership-orders-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "subscription_orders" }, () => {
        fetchData();
        fetchMyOrders();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "subscription_orders" }, () => {
        fetchData();
        fetchMyOrders();
      })
      .subscribe();

    const balanceChannel = supabase.channel("membership-balance-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "coin_balances" }, () => fetchBalance())
      .subscribe();

    return () => {
      supabase.removeChannel(showChannel);
      supabase.removeChannel(orderChannel);
      supabase.removeChannel(balanceChannel);
    };
  }, []);

  // Lazy-load QR component for dynamic QRIS
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
        toast({ title: "✅ Pembayaran berhasil dikonfirmasi!" });
        setTimeout(() => {
          setPurchaseStep("done");
          fetchMyOrders();
          fetchData();
        }, 1500);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [dynamicOrderId, dynamicPaid]);

  const handleBuy = async (show: Show, mode: "coin" | "qris" = "coin") => {
    const { data: { session } } = await supabase.auth.getSession();

    // QRIS allows guest checkout (anon). Coin redemption requires login.
    if (mode === "coin" && !session?.user) {
      toast({ title: "Silakan login terlebih dahulu untuk pembelian koin", variant: "destructive" });
      return;
    }

    const { data: count } = await supabase.rpc("get_confirmed_order_count" as any, { _show_id: show.id });
    const confirmed = (count as number) || 0;
    setSubscriberCounts(prev => ({ ...prev, [show.id]: confirmed }));
    const isFull = (show.max_subscribers > 0 && confirmed >= show.max_subscribers) || show.is_order_closed;
    if (isFull) { setClosedPopup(show); return; }

    setSelectedShow(show);
    setPhone("");
    setEmail("");
    setMembershipResult(null);
    setDynamicQrString("");
    setDynamicOrderId("");
    setDynamicPaid(false);
    setDynamicLoading(false);

    if (mode === "qris") {
      // Use dynamic QRIS if admin enabled it (auto-confirm via callback).
      // Otherwise fallback to static QRIS (manual upload bukti).
      if (useDynamicQris) {
        setPurchaseStep("qris_dynamic");
      } else {
        setPurchaseStep("qris");
      }
    } else {
      if (show.coin_price <= 0) {
        toast({ title: "Membership ini belum bisa dibeli dengan koin", variant: "destructive" });
        return;
      }
      await fetchBalance();
      const { data: bal } = await supabase.from("coin_balances").select("balance").eq("user_id", session!.user.id).maybeSingle();
      const currentBalance = bal?.balance || 0;
      setCoinBalance(currentBalance);
      setPurchaseStep(currentBalance < show.coin_price ? "coin_insufficient" : "coin_info");
    }
  };

  const handleStartDynamicQris = async () => {
    if (!selectedShow) return;
    if (!phone.trim() || !email.trim()) {
      toast({ title: "Harap isi nomor WhatsApp dan email", variant: "destructive" });
      return;
    }
    if (!/^(08|\+62|62)\d{7,13}$/.test(phone.replace(/[\s-]/g, ""))) {
      toast({ title: "Format nomor WhatsApp tidak valid", variant: "destructive" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast({ title: "Format email tidak valid", variant: "destructive" });
      return;
    }
    setDynamicLoading(true);
    try {
      const priceNum = parseInt((selectedShow.price || "").replace(/[^\d]/g, "")) || 0;
      if (priceNum <= 0) {
        toast({ title: "Harga membership tidak valid", variant: "destructive" });
        setDynamicLoading(false);
        return;
      }
      const normalizedPhone = phone.replace(/[\s-]/g, "").replace(/^\+/, "").replace(/^0/, "62");
      const { data, error } = await supabase.functions.invoke("create-dynamic-qris", {
        body: {
          show_id: selectedShow.id,
          amount: priceNum,
          phone: normalizedPhone,
          email: email.trim(),
          order_type: "membership",
        },
      });
      if (error || !data?.success) {
        toast({ title: data?.error || "Gagal membuat QRIS dinamis", variant: "destructive" });
        setDynamicLoading(false);
        return;
      }
      setDynamicQrString(data.qr_string);
      setDynamicOrderId(data.order_id);
    } catch (err: any) {
      toast({ title: "Gagal membuat QRIS: " + (err?.message || "Coba lagi"), variant: "destructive" });
    }
    setDynamicLoading(false);
  };

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !selectedShow) return;
    setUploadingProof(true);
    const file = e.target.files[0];
    try {
      const { path, signed_url } = await uploadPaymentProof(file, { type: "show", show_id: selectedShow.id });
      setPurchaseStep("upload");
      (window as any).__membershipProofPath = path;
      (window as any).__membershipProofSignedUrl = signed_url || null;
    } catch (err: any) {
      toast({ title: "Gagal upload: " + (err?.message || "coba lagi"), variant: "destructive" });
    }
    setUploadingProof(false);
  };

  const handleSubmitQris = async () => {
    if (!selectedShow || !phone.trim() || !email.trim()) {
      toast({ title: "Harap isi nomor WhatsApp dan email", variant: "destructive" });
      return;
    }
    if (!/^(08|\+62|62)\d{7,13}$/.test(phone.replace(/[\s-]/g, ""))) {
      toast({ title: "Format nomor WhatsApp tidak valid", variant: "destructive" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast({ title: "Format email tidak valid", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    // Use the signed URL we already received from the upload edge function.
    // Anonymous (guest) users cannot re-sign storage objects via RLS.
    const proofUrl: string | null = (window as any).__membershipProofSignedUrl || null;

    const { data, error } = await supabase.rpc("create_show_order" as any, {
      _show_id: selectedShow.id, _phone: phone, _email: email, _payment_proof_url: proofUrl, _payment_method: "qris",
    });
    setSubmitting(false);
    const result = data as any;
    if (error || !result?.success) {
      toast({ title: "Gagal membuat pesanan", variant: "destructive" }); return;
    }
    setPurchaseStep("done");
    fetchMyOrders();
    fetchData();

    supabase.functions.invoke("notify-subscription-order", {
      body: { order_id: result.order_id, show_title: selectedShow.title, phone },
    }).catch(() => {});
  };

  const handleCoinPurchase = async () => {
    if (!selectedShow || !phone.trim() || !email.trim()) {
      toast({ title: "Harap isi nomor WhatsApp dan email", variant: "destructive" });
      return;
    }
    if (!/^(08|\+62|62)\d{7,13}$/.test(phone.replace(/[\s-]/g, ""))) {
      toast({ title: "Format nomor WhatsApp tidak valid", variant: "destructive" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast({ title: "Format email tidak valid", variant: "destructive" });
      return;
    }
    setSubmitting(true);

    // Re-check quota before purchasing
    const { data: count } = await supabase.rpc("get_confirmed_order_count" as any, { _show_id: selectedShow.id });
    const confirmed = (count as number) || 0;
    if (selectedShow.max_subscribers > 0 && confirmed >= selectedShow.max_subscribers) {
      toast({ title: "Kuota membership sudah penuh", variant: "destructive" });
      setSubmitting(false);
      setSelectedShow(null);
      fetchData();
      return;
    }

    const { data, error } = await supabase.rpc("redeem_coins_for_membership" as any, {
      _show_id: selectedShow.id, _phone: phone, _email: email,
    });
    setSubmitting(false);
    const result = data as any;
    if (error || !result?.success) {
      toast({ title: result?.error || "Gagal menukar koin", variant: "destructive" }); return;
    }
    setCoinBalance(result.remaining_balance || 0);

    if (result.token_code) {
      setMembershipResult({
        token_code: result.token_code,
        expires_at: result.expires_at,
        duration_days: result.duration_days,
        access_password: result.access_password,
        group_link: result.group_link,
      });
    }

    setPurchaseStep("done");
    fetchMyOrders();
    fetchData();

    // Send WhatsApp notification
    supabase.functions.invoke("notify-coin-show-purchase", {
      body: {
        user_id: (await supabase.auth.getSession()).data.session?.user.id,
        show_id: selectedShow.id,
        token_code: result.token_code,
        access_password: result.access_password,
        show_title: selectedShow.title,
        purchase_type: "membership",
        phone: phone.replace(/[\s-]/g, ""),
      },
    }).then(res => { if (res.error) console.warn("Notify WA error:", res.error); }).catch(e => console.warn("Notify WA failed:", e));
  };

  const copyToken = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: "Token disalin!" });
  };

  const formatDuration = (days: number) => {
    if (days >= 365) return `${Math.floor(days / 365)} tahun`;
    if (days >= 30) return `${Math.floor(days / 30)} bulan`;
    return `${days} hari`;
  };

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <section className="px-4 pt-24 pb-8 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Crown className="mx-auto mb-4 h-16 w-16 text-yellow-500" />
          <h1 className="text-3xl font-extrabold text-foreground md:text-5xl">
            Paket <span className="text-yellow-500">Membership</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">{coinOnly ? "Tukarkan koin untuk akses eksklusif streaming" : "Dapatkan akses eksklusif streaming"}</p>
        </motion.div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {shows.map((show, i) => {
            const confirmed = subscriberCounts[show.id] || 0;
            const spotsLeft = show.max_subscribers > 0 ? show.max_subscribers - confirmed : null;
            const isFull = (spotsLeft !== null && spotsLeft <= 0) || show.is_order_closed;
            const alreadyOrdered = myOrderedShows.has(show.id);
            const duration = show.membership_duration_days || 30;
            return (
              <motion.div key={show.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                className={`group relative overflow-hidden rounded-2xl border-2 transition-all ${alreadyOrdered ? "border-[hsl(var(--success))]/50 bg-gradient-to-b from-[hsl(var(--success))]/5 to-card" : isFull ? "border-muted bg-muted/30 opacity-75" : "border-yellow-500/50 bg-gradient-to-b from-yellow-500/5 to-card hover:border-yellow-500 hover:shadow-2xl hover:shadow-yellow-500/10"}`}>
                <div className={`absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black ${alreadyOrdered ? "bg-[hsl(var(--success))] text-primary-foreground" : isFull ? "bg-destructive text-destructive-foreground" : "bg-yellow-500 text-background"}`}>
                  <Sparkles className="h-3 w-3" />
                  {alreadyOrdered ? "TERDAFTAR" : show.is_order_closed ? "PENDAFTARAN DITUTUP" : isFull ? "MEMBERSHIP PENUH" : "MEMBERSHIP"}
                </div>
                <div className="relative h-48 overflow-hidden">
                  {show.background_image_url ? (
                    <img src={show.background_image_url} alt={show.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-yellow-500/20 to-primary/10"><Crown className="h-16 w-16 text-yellow-500/30" /></div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />
                  <div className="absolute bottom-3 left-4 right-4"><h3 className="text-xl font-bold text-foreground">{show.title}</h3></div>
                </div>
                <div className="space-y-3 p-4">
                  {alreadyOrdered ? (
                    <div className="space-y-3 text-center py-2">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--success))]/15">
                        <CheckCircle className="h-8 w-8 text-[hsl(var(--success))]" />
                      </div>
                      <h4 className="text-base font-bold text-foreground">Membership Aktif! 🎉</h4>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Cek token dan info akses di halaman profil atau WhatsApp kamu.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm font-bold text-primary">
                          <Coins className="h-3.5 w-3.5" /> {show.coin_price > 0 ? `${show.coin_price} Koin` : show.price}
                        </span>
                        {spotsLeft !== null && <span className="text-xs text-muted-foreground">{confirmed}/{show.max_subscribers} terdaftar</span>}
                      </div>
                      <div className="flex items-center gap-1.5 rounded-lg bg-yellow-500/10 px-3 py-1.5 text-xs font-semibold text-yellow-600">
                        <Clock className="h-3.5 w-3.5" /> Durasi: {formatDuration(duration)}
                      </div>
                      {show.max_subscribers > 0 && (
                        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                          <div className={`h-full rounded-full transition-all duration-500 ${isFull ? "bg-destructive" : "bg-yellow-500"}`} style={{ width: `${Math.min((confirmed / show.max_subscribers) * 100, 100)}%` }} />
                        </div>
                      )}
                      {show.subscription_benefits && (
                        <div className="space-y-1.5">
                          {show.subscription_benefits.split("\n").filter(Boolean).map((b, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                              <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-500" /><span>{b}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {show.schedule_date && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="h-4 w-4 text-yellow-500" />{show.schedule_date}</div>}
                      {show.lineup && <div className="flex items-start gap-2 text-sm text-muted-foreground"><Users className="mt-0.5 h-4 w-4 text-yellow-500" /><span className="line-clamp-2">{show.lineup}</span></div>}
                      <div className="mt-2 flex flex-col gap-2">
                        {show.coin_price > 0 && (
                          <button onClick={() => handleBuy(show, "coin")} disabled={isFull}
                            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold transition-all ${isFull ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-gradient-to-r from-yellow-500 to-yellow-600 text-background hover:shadow-lg hover:shadow-yellow-500/25"}`}>
                            <Coins className="h-4 w-4" />
                            {show.is_order_closed ? "🔒 Ditutup" : isFull ? "🔒 Penuh" : `Tukar ${show.coin_price} Koin`}
                          </button>
                        )}
                        {!coinOnly && (useDynamicQris || show.qris_image_url) && (
                          <button onClick={() => handleBuy(show, "qris")} disabled={isFull}
                            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold transition-all border ${isFull ? "bg-muted text-muted-foreground cursor-not-allowed" : "border-primary bg-primary/10 text-primary hover:bg-primary/20"}`}>
                            💳 Beli via QRIS {useDynamicQris ? "Dinamis" : "Statis"}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
        {shows.length === 0 && (
          <div className="rounded-2xl border border-border bg-card p-12 text-center">
            <Crown className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium text-foreground">Belum ada paket membership</p>
          </div>
        )}
      </section>

      {/* Closed/Full Popup */}
      <Dialog open={!!closedPopup} onOpenChange={() => setClosedPopup(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Pendaftaran Tidak Tersedia
            </DialogTitle>
            <DialogDescription>{closedPopup?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-center">
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">
                {closedPopup?.is_order_closed
                  ? "🔒 Pendaftaran membership ini telah ditutup oleh admin."
                  : "🔒 Kuota membership ini sudah penuh."}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">Silakan hubungi admin untuk informasi lebih lanjut.</p>
          </div>
        </DialogContent>
      </Dialog>

      {selectedShow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6">
            <h3 className="mb-1 text-lg font-bold text-foreground">{selectedShow.title}</h3>
            <p className="mb-4 text-sm text-muted-foreground flex items-center gap-1.5">
              {purchaseStep === "qris" || purchaseStep === "upload" || purchaseStep === "qris_dynamic"
                ? <>{selectedShow.price} · Durasi {formatDuration(selectedShow.membership_duration_days || 30)}</>
                : <><Coins className="h-4 w-4" /> {selectedShow.coin_price} Koin · Durasi {formatDuration(selectedShow.membership_duration_days || 30)}</>
              }
            </p>

            {/* QRIS Steps */}
            {purchaseStep === "qris" && (
              <div className="space-y-4">
                {selectedShow.qris_image_url && (
                  <img src={selectedShow.qris_image_url} alt="QRIS" className="mx-auto max-w-[240px] rounded-xl" />
                )}
                <p className="text-xs text-muted-foreground text-center">Scan QRIS lalu upload bukti pembayaran</p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">No. WhatsApp *</label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxx" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Email *</label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" />
                </div>
                <label className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl py-3 font-bold transition-all ${!phone || !email ? "bg-muted text-muted-foreground pointer-events-none" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
                  {uploadingProof ? "Mengupload..." : "📷 Upload Bukti Pembayaran"}
                  <input type="file" accept="image/*" className="hidden" onChange={handleUploadProof} disabled={!phone || !email || uploadingProof} />
                </label>
              </div>
            )}

            {purchaseStep === "upload" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-[hsl(var(--success))]/10 p-3 text-sm text-[hsl(var(--success))]">
                  ✅ Bukti pembayaran berhasil diupload
                </div>
                <Button onClick={handleSubmitQris} disabled={submitting || !phone || !email} className="w-full">
                  {submitting ? "Mengirim..." : "Kirim Pesanan"}
                </Button>
                <p className="text-[10px] text-center text-muted-foreground">Admin akan mengkonfirmasi pesanan kamu</p>
              </div>
            )}

            {/* Dynamic QRIS Step (auto-confirm via Pak Kasir callback) */}
            {purchaseStep === "qris_dynamic" && (
              <div className="space-y-4">
                {!dynamicOrderId ? (
                  <>
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                      💳 Bayar dengan QRIS Dinamis. Pesanan otomatis dikonfirmasi setelah pembayaran berhasil.
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">No. WhatsApp *</label>
                      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxx" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Email *</label>
                      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" />
                    </div>
                    <Button onClick={handleStartDynamicQris} disabled={dynamicLoading || !phone || !email} className="w-full">
                      {dynamicLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Membuat QRIS...</> : "Lanjut Bayar"}
                    </Button>
                  </>
                ) : dynamicPaid ? (
                  <div className="space-y-3 text-center py-4">
                    <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
                    <p className="font-semibold text-foreground">Pembayaran Berhasil!</p>
                    <p className="text-sm text-muted-foreground">Token membership akan dikirim via WhatsApp.</p>
                  </div>
                ) : dynamicQrString && QRCodeSVG ? (
                  <>
                    <p className="text-sm text-muted-foreground text-center">Scan QRIS di bawah untuk membayar:</p>
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
                        <p>👑 {selectedShow.title}</p>
                        <p>💰 {selectedShow.price}</p>
                        <p>⏱ Durasi: {formatDuration(selectedShow.membership_duration_days || 30)}</p>
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

            {purchaseStep === "coin_info" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-primary/10 p-3 text-sm text-primary">
                  💰 Saldo koin: <strong>{coinBalance}</strong> · Harga: <strong>{selectedShow.coin_price}</strong> koin
                </div>
                <p className="text-xs text-muted-foreground">Isi data di bawah untuk menerima notifikasi:</p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">No. WhatsApp *</label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxx" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Email *</label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" />
                </div>
                <Button onClick={handleCoinPurchase} disabled={submitting || !phone || !email} className="w-full">
                  {submitting ? "Memproses..." : `Tukar ${selectedShow.coin_price} Koin`}
                </Button>
                <p className="text-[10px] text-center text-muted-foreground">* Koin akan langsung dipotong setelah konfirmasi</p>
              </div>
            )}

            {purchaseStep === "coin_insufficient" && (
              <div className="space-y-4 text-center">
                <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                  ❌ Koin tidak cukup. Saldo: {coinBalance}, Butuh: {selectedShow.coin_price}
                </div>
                <a href="/coins" className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90">
                  <Coins className="h-4 w-4" /> Beli Koin
                </a>
              </div>
            )}

            {purchaseStep === "done" && (
              <div className="space-y-4 text-center">
                <div className="text-4xl">🎉</div>
                <h4 className="text-lg font-bold text-foreground">Membership Berhasil Dibeli!</h4>

                {membershipResult?.token_code && (
                  <div className="space-y-3 text-left">
                    <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
                      <p className="text-[10px] font-medium text-muted-foreground mb-1">🎫 Token Membership</p>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-lg font-bold text-primary flex-1 break-all">{membershipResult.token_code}</p>
                        <button onClick={() => copyToken(membershipResult.token_code!)} className="rounded-lg bg-primary/10 p-2 hover:bg-primary/20 transition">
                          <Copy className="h-4 w-4 text-primary" />
                        </button>
                      </div>
                    </div>
                    {membershipResult.duration_days && (
                      <div className="flex items-center gap-2 rounded-lg bg-yellow-500/10 p-3 text-sm text-yellow-600">
                        <Clock className="h-4 w-4" /> Durasi: <strong>{formatDuration(membershipResult.duration_days)}</strong>
                      </div>
                    )}
                    {membershipResult.expires_at && (
                      <div className="flex items-center gap-2 rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        Bergabung: {new Date().toLocaleDateString("id-ID")} · Berakhir: {new Date(membershipResult.expires_at).toLocaleDateString("id-ID")}
                      </div>
                    )}
                    <a href={`/live?t=${membershipResult.token_code}`}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90 transition">
                      <ExternalLink className="h-4 w-4" /> Tonton Live
                    </a>
                    {membershipResult.access_password && (
                      <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
                        <p className="text-xs text-muted-foreground mb-1">🔑 Sandi Replay</p>
                        <p className="font-mono font-bold text-foreground">{membershipResult.access_password}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">🔗 Link Replay: replaytime.lovable.app</p>
                      </div>
                    )}
                  </div>
                )}

                {(membershipResult?.group_link) && (
                  <a href={membershipResult.group_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--success))] px-6 py-3 font-semibold text-primary-foreground hover:opacity-90">
                    📱 Gabung Grup
                  </a>
                )}

                <p className="text-xs text-muted-foreground">Info lengkap juga dikirim ke WhatsApp kamu 📱</p>
              </div>
            )}

            <button onClick={() => setSelectedShow(null)} className="mt-4 w-full rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary transition">Tutup</button>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default MembershipPage;
