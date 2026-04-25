import { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { MessageCircle, Upload, CheckCircle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Show } from "@/types/show";

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

const DynamicQrisView = ({ show, phone, onClose, onDone }: { show: Show; phone: string; onClose: () => void; onDone: () => void }) => {
  const [loading, setLoading] = useState(true);
  const [qrString, setQrString] = useState("");
  const [orderId, setOrderId] = useState("");
  const [paid, setPaid] = useState(false);
  const [QRCodeSVG, setQRCodeSVG] = useState<any>(null);

  // Dynamically import QR component
  useEffect(() => {
    import("qrcode.react").then(mod => setQRCodeSVG(() => mod.QRCodeSVG));
  }, []);

  // Create dynamic QRIS on mount
  useEffect(() => {
    const create = async () => {
      setLoading(true);
      // Hard client-side timeout (15s) so the spinner never hangs forever
      const hardTimeout = setTimeout(() => {
        toast.error("QRIS lambat dimuat. Silakan coba lagi.");
        setLoading(false);
      }, 15000);
      try {
        const priceNum = parseInt(show.price.replace(/[^\d]/g, "")) || 0;
        if (priceNum <= 0) { toast.error("Harga tidak valid"); clearTimeout(hardTimeout); setLoading(false); return; }

        const { data, error } = await supabase.functions.invoke("create-dynamic-qris", {
          body: { show_id: show.id, amount: priceNum, phone, order_type: show.is_subscription ? "membership" : "regular" },
        });
        clearTimeout(hardTimeout);
        if (error || !data?.success) {
          toast.error(data?.error || error?.message || "Gagal membuat QRIS");
          setLoading(false);
          return;
        }
        setQrString(data.qr_string);
        setOrderId(data.order_id);
      } catch (err: any) {
        clearTimeout(hardTimeout);
        toast.error("Gagal membuat QRIS: " + (err?.message || "Coba lagi"));
      }
      setLoading(false);
    };
    create();
  }, [show.id, show.price, phone, show.is_subscription]);

  // Poll payment status every 3s
  useEffect(() => {
    if (!orderId || paid) return;
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
  }, [orderId, paid, onDone]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Membuat QRIS...</p>
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
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Menunggu pembayaran...
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-xs font-semibold text-foreground">📋 Ringkasan Pesanan</p>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>🎭 {show.title}</p>
          <p>💰 {show.price}</p>
          {show.schedule_date && <p>📅 {show.schedule_date} {show.schedule_time}</p>}
        </div>
      </div>
    </div>
  );
};

const PurchaseModal = ({
  show, purchaseStep, uploadingProof, phone, setPhone, email, setEmail,
  onClose, onConfirmRegular, onUploadProof, onSubmitSubscription, useDynamicQris = false,
}: PurchaseModalProps) => {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [dynamicQrisStep, setDynamicQrisStep] = useState<"phone" | "qris" | "done">("phone");

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
          <p className="mb-4 text-sm text-muted-foreground">{show.price}</p>

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
            <DynamicQrisView show={show} phone={phone} onClose={onClose} onDone={() => setDynamicQrisStep("done")} />
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
        <p className="mb-4 text-sm text-muted-foreground">{show.price}</p>

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
                <p>💰 {show.price}</p>
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
