import { useState, useEffect, useRef } from "react";
import logo from "@/assets/logo.png";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompressor";
import SharedNavbar from "@/components/SharedNavbar";
import CountdownTimer from "@/components/CountdownTimer";
import { Calendar, Shield, Search, Upload, CheckCircle, Phone, MessageCircle, Loader2, Coins } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Show } from "@/types/show";
import ShowCard from "@/components/viewer/ShowCard";
import BundleShowCard from "@/components/viewer/BundleShowCard";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { usePurchasedShows } from "@/hooks/usePurchasedShows";

const SchedulePage = () => {
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [settings, setSettings] = useState<{ whatsapp_number: string; use_dynamic_qris?: string }>({ whatsapp_number: "" });
  const {
    coinUser, redeemedTokens, accessPasswords, replayPasswords,
    addRedeemedToken, addAccessPassword, membershipToken, bundleToken,
  } = usePurchasedShows();
  const [isStreamLive, setIsStreamLive] = useState(false);
  const universalToken = membershipToken || bundleToken || null;

  // Purchase modal state
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [purchaseStep, setPurchaseStep] = useState<"qris" | "upload" | "info" | "done">("info");
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofFilePath, setProofFilePath] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [orderShortId, setOrderShortId] = useState("");
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [coinBuyTarget, setCoinBuyTarget] = useState<Show | null>(null);
  const [coinBuyPhone, setCoinBuyPhone] = useState("");
  // Dynamic QRIS state
  const [dynamicQrisStep, setDynamicQrisStep] = useState<"phone" | "qris" | "done">("phone");
  const [dynamicQrString, setDynamicQrString] = useState("");
  const [dynamicOrderId, setDynamicOrderId] = useState("");
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [dynamicPaid, setDynamicPaid] = useState(false);
  const [QRCodeSVG, setQRCodeSVG] = useState<any>(null);

  const useDynamicQris = settings.use_dynamic_qris === "true";

  // Load QR component
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
    const fetchData = async () => {
      const [showsRes, settingsRes] = await Promise.all([
        supabase.rpc("get_public_shows"),
        supabase.from("site_settings").select("*").in("key", ["whatsapp_number", "use_dynamic_qris"]),
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
    const ch = supabase.channel("sched-shows").on("postgres_changes", { event: "*", schema: "public", table: "shows" }, () => fetchData()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleBuy = (show: Show) => {
    setSelectedShow(show);
    if (useDynamicQris && !show.is_subscription) {
      setDynamicQrisStep("phone");
      setDynamicQrString("");
      setDynamicOrderId("");
      setDynamicPaid(false);
      setDynamicLoading(false);
      setPurchaseStep("info");
    } else {
      setPurchaseStep(show.is_subscription ? "qris" : "info");
    }
    setProofFilePath("");
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

  const handleCoinBuy = async (show: Show) => {
    if (!coinUser) { toast.error("Login terlebih dahulu"); return; }
    setCoinBuyTarget(show);
    setCoinBuyPhone("");
  };

  const handleCoinConfirm = async () => {
    if (!coinBuyTarget || !coinUser) return;
    if (!coinBuyPhone.trim() || coinBuyPhone.replace(/[\s-]/g, "").length < 10) {
      toast.error("Masukkan nomor WhatsApp yang valid"); return;
    }
    const { data, error } = await supabase.rpc("redeem_coins_for_token", { _show_id: coinBuyTarget.id });
    const result = data as any;
    if (error || !result?.success) { toast.error(result?.error || "Gagal"); return; }
    toast.success(`Token: ${result.token_code}`);
    addRedeemedToken(coinBuyTarget.id, result.token_code);
    if (result.access_password) addAccessPassword(coinBuyTarget.id, result.access_password);
    setCoinBuyTarget(null);

    // Send WhatsApp notification with token + replay info
    supabase.functions.invoke("notify-coin-show-purchase", {
      body: {
        user_id: coinUser.id,
        show_id: coinBuyTarget.id,
        token_code: result.token_code,
        access_password: result.access_password,
        show_title: coinBuyTarget.title,
        purchase_type: coinBuyTarget.is_bundle ? "bundle" : coinBuyTarget.is_replay ? "replay" : (coinBuyTarget.is_subscription ? "membership" : "regular"),
        phone: coinBuyPhone.replace(/[\s-]/g, ""),
      },
    }).then(res => { if (res.error) console.warn("Notify WA error:", res.error); }).catch(e => console.warn("Notify WA failed:", e));
  };

  const openWhatsAppOrderDetail = (show: Show, orderPhone: string, orderEmail: string) => {
    if (!settings.whatsapp_number) return;
    const emailLine = orderEmail ? `\n📧 Email: ${orderEmail}` : '';
    const msg = `📋 *Pesanan Show Baru*\n\n🎭 Show: ${show.title}\n💰 Harga: ${show.price}\n📅 Jadwal: ${show.schedule_date || '-'} ${show.schedule_time || ''}\n👥 Lineup: ${show.lineup || '-'}\n📱 HP: ${orderPhone}${emailLine}\n\nSaya sudah melakukan pembayaran dan mengirim bukti transfer. Mohon dikonfirmasi 🙏`;
    window.open(`https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent(msg)}`, '_blank');
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
      setProofFilePath(path);
      if (selectedShow.is_subscription) setPurchaseStep("info");
    } catch {
      toast.error("Upload gagal, coba lagi");
    }
    setUploadingProof(false);
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

  const filteredShows = shows.filter(s => {
    const q = searchQuery.toLowerCase();
    return !s.is_bundle && (s.title.toLowerCase().includes(q) || (s.schedule_date || "").toLowerCase().includes(q) || (s.lineup || "").toLowerCase().includes(q));
  });
  const bundleShows = shows.filter(s => {
    const q = searchQuery.toLowerCase();
    return s.is_bundle && (s.title.toLowerCase().includes(q) || (s.schedule_date || "").toLowerCase().includes(q) || (s.lineup || "").toLowerCase().includes(q));
  });

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

        <div className="relative mx-auto mb-6 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari show, lineup, atau tanggal..." className="bg-card pl-10" />
        </div>

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

        {/* Bundle Shows */}
        {bundleShows.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-6 text-center text-xl font-bold text-foreground">📦 Paket Bundle</h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {bundleShows.map((show, i) => (
                <BundleShowCard key={show.id} show={show} index={i} redeemedToken={redeemedTokens[show.id]} accessPassword={accessPasswords[show.id]} replayPassword={replayPasswords[show.id]} onBuy={handleBuy} onCoinBuy={handleCoinBuy} />
              ))}
            </div>
          </div>
        )}
      </div>

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

            {/* Hidden file input for gallery - no capture attribute */}
            <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { handleUploadProof(e); if (galleryInputRef.current) galleryInputRef.current.value = ""; }} />

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

            {/* Regular show: Static QRIS + Phone + optional upload */}
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
              </div>
            )}

            {/* Subscription: QRIS + upload */}
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
                {orderShortId && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <p className="text-[10px] font-medium text-muted-foreground mb-1">🆔 ID Pesanan</p>
                    <p className="font-mono text-lg font-bold text-primary">{orderShortId}</p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">Data dan bukti pembayaran Anda telah dikirim. Admin akan mengkonfirmasi pembayaran Anda.</p>
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

      {/* Coin Buy Phone Dialog */}
      <Dialog open={!!coinBuyTarget} onOpenChange={() => setCoinBuyTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>🪙 Beli dengan Koin</DialogTitle>
            <DialogDescription>{coinBuyTarget?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-secondary/50 p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Harga</span>
                <span className="font-bold text-primary">{coinBuyTarget?.coin_price} Koin</span>
              </div>
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                📱 Nomor WhatsApp <span className="text-destructive">*</span>
              </label>
              <Input type="tel" value={coinBuyPhone} onChange={(e) => setCoinBuyPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="bg-background" />
              <p className="mt-1 text-[10px] text-muted-foreground">Untuk menerima notifikasi token & info replay</p>
            </div>
            <Button className="w-full gap-2" disabled={!coinBuyPhone.trim() || coinBuyPhone.replace(/[\s-]/g, "").length < 10} onClick={handleCoinConfirm}>
              <Coins className="h-4 w-4" /> Bayar {coinBuyTarget?.coin_price} Koin
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SchedulePage;
