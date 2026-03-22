import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Lock, ArrowLeft, CheckCircle2, Shield } from "lucide-react";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { toast } = useToast();

  // Handle Supabase recovery flow (from email link)
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return;
    if (password !== confirmPassword) {
      toast({ title: "Gagal", description: "Password tidak cocok", variant: "destructive" });
      return;
    }
    setLoading(true);

    if (token) {
      // Admin-approved reset via edge function
      const { data, error } = await supabase.functions.invoke("apply-password-reset", {
        body: { short_id: token, new_password: password },
      });

      if (error || !data?.success) {
        toast({
          title: "Gagal",
          description: data?.error || error?.message || "Terjadi kesalahan",
          variant: "destructive",
        });
      } else {
        setSuccess(true);
      }
    } else {
      // Supabase recovery flow
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast({ title: "Gagal", description: error.message, variant: "destructive" });
      } else {
        setSuccess(true);
      }
    }
    setLoading(false);
  };

  if (!token && !window.location.hash.includes('type=recovery')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center space-y-4">
          <Shield className="mx-auto h-12 w-12 text-primary" />
          <p className="text-sm text-muted-foreground">Link reset tidak valid.</p>
          <button onClick={() => navigate("/auth")} className="flex items-center justify-center gap-2 text-sm text-primary hover:underline mx-auto">
            <ArrowLeft className="h-4 w-4" /> Kembali ke Login
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <Shield className="mx-auto h-12 w-12 text-primary" />
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
          <h1 className="text-xl font-bold text-foreground">Password Berhasil Diubah!</h1>
          <p className="text-sm text-muted-foreground">Silakan login menggunakan password baru kamu.</p>
          <Button onClick={() => navigate("/auth")} className="w-full">Masuk Sekarang</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Shield className="mx-auto mb-4 h-12 w-12 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Buat Password Baru</h1>
          <p className="mt-2 text-sm text-muted-foreground">Masukkan password baru untuk akunmu</p>
        </div>
        <form onSubmit={handleReset} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Password Baru</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 6 karakter" required minLength={6} className="bg-background pl-10" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Konfirmasi Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Ketik ulang password" required minLength={6} className="bg-background pl-10" />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={loading || password.length < 6 || password !== confirmPassword}>
            {loading ? "Menyimpan..." : "Simpan Password Baru"}
          </Button>
        </form>
        <button onClick={() => navigate("/auth")} className="mt-4 flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Kembali ke Login
        </button>
      </div>
    </div>
  );
};

export default ResetPassword;
