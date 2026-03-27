import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lazy, Suspense } from "react";
import { recordAuthMetric } from "@/lib/authMetrics";

const AdminDashboardStats = lazy(() => import("@/components/admin/AdminDashboardStats"));
const LiveControl = lazy(() => import("@/components/admin/LiveControl"));
const TokenFactory = lazy(() => import("@/components/admin/TokenFactory"));
const ShowManager = lazy(() => import("@/components/admin/ShowManager"));
const CoinPackageManager = lazy(() => import("@/components/admin/CoinPackageManager"));
const CoinOrderManager = lazy(() => import("@/components/admin/CoinOrderManager"));
const SiteSettingsManager = lazy(() => import("@/components/admin/SiteSettingsManager"));
const AdminMonitor = lazy(() => import("@/components/admin/AdminMonitor"));
const SubscriptionOrderManager = lazy(() => import("@/components/admin/SubscriptionOrderManager"));
const SecurityLogManager = lazy(() => import("@/components/admin/SecurityLogManager"));
const SystemHealthCheck = lazy(() => import("@/components/admin/SystemHealthCheck"));
const LandingDescriptionManager = lazy(() => import("@/components/admin/LandingDescriptionManager"));
const ChatModeratorManager = lazy(() => import("@/components/admin/ChatModeratorManager"));
const PlaylistManager = lazy(() => import("@/components/admin/PlaylistManager"));
const AdminLiveLogs = lazy(() => import("@/components/admin/AdminLiveLogs"));
const AdminOrderNotifications = lazy(() => import("@/components/admin/AdminOrderNotifications"));
const AdminSettings = lazy(() => import("@/components/admin/AdminSettings"));
const AdminNotifications = lazy(() => import("@/components/admin/AdminNotifications"));
const ModeratorAccountManager = lazy(() => import("@/components/admin/ModeratorAccountManager"));
const UserManager = lazy(() => import("@/components/admin/UserManager"));
const AdminBroadcast = lazy(() => import("@/components/admin/AdminBroadcast"));
const MediaLibrary = lazy(() => import("@/components/admin/MediaLibrary"));
const AdminAuthMetrics = lazy(() => import("@/components/admin/AdminAuthMetrics"));
const AdminTrafficMonitor = lazy(() => import("@/components/admin/AdminTrafficMonitor"));

/** Safe race: returns result or fallback after timeout */
async function raceTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const AdminDashboard = () => {
  const [activeSection, setActiveSection] = useState("live");
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authCheckNonce, setAuthCheckNonce] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const checkAuth = async () => {
      try {
        setAuthError("");
        const start = performance.now();

        // Step 1: Get session with 10s timeout
        const sessionResult = await raceTimeout(
          supabase.auth.getSession(),
          10_000,
          { data: { session: null }, error: { message: "Session timeout" } } as any
        );

        if (cancelled) return;

        const session = (sessionResult.data as any)?.session;
        if (!session?.user) {
          // Check if error was timeout vs no session
          if (sessionResult.error) {
            setAuthError("Server sedang sibuk, gagal memuat session admin. Silakan coba lagi.");
            setLoading(false);
            return;
          }
          navigate("/admin");
          return;
        }

        // Step 2: Check admin role with 8s timeout — 3 attempts
        let isAdmin = false;
        let roleError = false;

        for (let attempt = 0; attempt < 3; attempt++) {
          const roleResult = await raceTimeout(
            Promise.resolve(supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" })),
            8_000,
            { data: null, error: { message: "Role check timeout" } } as any
          );

          if (cancelled) return;

          if (roleResult.data) {
            isAdmin = true;
            break;
          }

          if (!roleResult.error) {
            // RPC returned false — user is not admin
            break;
          }

          // Error/timeout — retry after short delay
          roleError = true;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
        }

        if (cancelled) return;

        const ms = Math.round(performance.now() - start);

        if (isAdmin) {
          recordAuthMetric("dashboard_auth_success", ms, "admin");
          setLoading(false);
          return;
        }

        if (roleError) {
          // All retries failed — show retry UI instead of kicking out
          recordAuthMetric("role_check_timeout", ms, "admin", "All 3 attempts failed");
          setAuthError("Server sedang sibuk, gagal verifikasi akses admin. Silakan coba lagi.");
          setLoading(false);
          return;
        }

        // User is authenticated but not admin
        recordAuthMetric("role_check_fail", ms, "admin", "Not admin");
        await supabase.auth.signOut();
        navigate("/admin");
      } catch {
        if (!cancelled) {
          setAuthError("Tidak bisa terhubung ke server saat ini.");
          setLoading(false);
        }
      }
    };
    checkAuth();
    return () => { cancelled = true; };
  }, [navigate, authCheckNonce]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/admin"); };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-muted-foreground">Memverifikasi akses admin...</p>
      </div>
    </div>
  );

  if (authError) return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center space-y-4">
        <p className="text-sm text-muted-foreground">{authError}</p>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => { setLoading(true); setAuthCheckNonce((n) => n + 1); }}>
            Coba lagi
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => navigate("/admin")}>
            Kembali
          </Button>
        </div>
      </div>
    </div>
  );

  const renderSection = () => {
    switch (activeSection) {
      case "live": return <><AdminDashboardStats /><div className="mt-6"><LiveControl /></div></>;
      case "tokens": return <TokenFactory />;
      case "shows": return <ShowManager />;
      case "orders": return <SubscriptionOrderManager mode="membership" />;
      case "show-orders": return <SubscriptionOrderManager mode="regular" />;
      case "coin-packages": return <CoinPackageManager />;
      case "coin-orders": return <CoinOrderManager />;
      case "descriptions": return <LandingDescriptionManager />;
      case "security": return <SecurityLogManager />;
      case "health": return <SystemHealthCheck />;
      case "logs": return <AdminLiveLogs />;
      case "monitor": return <AdminMonitor />;
      case "site": return (
        <div className="space-y-6">
          <SiteSettingsManager />
          <AdminBroadcast />
          <AdminSettings />
        </div>
      );
      case "moderators": return (
        <div className="space-y-6">
          <ModeratorAccountManager />
          <ChatModeratorManager />
        </div>
      );
      case "users": return <UserManager />;
      case "media": return <MediaLibrary />;
      case "auth-metrics": return <AdminAuthMetrics />;
      case "traffic": return <AdminTrafficMonitor />;
      default: return <LiveControl />;
    }
  };

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden">
      <Suspense fallback={null}><AdminOrderNotifications /></Suspense>
      <AdminSidebar activeSection={activeSection} onSectionChange={setActiveSection} onLogout={handleLogout} mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3 md:hidden">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></Button>
          <span className="flex-1 text-sm font-bold text-foreground">Real<span className="text-primary">Time48</span></span>
        </header>
        <header className="hidden shrink-0 items-center justify-end gap-3 border-b border-border bg-card px-6 py-3 md:flex">
          <Suspense fallback={null}><AdminNotifications /></Suspense>
        </header>
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-6 lg:p-8">
          <Suspense fallback={<div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
            {renderSection()}
          </Suspense>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
