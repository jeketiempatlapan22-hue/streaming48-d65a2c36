import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Phone, ShoppingBag } from "lucide-react";
import type { ResellerSession } from "@/pages/ResellerPage";

interface Props {
  onLogin: (session: ResellerSession) => void;
}

const ResellerLogin = ({ onLogin }: Props) => {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !password) {
      toast({ title: "Lengkapi data", description: "Nomor HP & sandi wajib diisi", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("reseller_login", { _phone: phone, _password: password });
      if (error) throw error;
      const res = data as any;
      if (!res?.success) {
        toast({ title: "Login gagal", description: res?.error || "Tidak dapat masuk", variant: "destructive" });
        return;
      }
      onLogin({
        reseller_id: res.reseller_id,
        name: res.name,
        phone: res.phone,
        prefix: res.prefix,
        session_token: res.session_token,
        expires_at: res.expires_at,
      });
      toast({ title: `Halo, ${res.name}!`, description: "Berhasil masuk ke dashboard reseller" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Gagal login", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4 cyber-grid">
      <div className="w-full max-w-md">
        <div className="glass rounded-2xl border border-border p-6 sm:p-8 shadow-xl">
          <div className="flex flex-col items-center mb-6 gap-3">
            <div className="h-14 w-14 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
              <ShoppingBag className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-black font-heading text-foreground">
                Reseller <span className="neon-text">Panel</span>
              </h1>
              <p className="text-xs text-muted-foreground mt-1">Masuk untuk membuat token akses show</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> Nomor HP
              </label>
              <Input
                type="tel"
                placeholder="08xxxxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading}
                autoComplete="tel"
                inputMode="tel"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" /> Sandi
              </label>
              <Input
                type="password"
                placeholder="Masukkan sandi"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="current-password"
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Memproses..." : "Masuk"}
            </Button>
          </form>

          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            Akses reseller diberikan oleh admin. Hubungi admin jika sandi terlupa.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResellerLogin;
