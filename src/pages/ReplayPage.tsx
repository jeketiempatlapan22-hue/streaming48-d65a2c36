import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompressor";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import SharedNavbar from "@/components/SharedNavbar";
import { Search, Calendar, Clock, Users, Coins, Play, Copy, Lock, Ticket, CreditCard, Upload, CheckCircle, MessageCircle, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Show } from "@/types/show";
import { SHOW_CATEGORIES } from "@/types/show";
import { usePurchasedShows } from "@/hooks/usePurchasedShows";

const isShowPast4Hours = (show: Show) => {
  if (!show.schedule_date || !show.schedule_time) return false;
  try {
    const timeStr = show.schedule_time.replace(/\s*WIB\s*/i, "").trim();
    const showDate = new Date(`${show.schedule_date} ${timeStr}`);
    if (isNaN(showDate.getTime())) return false;
    return new Date() > new Date(showDate.getTime() + 4 * 60 * 60 * 1000);
  } catch { return false; }
};

const isShowPastSchedule = (show: Show) => {
  if (!show.schedule_date || !show.schedule_time) return false;
  try {
    const timeStr = show.schedule_time.replace(/\s*WIB\s*/i, "").trim();
    const showDate = new Date(`${show.schedule_date} ${timeStr}`);
    if (isNaN(showDate.getTime())) return false;
    return new Date() > showDate;
  } catch { return false; }
};

