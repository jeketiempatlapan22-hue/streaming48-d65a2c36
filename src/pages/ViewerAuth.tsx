import { useState, useEffect } from "react";
import logo from "@/assets/logo.png";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Coins, Mail, Lock, ArrowLeft, Phone, User, Gift } from "lucide-react";

type AuthMethod = "phone" | "email";

const ViewerAuth = () => {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [method, setMethod] = useState<AuthMethod>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref");
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) navigate("/coins");
    });
    // If ref code present, default to signup
    if (refCode) setMode("signup");
  }, [navigate, refCode]);

  const normalizePhone = (raw: string) => raw.replace(/[^0-9]/g, "");
  const deriveEmail = (phoneNum: string) => `${normalizePhone(phoneNum)}@rt48.user`;
  const getAuthEmail = () => method === "email" ? email.trim() : deriveEmail(phone);
  const isFormValid = () => {
    if (mode === "signup" && !username.trim()) return false;
    if (method === "phone") return normalizePhone(phone).length >= 10 && password.length >= 6;
    return email.trim().includes("@") && password.length >= 6;
  };

  const claimReferral = async (code: string) => {
    try {
      const { data, error } = await supabase.rpc("claim_referral", { _code: code.toUpperCase() });
      const result = data as any;
      if (!error && result?.success) {
        toast.success(`🎉 Referral berhasil! +${result.reward} koin`);
      }
    } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid()) return;
    setLoading(true);
    const authEmail = getAuthEmail();
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email: authEmail, password, options: { data: { username: username.trim() } } });
      if (error) {
        toast.error(error.message.includes("already registered") ? "Sudah terdaftar." : error.message);
      } else {
        toast.success("Berhasil!");
        // Auto-claim referral if present
        if (refCode) {
          await claimReferral(refCode);
        }
        navigate("/coins");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
      if (error) toast.error("Nomor/email atau password salah.");
      else navigate("/coins");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/15 border-2 border-primary/50 flex items-center justify-center shadow-[0_0_16px_hsl(var(--primary)/0.4)]">
            <img src={logo} alt="RT48" className="h-8 w-8 rounded-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Real<span className="text-primary">Time48</span></h1>
          <div className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Coins className="h-4 w-4 text-[hsl(var(--warning))]" /><span>Coin Shop</span>
          </div>
        </div>

        {refCode && mode === "signup" && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <Gift className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs text-foreground">Kode referral <span className="font-bold text-primary">{refCode.toUpperCase()}</span> akan diklaim otomatis setelah daftar!</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <h2 className="text-center text-lg font-semibold text-foreground">{mode === "login" ? "Masuk ke Akun" : "Buat Akun Baru"}</h2>
          <div className="flex rounded-lg bg-secondary p-1">
            <button type="button" onClick={() => setMethod("phone")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${method === "phone" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><Phone className="h-3.5 w-3.5" /> No. HP</button>
            <button type="button" onClick={() => setMethod("email")} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${method === "email" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><Mail className="h-3.5 w-3.5" /> Email</button>
          </div>
          {mode === "signup" && <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Username</label><div className="relative"><User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="NamaKamu" required maxLength={30} className="bg-background pl-10" /></div></div>}
          {method === "phone" && <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Nomor HP</label><div className="relative"><Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" required className="bg-background pl-10" /></div></div>}
          {method === "email" && <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label><div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" required className="bg-background pl-10" /></div></div>}
          <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label><div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 6 karakter" required minLength={6} className="bg-background pl-10" /></div></div>
          <Button type="submit" className="w-full" disabled={loading || !isFormValid()}>{loading ? "Memproses..." : mode === "login" ? "Masuk" : "Daftar"}</Button>
          <p className="text-center text-xs text-muted-foreground">{mode === "login" ? "Belum punya akun?" : "Sudah punya akun?"}<button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")} className="ml-1 font-medium text-primary hover:underline">{mode === "login" ? "Daftar" : "Masuk"}</button></p>
          {mode === "login" && (
            <p className="text-center text-xs"><a href="/reset-password" className="text-muted-foreground hover:text-primary transition-colors">Lupa password?</a></p>
          )}
        </form>
        <button onClick={() => navigate("/")} className="mt-4 flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Kembali ke Beranda</button>
      </div>
    </div>
  );
};

export default ViewerAuth;
