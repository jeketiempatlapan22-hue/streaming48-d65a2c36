import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { checkClientRateLimit, getRateLimitRemaining } from "@/lib/rateLimiter";
import { withRetry, withTimeout } from "@/lib/queryCache";
import { recordAuthMetric } from "@/lib/authMetrics";
import logo from "@/assets/logo.png";

const AdminLogin = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const submitRef = useRef(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    // Debounce: prevent double submit
    if (submitRef.current || loading) return;
    submitRef.current = true;

    // Client-side rate limit: 5 attempts per 60 seconds
    if (!checkClientRateLimit("admin-login", 5, 60_000)) {
      const remaining = getRateLimitRemaining("admin-login");
      setCooldown(remaining);
      toast({ title: "Terlalu banyak percobaan", description: `Tunggu ${remaining} detik lagi.`, variant: "destructive" });
      submitRef.current = false;
      return;
    }

    setLoading(true);

    const runWithTimeoutRetry = async <T,>(
      request: () => Promise<{ data: T | null; error: any }>,
      timeoutMs: number,
      retries: number
    ) => {
      return withRetry(
        () =>
          withTimeout(request(), timeoutMs, "Permintaan ke server timeout")
            .then((result) => ({ data: result.data, error: result.error }))
            .catch((error) => ({ data: null, error })),
        retries,
        700
      );
    };

    try {
      const loginStart = performance.now();
      const authResult = await runWithTimeoutRetry(
        () => supabase.auth.signInWithPassword({ email, password }),
        12_000,
        2
      );

      if (authResult.error || !authResult.data?.session?.user) {
        const ms = Math.round(performance.now() - loginStart);
        const msg = String(authResult.error?.message || "Login gagal");
        const isTimeout = /timeout|timed out|deadline exceeded|upstream request timeout/i.test(msg);
        recordAuthMetric(isTimeout ? "login_timeout" : "login_error", ms, "admin", msg);
        toast({
          title: "Login gagal",
          description: isTimeout ? "Server sedang sibuk, silakan coba lagi." : msg,
          variant: "destructive",
        });
        return;
      }
      const loginMs = Math.round(performance.now() - loginStart);
      recordAuthMetric("login_success", loginMs, "admin");

      const userId = authResult.data.session.user.id;
      if (!userId) {
        toast({ title: "Error", description: "User not found", variant: "destructive" });
        return;
      }

      const adminCheck = await runWithTimeoutRetry(
        async () => await supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
        8_000,
        3
      );

      if (adminCheck.error) {
        toast({
          title: "Verifikasi admin tertunda",
          description: "Session login tersimpan. Kami arahkan ke dashboard untuk verifikasi ulang otomatis.",
        });
        navigate("/admin/dashboard");
        return;
      }

      if (!adminCheck.data) {
        await supabase.auth.signOut();
        toast({ title: "Akses ditolak", description: "Anda tidak memiliki akses admin.", variant: "destructive" });
        return;
      }

      navigate("/admin/dashboard");
    } catch {
      toast({ title: "Error", description: "Koneksi bermasalah, coba lagi.", variant: "destructive" });
    } finally {
      setLoading(false);
      submitRef.current = false;
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full overflow-hidden shadow-[0_0_20px_hsl(var(--primary)/0.3)] animate-float">
            <img src={logo} alt="RealTime48" className="h-full w-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Real<span className="text-primary">Time48</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Admin Panel</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@realtime48.com"
              required
              className="bg-background"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="bg-background"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading || cooldown > 0}>
            {loading ? "Logging in..." : cooldown > 0 ? `Tunggu ${cooldown}s` : "Login"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;
