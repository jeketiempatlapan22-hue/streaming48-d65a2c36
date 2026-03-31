import { useState, useEffect, useRef } from "react";
import logo from "@/assets/logo.png";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Coins, Mail, Lock, ArrowLeft, Phone, User, Gift, Eye, EyeOff } from "lucide-react";
import { checkClientRateLimit, getRateLimitRemaining } from "@/lib/rateLimiter";
import { recordAuthMetric } from "@/lib/authMetrics";
import { trackFailedLogin } from "@/lib/suspiciousDetector";
import { Turnstile } from "@marsidev/react-turnstile";

type AuthMethod = "phone" | "email";
const TRANSIENT_AUTH_ERROR = /timeout|timed out|deadline|504|500|failed to fetch|networkerror|network request failed|load failed|connection/i;

const ViewerAuth = () => {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [method, setMethod] = useState<AuthMethod>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [failCount, setFailCount] = useState(0);
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref");
  const navigate = useNavigate();
  const submitRef = useRef(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileFailed, setTurnstileFailed] = useState(false);

  useEffect(() => {
    // Check existing session with timeout
    Promise.race([
      supabase.auth.getSession(),
      new Promise<{ data: { session: null } }>((resolve) =>
        setTimeout(() => resolve({ data: { session: null } }), 6000)
      ),
    ])
      .then(({ data: { session } }) => {
        if (session?.user) navigate("/coins");
      })
      .catch(() => {});

    if (refCode) setMode("signup");

    // Load Turnstile site key from site_settings
    supabase.from("site_settings").select("value").eq("key", "turnstile_site_key").single()
      .then(({ data }) => {
        if (data?.value) setTurnstileSiteKey(data.value);
      });
  }, [navigate, refCode]);

  const normalizePhone = (raw: string) => raw.replace(/[^0-9]/g, "");
  const deriveEmail = (phoneNum: string) => `${normalizePhone(phoneNum)}@rt48.user`;
  const getAuthEmail = () => method === "email" ? email.trim() : deriveEmail(phone);
  const isFormValid = () => {
    if (mode === "signup" && !username.trim()) return false;
    if (method === "phone") {
      if (!phoneVerified) return false;
      return normalizePhone(phone).length >= 10 && password.length >= 6;
    }
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

  /** Attempt auth with timeout + 2 retries */
  const authWithRetry = async <T,>(
    fn: () => Promise<{ data: T; error: any }>,
    timeoutMs = 15_000,
    retries = 2
  ): Promise<{ data: T | null; error: any }> => {
    for (let i = 0; i <= retries; i++) {
      try {
        const result = await Promise.race([
          fn(),
          new Promise<{ data: null; error: { message: string } }>((resolve) =>
            setTimeout(() => resolve({ data: null, error: { message: "Request timeout" } }), timeoutMs)
          ),
        ]);
        // If success or non-retryable error, return immediately
        if (!result.error || !TRANSIENT_AUTH_ERROR.test(String(result.error?.message || ""))) {
          return result;
        }
        // On retryable error, wait before retry
        if (i < retries) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      } catch (err: any) {
        if (i === retries) return { data: null, error: err };
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    return { data: null, error: { message: "All retries failed" } };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid() || submitRef.current || loading) return;

    // Turnstile verification (if configured and not failed)
    if (turnstileSiteKey && !turnstileToken && !turnstileFailed) {
      toast.error("Silakan selesaikan verifikasi keamanan terlebih dahulu");
      return;
    }
    if (turnstileSiteKey && turnstileToken) {
      try {
        const { data: verifyResult } = await supabase.functions.invoke("verify-turnstile", {
          body: { token: turnstileToken },
        });
        if (!verifyResult?.success) {
          toast.error("Verifikasi keamanan gagal. Coba lagi.");
          setTurnstileToken(null);
          return;
        }
      } catch {
        // If verification fails, allow through (graceful degradation)
      }
    }

    submitRef.current = true;

    const rlKey = `viewer-auth-${mode}`;
    if (!checkClientRateLimit(rlKey, 8, 60_000)) {
      const remaining = getRateLimitRemaining(rlKey);
      toast.error(`Terlalu banyak percobaan. Tunggu ${remaining} detik.`);
      submitRef.current = false;
      return;
    }

    setLoading(true);
    setLoginError("");
    const authEmail = getAuthEmail();
    const authStart = performance.now();

    try {
      if (mode === "signup") {
        const result = await authWithRetry(
          () => supabase.auth.signUp({ email: authEmail, password, options: { data: { username: username.trim() } } }),
          15_000,
          2
        );

        const ms = Math.round(performance.now() - authStart);

        if (result.error) {
          const msg = String(result.error?.message || "Gagal daftar");
          const isTimeout = TRANSIENT_AUTH_ERROR.test(msg);
          recordAuthMetric(isTimeout ? "signup_timeout" : "signup_error", ms, "viewer", msg);

          if (isTimeout) {
            const sessionCheck = await Promise.race([
              supabase.auth.getSession(),
              new Promise<{ data: { session: null } }>((r) => setTimeout(() => r({ data: { session: null } }), 4000)),
            ]).catch(() => ({ data: { session: null } }));

            if ((sessionCheck.data as any)?.session?.user) {
              recordAuthMetric("signup_success_late", ms, "viewer");
              toast.success("Berhasil mendaftar!");
              if (refCode) await claimReferral(refCode);
              navigate("/coins");
              return;
            }
            toast.error("Server sedang sibuk, coba lagi sebentar.");
          } else if (msg.includes("already registered") || msg.includes("already been registered") || msg.includes("User already registered")) {
            const loginResult = await authWithRetry(
              () => supabase.auth.signInWithPassword({ email: authEmail, password }),
              15_000, 1
            );
            if (!loginResult.error && loginResult.data) {
              recordAuthMetric("login_success", ms, "viewer");
              toast.success("Akun sudah ada, berhasil login!");
              navigate("/coins");
              return;
            }
            setFailCount((c) => c + 1);
            setLoginError("Nomor/email sudah terdaftar tapi password tidak cocok.");
            toast.error("Nomor/email sudah terdaftar tapi password tidak cocok.");
            setMode("login");
          } else if (msg.includes("weak_password") || msg.includes("known to be weak") || msg.includes("Password is known")) {
            // Weak password — use admin edge function to bypass check
            try {
              const { data: fnData, error: fnError } = await supabase.functions.invoke("signup-simple", {
                body: { email: authEmail, password, username: username.trim() },
              });
              if (fnError || !fnData?.success) {
                const fnMsg = fnData?.error || fnError?.message || "";
                if (fnMsg.includes("already registered")) {
                  const loginResult = await authWithRetry(
                    () => supabase.auth.signInWithPassword({ email: authEmail, password }),
                    15_000, 1
                  );
                  if (!loginResult.error) {
                    toast.success("Akun sudah ada, berhasil login!");
                    navigate("/coins");
                    return;
                  }
                  setFailCount((c) => c + 1);
                  setLoginError("Nomor/email sudah terdaftar tapi password tidak cocok.");
                  setMode("login");
                } else {
                  toast.error(fnMsg || "Pendaftaran gagal, coba lagi.");
                }
              } else {
                // User created via admin — now login with original password
                const loginResult = await authWithRetry(
                  () => supabase.auth.signInWithPassword({ email: authEmail, password }),
                  15_000, 2
                );
                if (!loginResult.error) {
                  recordAuthMetric("signup_success", ms, "viewer");
                  toast.success("Berhasil mendaftar!");
                  if (refCode) await claimReferral(refCode);
                  navigate("/coins");
                  return;
                }
                toast.success("Akun berhasil dibuat! Silakan login.");
                setMode("login");
              }
            } catch {
              toast.error("Pendaftaran gagal, coba lagi.");
            }
          } else if (msg.includes("email_address_invalid") || msg.includes("valid email")) {
            toast.error("Format nomor HP atau email tidak valid. Periksa kembali.");
          } else {
            toast.error(msg);
          }
        } else {
          // Check if signup returned a user without session (unconfirmed — shouldn't happen now)
          const signupData = result.data as any;
          if (signupData?.user && !signupData?.session) {
            // Try login immediately (auto-confirm should have confirmed it)
            const loginRetry = await authWithRetry(
              () => supabase.auth.signInWithPassword({ email: authEmail, password }),
              10_000, 1
            );
            if (!loginRetry.error) {
              recordAuthMetric("signup_success", ms, "viewer");
              toast.success("Berhasil mendaftar!");
              if (refCode) await claimReferral(refCode);
              navigate("/coins");
              return;
            }
            toast.success("Akun berhasil dibuat! Silakan login.");
            setMode("login");
          } else {
            recordAuthMetric("signup_success", ms, "viewer");
            toast.success("Berhasil mendaftar!");
            if (refCode) await claimReferral(refCode);
            navigate("/coins");
          }
        }
      } else {
        // LOGIN
        const result = await authWithRetry(
          () => supabase.auth.signInWithPassword({ email: authEmail, password }),
          15_000,
          2
        );

        const ms = Math.round(performance.now() - authStart);

        if (result.error) {
          const sessionCheck = await Promise.race([
            supabase.auth.getSession(),
            new Promise<{ data: { session: null } }>((r) => setTimeout(() => r({ data: { session: null } }), 4000)),
          ]).catch(() => ({ data: { session: null } }));

          if ((sessionCheck.data as any)?.session?.user) {
            recordAuthMetric("login_success_late", ms, "viewer");
            navigate("/coins");
            return;
          }

          const msg = String(result.error?.message || "Login gagal");
          const isTimeout = TRANSIENT_AUTH_ERROR.test(msg);
          recordAuthMetric(isTimeout ? "login_timeout" : "login_error", ms, "viewer", msg);
          trackFailedLogin();

          if (isTimeout) {
            toast.error("Server sedang sibuk, coba lagi sebentar.");
          } else if (msg.includes("Invalid login credentials") || msg.includes("invalid_credentials")) {
            const newFail = failCount + 1;
            setFailCount(newFail);
            if (newFail >= 3) {
              setLoginError("Sudah 3x gagal login. Kemungkinan password kamu salah. Gunakan fitur Lupa Password di bawah untuk reset.");
              toast.error("Password salah. Coba reset password kamu.");
            } else if (newFail >= 2) {
              setLoginError("Password salah. Pastikan password yang kamu masukkan benar, atau gunakan Lupa Password.");
              toast.error("Password salah. Periksa kembali atau reset password.");
            } else {
              setLoginError("Password salah atau akun tidak ditemukan.");
              toast.error("Password salah atau akun tidak ditemukan. Periksa kembali nomor HP/email dan password kamu.");
            }
          } else if (msg.includes("Email not confirmed")) {
            toast.error("Akun belum diverifikasi. Coba daftar ulang dengan nomor/email yang sama.");
            setMode("signup");
          } else {
            toast.error(msg);
          }
        } else {
          recordAuthMetric("login_success", ms, "viewer");
          navigate("/coins");
        }
      }
    } catch {
      toast.error("Koneksi bermasalah, coba lagi.");
    } finally {
      setLoading(false);
      submitRef.current = false;
    }
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
          {method === "phone" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Nomor HP</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setPhoneVerified(false); }} placeholder="08xxxxxxxxxx" required className="bg-background pl-10" />
                </div>
              </div>
              {normalizePhone(phone).length >= 10 && (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 p-3">
                  <Checkbox
                    id="phone-verify"
                    checked={phoneVerified}
                    onCheckedChange={(checked) => setPhoneVerified(checked === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor="phone-verify" className="text-xs text-muted-foreground cursor-pointer leading-relaxed">
                    Saya memverifikasi bahwa nomor <span className="font-bold text-foreground">{phone}</span> adalah nomor HP saya yang aktif dan benar
                  </label>
                </div>
              )}
            </div>
          )}
          {method === "email" && <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label><div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@contoh.com" required className="bg-background pl-10" /></div></div>}
          <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label><div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 6 karakter" required minLength={6} className="bg-background pl-10 pr-10" /><button type="button" tabIndex={-1} onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
          {loginError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <p className="font-medium">{loginError}</p>
              {failCount >= 2 && mode === "login" && (
                <a href="/forgot-password" className="mt-1.5 inline-flex items-center gap-1 font-bold text-primary hover:underline">
                  🔑 Reset Password Sekarang
                </a>
              )}
            </div>
          )}
          {turnstileSiteKey && !turnstileFailed && (
            <div className="flex justify-center">
              <Turnstile
                siteKey={turnstileSiteKey}
                onSuccess={(token) => setTurnstileToken(token)}
                onError={() => { setTurnstileToken(null); setTurnstileFailed(true); }}
                onExpire={() => setTurnstileToken(null)}
                options={{ theme: "dark", size: "compact" }}
              />
            </div>
          )}
          {turnstileFailed && (
            <p className="text-center text-[10px] text-muted-foreground">Verifikasi keamanan tidak tersedia — Anda tetap bisa masuk</p>
          )}
          <Button type="submit" className="w-full" disabled={loading || !isFormValid() || (!!turnstileSiteKey && !turnstileToken)}>{loading ? "Memproses..." : mode === "login" ? "Masuk" : "Daftar"}</Button>
          <p className="text-center text-xs text-muted-foreground">{mode === "login" ? "Belum punya akun?" : "Sudah punya akun?"}<button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setLoginError(""); setFailCount(0); }} className="ml-1 font-medium text-primary hover:underline">{mode === "login" ? "Daftar" : "Masuk"}</button></p>
          {mode === "login" && (
            <p className="text-center text-xs"><a href="/forgot-password" className={`transition-colors ${failCount >= 2 ? "font-bold text-primary" : "text-muted-foreground hover:text-primary"}`}>Lupa password?</a></p>
          )}
        </form>
        <button onClick={() => navigate("/")} className="mt-4 flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Kembali ke Beranda</button>
      </div>
    </div>
  );
};

export default ViewerAuth;