const ReplayPage = () => {
  const { toast } = useToast();
  const [shows, setShows] = useState<Show[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [replayModal, setReplayModal] = useState<{ showId: string; password: string } | null>(null);

  const {
    coinUser, coinBalance, replayPasswords,
    addReplayPassword, setCoinBalance, loading: purchaseLoading,
  } = usePurchasedShows();

  // Purchase flow state
  const [purchaseShow, setPurchaseShow] = useState<Show | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"choose" | "coin" | "qris">("choose");
  const [redeeming, setRedeeming] = useState(false);
  const [replayResult, setReplayResult] = useState<{ replay_password: string; remaining_balance: number } | null>(null);

  // QRIS flow state
  const [qrisStep, setQrisStep] = useState<"scan" | "upload" | "info" | "done">("scan");
  const [uploadingProof, setUploadingProof] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [proofFilePath, setProofFilePath] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [loginPopup, setLoginPopup] = useState(false);
  const [qrisPhone, setQrisPhone] = useState("");
  const [qrisEmail, setQrisEmail] = useState("");
  const [orderShortId, setOrderShortId] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      const [showsRes, streamRes, settingsRes] = await Promise.all([
        supabase.rpc("get_public_shows"),
        (supabase.rpc as any)("get_stream_status"),
        supabase.from("site_settings").select("*").in("key", ["whatsapp_number"]),
      ]);
      if (settingsRes.data) {
        const waRow = settingsRes.data.find((r: any) => r.key === "whatsapp_number");
        if (waRow) setWhatsappNumber(waRow.value);
      }
      if (showsRes.data) {
        const streamLive = (streamRes.data as any)?.is_live ?? true;
        const pastShows = (showsRes.data as any[]).filter((s) => {
          if (s.is_subscription || s.replay_coin_price <= 0) return false;
          if (s.is_replay) return true;
          if (isShowPast4Hours(s)) return true;
          if (!streamLive && isShowPastSchedule(s)) return true;
          return false;
        });
        pastShows.sort((a, b) => {
          const dateA = a.schedule_date ? new Date(a.schedule_date).getTime() : 0;
          const dateB = b.schedule_date ? new Date(b.schedule_date).getTime() : 0;
          return dateB - dateA;
        });
        setShows(pastShows as Show[]);
      }
    };
    fetchData();

    const showCh = supabase.channel("replay-shows").on("postgres_changes", { event: "*", schema: "public", table: "shows" }, () => fetchData()).subscribe();
    const streamCh = supabase.channel("replay-streams").on("postgres_changes", { event: "*", schema: "public", table: "streams" }, () => fetchData()).subscribe();

    return () => {
      supabase.removeChannel(showCh);
      supabase.removeChannel(streamCh);
    };
  }, []);

  const openPurchase = (show: Show) => {
    if (!coinUser) { setLoginPopup(true); return; }
    setPurchaseShow(show);
    setPaymentMethod("choose");
    setReplayResult(null);
    setQrisStep("scan");
    setProofUrl("");
    setProofFilePath("");
    setQrisPhone("");
    setQrisEmail("");
    setOrderShortId("");
  };

  const handleCoinRedeem = async () => {
    if (!purchaseShow || !coinUser) return;
    setRedeeming(true);
    const { data, error } = await supabase.rpc("redeem_coins_for_replay" as any, { _show_id: purchaseShow.id });
    setRedeeming(false);
    const result = data as any;
    if (error || !result?.success) {
      toast({ title: "Gagal menukar koin", description: result?.error || error?.message, variant: "destructive" });
      return;
    }
    setReplayResult({ replay_password: result.replay_password, remaining_balance: result.remaining_balance });
    setCoinBalance(result.remaining_balance);
    addReplayPassword(purchaseShow.id, result.replay_password);
  };

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile || !purchaseShow) return;
    if (rawFile.size > 5 * 1024 * 1024) { toast({ title: "File terlalu besar (max 5MB)", variant: "destructive" }); return; }
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
      setQrisStep("upload");
    } catch {
      toast({ title: "Upload gagal, coba lagi", variant: "destructive" });
    }
    setUploadingProof(false);
  };

  const handleSubmitReplayOrder = async () => {
    if (!purchaseShow) return;
    let signedUrl = "";
    if (proofFilePath) {
      const { data: urlData } = await supabase.storage.from("payment-proofs").createSignedUrl(proofFilePath, 86400);
      signedUrl = urlData?.signedUrl || "";
    }
    let orderId: string | null = null;
    try {
      const { data, error } = await supabase.rpc("create_show_order", {
        _show_id: purchaseShow.id, _phone: qrisPhone, _email: qrisEmail || null, _payment_proof_url: signedUrl || null,
      });
      const result = data as any;
      if (!error && result?.success) {
        orderId = result.order_id;
        setOrderShortId(result.short_id || "");
      }
    } catch (e) {
      console.error("Order insert error:", e);
    }
    setQrisStep("done");
    // Send bot notification
    if (orderId) {
      supabase.functions.invoke("notify-subscription-order", {
        body: { order_id: orderId, show_title: purchaseShow.title, phone: qrisPhone, email: qrisEmail || null, proof_file_path: proofFilePath || null, proof_bucket: "payment-proofs", order_type: "replay", schedule_date: purchaseShow.schedule_date || null, schedule_time: purchaseShow.schedule_time || null },
      }).catch(() => {});
    }
    // Also open WhatsApp
    if (whatsappNumber) {
      const now = new Date().toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" });
      const proofText = proofUrl ? `\n📎 *Bukti Transfer:* ${proofUrl}` : "";
      const msg = encodeURIComponent(
        `━━━━━━━━━━━━━━━━━━━━\n🎬 *PESANAN REPLAY*\n━━━━━━━━━━━━━━━━━━━━\n\n🎭 *Show:* ${purchaseShow.title}\n💰 *Harga:* ${purchaseShow.price}\n${purchaseShow.schedule_date ? `📅 *Jadwal:* ${purchaseShow.schedule_date} ${purchaseShow.schedule_time}\n` : ""}${purchaseShow.lineup ? `👥 *Lineup:* ${purchaseShow.lineup}\n` : ""}📱 HP: ${qrisPhone}${proofText}\n🕐 Waktu Order: ${now}\n\n━━━━━━━━━━━━━━━━━━━━\n_Dikirim dari RealTime48_ ✨`
      );
      window.open(`https://wa.me/${whatsappNumber}?text=${msg}`, "_blank");
    }
  };

  const filteredShows = shows.filter((s) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = s.title.toLowerCase().includes(q) ||
      (s.schedule_date || "").toLowerCase().includes(q) ||
      (s.lineup || "").toLowerCase().includes(q) ||
      (s.category_member || "").toLowerCase().includes(q);
    const matchesCategory = categoryFilter === "all" || (s.category || "regular") === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const availableCategories = ["all", ...Array.from(new Set(shows.map((s) => s.category || "regular")))];

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <div className="mx-auto max-w-6xl px-4 pt-20 pb-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold text-foreground">🎬 Replay Show</h1>
          <p className="mt-2 text-sm text-muted-foreground">Tonton ulang show yang sudah berlangsung</p>
        </motion.div>

        <div className="mx-auto mb-6 max-w-2xl space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari nama show, member, tanggal..." className="bg-card pl-10" />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {availableCategories.map((cat) => {
              const catInfo = cat === "all" ? { label: "📋 Semua", color: "bg-secondary text-secondary-foreground" } : (SHOW_CATEGORIES[cat] || { label: cat, color: "bg-secondary text-secondary-foreground" });
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-[0.95] ${categoryFilter === cat ? "ring-2 ring-primary ring-offset-2 ring-offset-background " + catInfo.color : "bg-secondary/50 text-muted-foreground hover:bg-secondary"}`}
                >
                  {catInfo.label}
                </button>
              );
            })}
          </div>
        </div>

        {coinUser && (
          <div className="mx-auto mb-6 flex max-w-md items-center justify-between rounded-xl border border-border bg-card p-3">
            <span className="text-sm text-muted-foreground">Saldo Koin</span>
            <span className="flex items-center gap-1.5 font-bold text-primary"><Coins className="h-4 w-4" /> {coinBalance} Koin</span>
          </div>
        )}

        {/* Button for users who already purchased */}
        <div className="mx-auto mb-6 max-w-md">
          <a
            href="https://replaytime.lovable.app"
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary bg-primary/10 px-4 py-3.5 text-sm font-bold text-primary transition-all hover:bg-primary/20 active:scale-[0.97]"
          >
            <Play className="h-5 w-5" /> Klik Disini Jika Sudah Membeli Show
          </a>
        </div>

        {filteredShows.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-12 text-center">
            <Ticket className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium text-foreground">Belum ada replay tersedia</p>
            <p className="mt-2 text-sm text-muted-foreground">Show yang sudah selesai akan muncul di sini</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredShows.map((show, i) => {
              const hasRealPassword = replayPasswords[show.id] && replayPasswords[show.id] !== "__purchased__";
              const hasPurchased = !!replayPasswords[show.id];
              return (
                <motion.div key={show.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5">
                  <div className="relative h-44 overflow-hidden">
                    {show.background_image_url ? (
                      <img src={show.background_image_url} alt={show.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/20 to-accent/10"><Play className="h-16 w-16 text-primary/30" /></div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />
                    {show.category && show.category !== "regular" && (() => {
                      const cat = SHOW_CATEGORIES[show.category] || SHOW_CATEGORIES.regular;
                      const memberText = show.category_member && (show.category === "birthday" || show.category === "last_show") ? ` — ${show.category_member}` : "";
                      return <span className={`absolute top-3 left-3 rounded-full px-3 py-1 text-[10px] font-bold backdrop-blur-sm ${cat.color}`}>{cat.label}{memberText}</span>;
                    })()}
                    <span className="absolute top-3 right-3 rounded-full bg-accent/80 px-2.5 py-1 text-[10px] font-bold text-accent-foreground backdrop-blur-sm">REPLAY</span>
                    <div className="absolute bottom-3 left-4 right-4"><h3 className="text-lg font-bold text-foreground">{show.title}</h3></div>
                  </div>
                  <div className="space-y-2.5 p-4">
                    {show.schedule_date && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5 text-primary" />{show.schedule_date}
                        {show.schedule_time && <><Clock className="ml-2 h-3.5 w-3.5 text-primary" />{show.schedule_time}</>}
                      </div>
                    )}
                    {show.lineup && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Users className="mt-0.5 h-3.5 w-3.5 text-primary" /><span className="line-clamp-2">{show.lineup}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-sm text-primary"><Coins className="h-4 w-4" /><span className="font-semibold">{show.replay_coin_price} Koin</span></div>
                      {show.price && show.price !== "Gratis" && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><CreditCard className="h-3.5 w-3.5" /><span className="font-medium">{show.price}</span></div>
                      )}
                    </div>

                    {hasRealPassword ? (
                      <div className="space-y-2">
                        <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-center">
                          <p className="text-[10px] font-medium text-muted-foreground mb-1">🔐 Sandi Replay</p>
                          <p className="font-mono text-lg font-bold text-primary">{replayPasswords[show.id]}</p>
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(replayPasswords[show.id]);
                            toast({ title: "Sandi disalin! Membuka halaman replay..." });
                            setTimeout(() => { window.open("https://replaytime.lovable.app", "_blank"); }, 500);
                          }}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-accent-foreground transition-all hover:bg-accent/90 active:scale-[0.97]"
                        >
                          <Copy className="h-4 w-4" /> Salin Sandi & Tonton Replay
                        </button>
                      </div>
                    ) : hasPurchased ? (
                      <a href="https://replaytime.lovable.app" target="_blank" rel="noopener noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-accent-foreground transition-all hover:bg-accent/90 active:scale-[0.97]">
                        <Play className="h-4 w-4" /> Tonton Replay
                      </a>
                    ) : (
                      <button
                        onClick={() => openPurchase(show)}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97]"
                      >
                        <Ticket className="h-4 w-4" /> Beli Replay
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Purchase Dialog */}
      <Dialog open={!!purchaseShow} onOpenChange={() => { setPurchaseShow(null); setReplayResult(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>🎬 Beli Replay</DialogTitle>
            <DialogDescription>{purchaseShow?.title}</DialogDescription>
          </DialogHeader>

          {/* Step 1: Choose payment method */}
          {paymentMethod === "choose" && !replayResult && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Show</span>
                  <span className="font-semibold text-foreground">{purchaseShow?.title}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tanggal</span>
                  <span className="text-foreground">{purchaseShow?.schedule_date}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Harga Koin</span>
                  <span className="font-bold text-primary">{purchaseShow?.replay_coin_price} Koin</span>
                </div>
                {purchaseShow?.price && purchaseShow.price !== "Gratis" && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Harga QRIS</span>
                    <span className="font-bold text-foreground">{purchaseShow.price}</span>
                  </div>
                )}
              </div>
              <p className="text-center text-sm font-medium text-foreground">Pilih metode pembayaran:</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentMethod("coin")}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 transition hover:border-primary/50 hover:bg-primary/5 active:scale-[0.97]"
                >
                  <Coins className="h-8 w-8 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Koin</span>
                  <span className="text-[10px] text-muted-foreground">Langsung terproses</span>
                </button>
                <button
                  onClick={() => { setPaymentMethod("qris"); setQrisStep("scan"); setProofUrl(""); }}
                  className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 transition hover:border-primary/50 hover:bg-primary/5 active:scale-[0.97]"
                >
                  <CreditCard className="h-8 w-8 text-foreground" />
                  <span className="text-sm font-semibold text-foreground">Scan QRIS</span>
                  <span className="text-[10px] text-muted-foreground">Transfer & upload bukti</span>
                </button>
              </div>
            </div>
          )}

          {/* Coin payment */}
          {paymentMethod === "coin" && !replayResult && (
            <div className="space-y-4">
              <button onClick={() => setPaymentMethod("choose")} className="text-xs text-primary hover:underline">← Kembali</button>
              <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Harga Replay</span>
                  <span className="font-bold text-primary">{purchaseShow?.replay_coin_price} Koin</span>
                </div>
                <div className="flex items-center justify-between text-sm border-t border-border pt-2">
                  <span className="text-muted-foreground">Saldo Anda</span>
                  <span className={`font-bold ${coinBalance >= (purchaseShow?.replay_coin_price || 0) ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                    {coinBalance} Koin
                  </span>
                </div>
              </div>
              {coinBalance < (purchaseShow?.replay_coin_price || 0) ? (
                <div className="space-y-3">
                  <p className="text-center text-sm text-destructive">Koin tidak cukup.</p>
                  <Button className="w-full" variant="outline" onClick={() => { setPurchaseShow(null); window.location.href = "/coins"; }}>
                    <Coins className="mr-2 h-4 w-4" /> Beli Koin
                  </Button>
                </div>
              ) : (
                <Button className="w-full gap-2" onClick={handleCoinRedeem} disabled={redeeming}>
                  <Coins className="h-4 w-4" />
                  {redeeming ? "Memproses..." : `Bayar ${purchaseShow?.replay_coin_price} Koin`}
                </Button>
              )}
            </div>
          )}

          {/* QRIS payment */}
          {paymentMethod === "qris" && !replayResult && (
            <div className="space-y-4">
              <button onClick={() => setPaymentMethod("choose")} className="text-xs text-primary hover:underline">← Kembali</button>

              {qrisStep === "scan" && (
                <>
                  <p className="text-sm text-muted-foreground">Silakan scan QRIS di bawah untuk melakukan pembayaran:</p>
                  {purchaseShow?.qris_image_url ? (
                    <img src={purchaseShow.qris_image_url} alt="QRIS" className="mx-auto w-full max-w-sm rounded-lg object-contain" />
                  ) : (
                    <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">QRIS belum tersedia untuk show ini</div>
                  )}
                  <div className="rounded-xl border border-border bg-secondary/50 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Harga</p>
                    <p className="text-lg font-bold text-foreground">{purchaseShow?.price}</p>
                  </div>
                  <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { handleUploadProof(e as any); if (galleryInputRef.current) galleryInputRef.current.value = ""; }} />
                  <button type="button" className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-4 text-sm font-medium text-primary transition hover:border-primary hover:bg-primary/10" onClick={() => galleryInputRef.current?.click()} disabled={uploadingProof}>
                    <Upload className="h-4 w-4" /> {uploadingProof ? "Mengupload..." : "Upload Bukti Pembayaran"}
                  </button>
                </>
              )}

              {qrisStep === "upload" && (
                <>
                  <div className="flex items-center gap-2 text-sm text-[hsl(var(--success))]">
                    <CheckCircle className="h-4 w-4" /> Bukti pembayaran berhasil diupload
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <MessageCircle className="h-3.5 w-3.5" /> Nomor WhatsApp <span className="text-destructive">*</span>
                    </label>
                    <Input value={qrisPhone} onChange={(e) => setQrisPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="bg-background" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Email (opsional)</label>
                    <Input value={qrisEmail} onChange={(e) => setQrisEmail(e.target.value)} placeholder="email@contoh.com" className="bg-background" />
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-2">
                    <p className="text-xs font-semibold text-foreground">📋 Ringkasan Pesanan</p>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>🎭 {purchaseShow?.title}</p>
                      <p>💰 {purchaseShow?.price}</p>
                      {purchaseShow?.schedule_date && <p>📅 {purchaseShow.schedule_date} {purchaseShow.schedule_time}</p>}
                    </div>
                  </div>
                  <Button onClick={handleSubmitReplayOrder} disabled={!qrisPhone.trim()} className="w-full gap-2 bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90 text-primary-foreground">
                    <MessageCircle className="h-4 w-4" /> Kirim Pesanan via WhatsApp
                  </Button>
                  <p className="text-[10px] text-center text-muted-foreground">
                    * Anda akan diarahkan ke WhatsApp untuk mengirim data pesanan dan bukti transfer ke admin
                  </p>
                </>
              )}

              {qrisStep === "done" && (
                <div className="space-y-4 text-center">
                  <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
                  <h4 className="text-lg font-bold text-foreground">Pesanan Terkirim!</h4>
                  {orderShortId && <p className="text-sm text-muted-foreground">ID Pesanan: <span className="font-bold text-primary">{orderShortId}</span></p>}
                  <p className="text-sm text-muted-foreground">Admin akan memproses pesanan Anda dan mengirimkan sandi replay via WhatsApp.</p>
                </div>
              )}
            </div>
          )}

          {/* Success result (coin) */}
          {replayResult && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--success))]/20">
                <Play className="h-6 w-6 text-[hsl(var(--success))]" />
              </div>
              <p className="font-semibold text-foreground">Pembelian Replay Berhasil!</p>
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
                <p className="text-xs font-medium text-muted-foreground mb-1">🔐 Sandi Replay Anda</p>
                <p className="font-mono text-2xl font-bold text-primary">{replayResult.replay_password}</p>
              </div>
              <Button
                className="w-full gap-2"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(replayResult.replay_password);
                  toast({ title: "Sandi disalin! Membuka halaman replay..." });
                  setTimeout(() => {
                    window.open("https://replaytime.lovable.app", "_blank");
                    setPurchaseShow(null);
                    setReplayResult(null);
                  }, 500);
                }}
              >
                <Copy className="h-4 w-4" /> Salin Sandi & Tonton Replay
              </Button>
              <p className="text-xs text-muted-foreground">Sisa saldo: <span className="font-bold text-primary">{replayResult.remaining_balance} koin</span></p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Replay Password Modal */}
      <Dialog open={!!replayModal} onOpenChange={() => setReplayModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-primary" /> Sandi Replay</DialogTitle>
            <DialogDescription>Salin sandi ini sebelum menuju halaman replay</DialogDescription>
          </DialogHeader>
          {replayModal && (
            <div className="space-y-4 text-center">
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
                <p className="text-xs font-medium text-muted-foreground mb-1">🔐 Sandi Replay</p>
                <p className="font-mono text-2xl font-bold text-primary">{replayModal.password}</p>
              </div>
              <Button
                className="w-full gap-2"
                onClick={() => {
                  navigator.clipboard.writeText(replayModal.password);
                  toast({ title: "Sandi disalin! Membuka halaman replay..." });
                  setTimeout(() => {
                    window.open("https://replaytime.lovable.app", "_blank");
                    setReplayModal(null);
                  }, 500);
                }}
              >
                <Copy className="h-4 w-4" /> Salin Sandi & Tonton Replay
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Login Required Popup */}
      <Dialog open={loginPopup} onOpenChange={setLoginPopup}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><LogIn className="h-5 w-5 text-primary" /> Login Diperlukan</DialogTitle>
            <DialogDescription>Kamu perlu login atau daftar terlebih dahulu untuk membeli replay.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <a href="/auth" className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]">
              <LogIn className="h-4 w-4" /> Login / Daftar
            </a>
            <button onClick={() => setLoginPopup(false)} className="flex w-full items-center justify-center rounded-xl bg-secondary px-4 py-3 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80">
              Nanti
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReplayPage;
