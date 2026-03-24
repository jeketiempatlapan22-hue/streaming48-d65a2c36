import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { checkClientRateLimit, getRateLimitRemaining } from "@/lib/rateLimiter";
import { recordAuthMetric } from "@/lib/authMetrics";
import logo from "@/assets/logo.png";

const TRANSIENT_AUTH_ERROR = /timeout|timed out|deadline|504|500|failed to fetch|networkerror|network request failed|load failed|connection/i;

const AdminLogin = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [checkingSession, setCheckingSession] = useState(true);
  const submitRef = useRef(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Check if already logged in as admin — skip login page
  useEffect(() => {
    const check = async () => {
      try {
        const { data: { session } } = await Promise.race([
          supabase.auth.getSession(),
          new Promise<{ data: { session: null } }>((r) => setTimeout(() => r({ data: { session: null } }), 2000)),
        ]);
        if (!session?.user) { setCheckingSession(false); return; }
        const { data: isAdmin } = await Promise.race([
          supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" }),
          new Promise<{ data: false }>((r) => setTimeout(() => r({ data: false }), 3000)),
        ]);
        if (isAdmin) navigate("/admin/dashboard");
        else setCheckingSession(false);
      } catch {
        setCheckingSession(false);
      }
    };
    check();
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitRef.current || loading) return;
    submitRef.current = true;

    if (!checkClientRateLimit("admin-login", 5, 60_000)) {
      const remaining = getRateLimitRemaining("admin-login");
      setCooldown(remaining);
      toast({ title: "Terlalu banyak percobaan", description: `Tunggu ${remaining} detik lagi.`, variant: "destructive" });
      submitRef.current = false;
      return;
    }

    setLoading(true);
    const loginStart = performance.now();

    try {
      // Step 1: Sign in with 15s timeout + 2 retries
      let authResult: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        authResult = await Promise.race([
          supabase.auth.signInWithPassword({ email, password }),
          new Promise<{ data: null; error: { message: string } }>((r) =>
            setTimeout(() => r({ data: null, error: { message: "Login timeout" } }), 15_000)
          ),
        ]);
        if (!authResult.error) break;
        if (!TRANSIENT_AUTH_ERROR.test(String(authResult.error?.message || ""))) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
      }

      if (authResult.error || !authResult.data?.session?.user) {
        const ms = Math.round(performance.now() - loginStart);
        const msg = String(authResult.error?.message || "Login gagal");
        const isTimeout = TRANSIENT_AUTH_ERROR.test(msg);
        
        // If timeout, check if session was actually created
        if (isTimeout) {
          const sessionCheck = await Promise.race([
            supabase.auth.getSession(),
            new Promise<{ data: { session: null } }>((r) => setTimeout(() => r({ data: { session: null } }), 4000)),
          ]).catch(() => ({ data: { session: null } }));

          if ((sessionCheck.data as any)?.session?.user) {
            recordAuthMetric("login_success_late", ms, "admin");
            navigate("/admin/dashboard");
            return;
          }
        }

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

      // Step 2: Check admin role — 3 attempts with 8s timeout each
      let isAdmin = false;
      let roleCheckFailed = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        const roleResult = await Promise.race([
          Promise.resolve(supabase.rpc("has_role", { _user_id: userId, _role: "admin" })),
          new Promise<{ data: null; error: { message: string } }>((r) =>
            setTimeout(() => r({ data: null, error: { message: "Role check timeout" } }), 8_000)
          ),
        ]);

        if (roleResult.data) { isAdmin = true; break; }
        if (!roleResult.error) break; // RPC returned false
        roleCheckFailed = true;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
      }

      if (isAdmin) {
        navigate("/admin/dashboard");
        return;
      }

      if (roleCheckFailed) {
        // Can't verify role — let dashboard handle retry
        recordAuthMetric("role_check_timeout", undefined, "admin", "Login page - all attempts failed");
        toast({
          title: "Verifikasi admin tertunda",
          description: "Session tersimpan. Kami arahkan ke dashboard.",
        });
        navigate("/admin/dashboard");
        return;
      }

      // Confirmed not admin
      recordAuthMetric("role_check_fail", undefined, "admin", "Not admin");
      await supabase.auth.signOut();
      toast({ title: "Akses ditolak", description: "Anda tidak memiliki akses admin.", variant: "destructive" });
    } catch {
      toast({ title: "Error", description: "Koneksi bermasalah, coba lagi.", variant: "destructive" });
    } finally {
      setLoading(false);
      submitRef.current = false;
    }
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@realtime48.com" required className="bg-background" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="bg-background" />
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
