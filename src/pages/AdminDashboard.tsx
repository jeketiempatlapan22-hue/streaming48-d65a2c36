import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { withRetry, withTimeout } from "@/lib/queryCache";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lazy, Suspense } from "react";

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

const AdminDashboard = () => {
  const [activeSection, setActiveSection] = useState("live");
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authCheckNonce, setAuthCheckNonce] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

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

    const checkAuth = async () => {
      try {
        setAuthError("");

        const sessionResult = await runWithTimeoutRetry(
          async () => await supabase.auth.getSession(),
          10_000,
          1
        );

        if (cancelled) return;
        const session = (sessionResult.data as any)?.session;

        if (!session?.user) { navigate("/admin"); return; }

        const roleResult = await runWithTimeoutRetry(
          async () => await supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" }),
          8_000,
          2
        );

        if (cancelled) return;

        if (roleResult.error) {
          setAuthError("Server sedang sibuk, gagal verifikasi akses admin. Silakan coba lagi.");
          setLoading(false);
          return;
        }

        if (!roleResult.data) { await supabase.auth.signOut(); navigate("/admin"); return; }
        setLoading(false);
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
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
      case "orders": return <SubscriptionOrderManager />;
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
        {/* Desktop header with notifications */}
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
