import { motion } from "framer-motion";
import { MessageCircle, Upload, CheckCircle, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
}

const PurchaseModal = ({
  show, purchaseStep, uploadingProof, phone, setPhone, email, setEmail,
  onClose, onConfirmRegular, onUploadProof, onSubmitSubscription,
}: PurchaseModalProps) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6"
    >
      <h3 className="mb-1 text-lg font-bold text-foreground">{show.title}</h3>
      <p className="mb-4 text-sm text-muted-foreground">{show.price}</p>

      {/* Regular show: QRIS + WhatsApp */}
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
              <Mail className="h-3.5 w-3.5" /> Email Anda
            </label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" className="bg-background" />
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
          <Button onClick={onConfirmRegular} disabled={!email.trim()} className="w-full gap-2 bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90 text-primary-foreground">
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
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-4 text-sm font-medium text-primary transition hover:border-primary hover:bg-primary/10"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*,.heic,.heif";
              input.onchange = (e: any) => onUploadProof(e);
              input.click();
            }}
            disabled={uploadingProof}
          >
            <Upload className="h-4 w-4" />
            {uploadingProof ? "Mengupload..." : "Upload Bukti Pembayaran"}
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

export default PurchaseModal;
