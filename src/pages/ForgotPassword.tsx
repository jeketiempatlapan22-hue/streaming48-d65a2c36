import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Phone, Mail, ArrowLeft, Shield, CheckCircle2, MessageSquare } from "lucide-react";
import { checkClientRateLimit, getRateLimitRemaining } from "@/lib/rateLimiter";

type Method = "phone" | "email";

const ForgotPassword = () => {
  const [method, setMethod] = useState<Method>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const submitRef = useRef(false);

  const normalizePhone = (raw: string) => raw.replace(/[^0-9]/g, "");
  const deriveEmail = (p: string) => `${normalizePhone(p)}@rt48.user`;

  const isValid = () => {
    if (method === "phone") return normalizePhone(phone).length >= 10;
    return email.trim().includes("@") && normalizePhone(whatsappNumber).length >= 10;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid() || submitRef.current || loading) return;
    submitRef.current = true;

    if (!checkClientRateLimit("forgot-password", 3, 120_000)) {
      const rem = getRateLimitRemaining("forgot-password");
      toast.error(`Terlalu banyak percobaan. Tunggu ${rem} detik.`);
      submitRef.current = false;
      return;
    }

    setLoading(true);
    const identifier = method === "phone" ? deriveEmail(phone) : email.trim();
    const phoneNum = method === "phone" ? normalizePhone(phone) : normalizePhone(whatsappNumber);

    try {
      // Look up the user via edge function to avoid exposing auth.users
      const { data, error } = await supabase.functions.invoke("request-password-reset", {
        body: { identifier, phone: phoneNum },
      });

      if (error || !data?.success) {
        const msg = data?.error || error?.message || "Terjadi kesalahan";
        toast.error(msg);
      } else {
        setSuccess(true);
      }
    } catch {
      toast.error("Koneksi bermasalah, coba lagi.");
    } finally {
      setLoading(false);
      submitRef.current = false;
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <CheckCircle2 className="mx-auto h-12 w-12 text-[hsl(var(--success))]" />
          <h1 className="text-xl font-bold text-foreground">Link Reset Terkirim!</h1>
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-center justify-center gap-2 text-primary">
              <MessageSquare className="h-5 w-5" />
              <span className="font-semibold text-sm">Cek WhatsApp Kamu Sekarang</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Link reset password sudah dikirim ke WhatsApp kamu. Klik link di pesan untuk membuat password baru.
            </p>
            <p className="text-xs text-muted-foreground">
              ⏰ Link berlaku selama 2 jam. Jika tidak ada pesan dalam 1 menit, periksa nomor WA kamu dan coba lagi.
            </p>
          </div>
          <Button onClick={() => navigate("/auth")} variant="outline" className="w-full">
            Kembali ke Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Lupa Password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Masukkan nomor HP atau email yang kamu gunakan saat mendaftar
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <div className="flex rounded-lg bg-secondary p-1">
            <button
              type="button"
              onClick={() => setMethod("phone")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${method === "phone" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              <Phone className="h-3.5 w-3.5" /> No. HP
            </button>
            <button
              type="button"
              onClick={() => setMethod("email")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${method === "email" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              <Mail className="h-3.5 w-3.5" /> Email
            </button>
          </div>

          {method === "phone" ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nomor HP</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08xxxxxxxxxx"
                  required
                  className="bg-background pl-10"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@contoh.com"
                    required
                    className="bg-background pl-10"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Nomor WhatsApp Tujuan</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="tel"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="08xxxxxxxxxx"
                    required
                    className="bg-background pl-10"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-secondary/50 border border-border p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <MessageSquare className="inline h-3.5 w-3.5 mr-1 text-primary" />
              Link reset password akan <span className="font-semibold text-foreground">langsung dikirim ke WhatsApp kamu</span> tanpa perlu menunggu admin. Pastikan nomor WA aktif.
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={loading || !isValid()}>
            {loading ? "Mengirim..." : "Kirim Permintaan Reset"}
          </Button>
        </form>

        <button
          onClick={() => navigate("/auth")}
          className="mt-4 flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali ke Login
        </button>
      </div>
    </div>
  );
};

export default ForgotPassword;
