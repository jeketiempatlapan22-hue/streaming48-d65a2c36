import { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { MessageCircle, Upload, CheckCircle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Show } from "@/types/show";

/** Tampilkan harga replay (replay_qris_price) bila show adalah replay & harga diset, jika tidak fallback ke show.price */
const getDisplayPrice = (show: Show): string => {
  if (show.is_replay && show.replay_qris_price && show.replay_qris_price > 0) {
    return `Rp ${show.replay_qris_price.toLocaleString("id-ID")}`;
  }
  return show.price || "-";
};

interface PurchaseModalProps {
  show: Show;
  purchaseStep: "qris" | "upload" | "info" | "done";
  uploadingProof: boolean;
  phone: string;
  setPhone: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  onClose: () => void;
  onConfirmRegular: () => void;
  onUploadProof: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmitSubscription: () => void;
  useDynamicQris?: boolean;
}

const QRIS_DURATION_SECONDS = 10 * 60; // 10 menit

const DynamicQrisView = ({ show, phone, onClose, onDone, onFallbackStatic }: { show: Show; phone: string; onClose: () => void; onDone: () => void; onFallbackStatic: () => void }) => {
  const [loading, setLoading] = useState(true);
  const [qrString, setQrString] = useState("");
  const [orderId, setOrderId] = useState("");
  const [paid, setPaid] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(QRIS_DURATION_SECONDS);
  const [QRCodeSVG, setQRCodeSVG] = useState<any>(null);

  // Dynamically import QR component
  useEffect(() => {
    import("qrcode.react").then(mod => setQRCodeSVG(() => mod.QRCodeSVG));
  }, []);

  // Hitung harga aktual: replay → replay_qris_price (jika ada), kalau tidak → parsing show.price
  const computeAmount = (): number => {
    if (show.is_replay && show.replay_qris_price && show.replay_qris_price > 0) {
      return show.replay_qris_price;
    }
    return parseInt((show.price || "").replace(/[^\d]/g, ""), 10) || 0;
  };

  const orderTypeForReplay = show.is_replay
    ? "replay"
    : show.is_subscription
      ? "membership"
      : "regular";

  const tryCreate = async () => {
    setLoading(true);
    setFailed(false);
    setExpired(false);
    setQrString("");
    setOrderId("");
    setSecondsLeft(QRIS_DURATION_SECONDS);
    // Hard client-side timeout (28s) agar konsisten dengan edge function (22s + retry)
    const hardTimeout = setTimeout(() => {
      toast.error("QRIS dinamis lambat. Coba QRIS Statis sebagai cadangan.");
      setLoading(false);
      setFailed(true);
    }, 28000);
    try {
      const priceNum = computeAmount();
      if (priceNum <= 0) { toast.error("Harga tidak valid"); clearTimeout(hardTimeout); setLoading(false); return; }

      const { data, error } = await supabase.functions.invoke("create-dynamic-qris", {
        body: { show_id: show.id, amount: priceNum, phone, order_type: orderTypeForReplay },
      });
      clearTimeout(hardTimeout);
      if (error || !data?.success) {
        toast.error(data?.error || error?.message || "Gagal membuat QRIS dinamis");
        setFailed(true);
        setLoading(false);
        return;
      }
      setQrString(data.qr_string);
      setOrderId(data.order_id);
    } catch (err: any) {
      clearTimeout(hardTimeout);
      toast.error("Gagal membuat QRIS dinamis. Coba QRIS Statis.");
      setFailed(true);
    }
    setLoading(false);
  };

  // Create dynamic QRIS on mount
  useEffect(() => {
    tryCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.id, show.price, show.is_replay, show.replay_qris_price, phone, show.is_subscription]);

  // Countdown 10 menit
  useEffect(() => {
    if (!orderId || paid || expired) return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          setExpired(true);
          // Server cron juga akan menghapus, tapi kita panggil cancel agar
          // data hilang segera dari panel admin.
          supabase.rpc("cancel_pending_qris_order" as any, {
            _order_id: orderId,
            _order_kind: "subscription",
          }).then(() => {});
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [orderId, paid, expired]);

  // Poll payment status every 3s
  useEffect(() => {
    if (!orderId || paid || expired) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("subscription_orders")
        .select("payment_status, status")
        .eq("id", orderId)
        .maybeSingle();
      if (data && (data.payment_status === "paid" || data.status === "confirmed")) {
        setPaid(true);
        clearInterval(interval);
        toast.success("✅ Pembayaran berhasil dikonfirmasi!");
        setTimeout(onDone, 1500);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [orderId, paid, expired, onDone]);

  // Cancel order saat user tutup tanpa membayar
  const handleClose = () => {
    if (orderId && !paid && !expired) {
      supabase.rpc("cancel_pending_qris_order" as any, {
        _order_id: orderId,
        _order_kind: "subscription",
      }).then(() => {});
    }
    onClose();
  };

  // Expose handleClose ke parent via window event tidak praktis — gunakan tombol internal di bawah.

  const formatTime = (s: number) => {
    const mm = Math.floor(s / 60).toString().padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Membuat QRIS dinamis...</p>
        <p className="text-[10px] text-muted-foreground text-center px-4">Mohon tunggu hingga 25 detik. Jika gagal, Anda bisa pilih QRIS Statis.</p>
      </div>
    );
  }

  if (paid) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
        <h4 className="text-lg font-bold text-foreground">Pembayaran Berhasil!</h4>
        <p className="text-sm text-muted-foreground">Pesanan Anda telah dikonfirmasi otomatis.</p>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive">
          ⏰ QRIS dinamis sudah kadaluarsa (10 menit).
          <p className="mt-1 text-xs opacity-80">Pesanan otomatis dibatalkan. Buat baru jika ingin mencoba lagi.</p>
        </div>
        <Button className="w-full" onClick={tryCreate}>🔄 Buat QRIS Baru</Button>
        {show.qris_image_url && (
          <Button variant="outline" className="w-full" onClick={onFallbackStatic}>
            📷 Gunakan QRIS Statis (cadangan)
          </Button>
        )}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive">
          QRIS dinamis gagal dimuat.
        </div>
        <Button className="w-full" onClick={tryCreate}>🔄 Coba Lagi QRIS Dinamis</Button>
        {show.qris_image_url && (
          <Button variant="outline" className="w-full" onClick={onFallbackStatic}>
            📷 Gunakan QRIS Statis (cadangan)
          </Button>
        )}
        <p className="text-[10px] text-center text-muted-foreground">QRIS Statis perlu konfirmasi admin (1-15 menit)</p>
      </div>
    );
  }

  const lowTime = secondsLeft <= 60;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Scan QRIS di bawah untuk membayar:</p>
      {qrString && QRCodeSVG ? (
        <div className="flex justify-center rounded-lg border border-border bg-white p-4">
          <QRCodeSVG value={qrString} size={240} level="M" />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">
          QRIS gagal dimuat
        </div>
      )}
      <div className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-mono font-semibold ${lowTime ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/5 text-primary"}`}>
        ⏱ Berlaku: {formatTime(secondsLeft)}
      </div>
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Menunggu pembayaran otomatis...
      </div>
      <p className="text-[10px] text-center text-muted-foreground px-2">
        QRIS dinamis berlaku 10 menit. Jika tidak dibayar, akan kadaluarsa otomatis dan dapat dibuat ulang.
      </p>
      {show.qris_image_url && (
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={onFallbackStatic}>
          📷 QRIS dinamis tidak terbaca? Coba QRIS Statis
        </Button>
      )}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-xs font-semibold text-foreground">📋 Ringkasan Pesanan</p>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>🎭 {show.title}</p>
          <p>💰 {getDisplayPrice(show)}</p>
          {show.schedule_date && <p>📅 {show.schedule_date} {show.schedule_time}</p>}
        </div>
      </div>
      <button
        onClick={handleClose}
        className="w-full rounded-xl bg-secondary py-2 text-xs font-medium text-secondary-foreground transition hover:bg-secondary/80"
      >
        Batalkan & Tutup
      </button>
    </div>
  );
};

const PurchaseModal = ({
  show, purchaseStep, uploadingProof, phone, setPhone, email, setEmail,
  onClose, onConfirmRegular, onUploadProof, onSubmitSubscription, useDynamicQris = false,
}: PurchaseModalProps) => {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [dynamicQrisStep, setDynamicQrisStep] = useState<"phone" | "qris" | "static" | "done">("phone");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUploadProof(e);
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  };

  // Dynamic QRIS flow for regular shows
  if (useDynamicQris && !show.is_subscription) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6"
        >
          <h3 className="mb-1 text-lg font-bold text-foreground">{show.title}</h3>
          <p className="mb-4 text-sm text-muted-foreground">{getDisplayPrice(show)}</p>

          {dynamicQrisStep === "phone" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <MessageCircle className="h-3.5 w-3.5" /> Nomor WhatsApp <span className="text-destructive">*</span>
                </label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="bg-background" />
              </div>
              <Button onClick={() => setDynamicQrisStep("qris")} disabled={!phone.trim()} className="w-full">
                Lanjut ke Pembayaran
              </Button>
            </div>
          )}

          {dynamicQrisStep === "qris" && (
            <DynamicQrisView
              show={show}
              phone={phone}
              onClose={onClose}
              onDone={() => setDynamicQrisStep("done")}
              onFallbackStatic={() => setDynamicQrisStep("static")}
            />
          )}

          {dynamicQrisStep === "static" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
                ℹ️ Anda menggunakan <strong>QRIS Statis</strong>. Setelah membayar, kirim bukti transfer ke admin via WhatsApp untuk dikonfirmasi (1-15 menit).
              </div>
              {show.qris_image_url ? (
                <img src={show.qris_image_url} alt="QRIS Statis" className="mx-auto w-full max-w-sm rounded-lg object-contain" />
              ) : (
                <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">
                  QRIS Statis belum tersedia
                </div>
              )}
              <Button onClick={onConfirmRegular} disabled={!phone.trim() || !show.qris_image_url} className="w-full gap-2 bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90 text-primary-foreground">
                <MessageCircle className="h-4 w-4" /> Kirim Bukti via WhatsApp ke Admin
              </Button>
            </div>
          )}

          {dynamicQrisStep === "done" && (
            <div className="space-y-4 text-center">
              <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
              <h4 className="text-lg font-bold text-foreground">Pembayaran Berhasil!</h4>
              <p className="text-sm text-muted-foreground">Pesanan telah dikonfirmasi otomatis. Token akses akan dikirim via WhatsApp.</p>
            </div>
          )}

          <button onClick={onClose} className="mt-4 w-full rounded-xl bg-secondary py-3 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80">
            Tutup
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6"
      >
        <h3 className="mb-1 text-lg font-bold text-foreground">{show.title}</h3>
        <p className="mb-4 text-sm text-muted-foreground">{getDisplayPrice(show)}</p>

        {/* Hidden file input for gallery */}
        <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />

        {/* Regular show: QRIS + Phone only */}
        {!show.is_subscription && purchaseStep === "info" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm text-muted-foreground">
                Silakan scan QRIS di bawah, lalu kirim bukti transfer secara manual ke admin via WhatsApp.
              </p>
            </div>
            {show.qris_image_url ? (
              <img src={show.qris_image_url} alt="QRIS" className="mx-auto w-full max-w-sm rounded-lg object-contain" />
            ) : (
              <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">
                QRIS belum tersedia
              </div>
            )}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <MessageCircle className="h-3.5 w-3.5" /> Nomor WhatsApp <span className="text-destructive">*</span>
              </label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" className="bg-background" />
              <p className="mt-1 text-[10px] text-muted-foreground">Contoh: 081234567890 atau 628123456789</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-2 text-xs font-semibold text-foreground">📋 Ringkasan Pesanan</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>🎭 {show.title}</p>
                <p>💰 {getDisplayPrice(show)}</p>
                {show.schedule_date && <p>📅 {show.schedule_date} {show.schedule_time}</p>}
                {show.lineup && <p>👥 {show.lineup}</p>}
              </div>
            </div>
            <Button onClick={onConfirmRegular} disabled={!phone.trim()} className="w-full gap-2 bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90 text-primary-foreground">
              <MessageCircle className="h-4 w-4" /> Kirim Pesanan via WhatsApp
            </Button>
            <p className="text-[10px] text-center text-muted-foreground">
              * Anda akan diarahkan ke WhatsApp untuk mengirim data pesanan dan bukti transfer secara manual ke admin
            </p>
          </div>
        )}

        {/* Subscription: QRIS + upload */}
        {show.is_subscription && purchaseStep === "qris" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Silakan scan QRIS di bawah untuk melakukan pembayaran:</p>
            {show.qris_image_url ? (
              <img src={show.qris_image_url} alt="QRIS" className="mx-auto w-full max-w-sm rounded-lg object-contain" />
            ) : (
              <div className="rounded-lg border border-border bg-secondary/50 p-8 text-center text-sm text-muted-foreground">QRIS belum tersedia</div>
            )}
            <p className="text-xs text-muted-foreground text-center">Setelah melakukan pembayaran, upload bukti transfer:</p>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/10 px-5 py-5 text-base font-semibold text-primary transition hover:border-primary hover:bg-primary/20"
              onClick={() => galleryInputRef.current?.click()}
              disabled={uploadingProof}
            >
              <Upload className="h-5 w-5" />
              {uploadingProof ? "Mengupload..." : "📷 Upload Bukti Pembayaran"}
            </button>
          </div>
        )}

        {purchaseStep === "info" && show.is_subscription && (
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
            <Button onClick={onSubmitSubscription} disabled={!phone || !email} className="w-full">
              Kirim Data Langganan
            </Button>
          </div>
        )}

        {purchaseStep === "done" && show.is_subscription && (
          <div className="space-y-4 text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
            <h4 className="text-lg font-bold text-foreground">Pendaftaran Berhasil!</h4>
            <p className="text-sm text-muted-foreground">Data dan bukti pembayaran Anda telah dikirim. Admin akan mengkonfirmasi pembayaran Anda.</p>
          </div>
        )}

        <button onClick={onClose} className="mt-4 w-full rounded-xl bg-secondary py-3 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80">
          Tutup
        </button>
      </motion.div>
    </div>
  );
};

export default PurchaseModal;
