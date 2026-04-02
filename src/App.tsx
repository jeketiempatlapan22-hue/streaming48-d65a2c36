import { lazy, Suspense, useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";

const Index = lazy(() => import("./pages/Index"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const ViewerAuth = lazy(() => import("./pages/ViewerAuth"));
const LivePage = lazy(() => import("./pages/LivePage"));
const CoinShop = lazy(() => import("./pages/CoinShop"));
const SchedulePage = lazy(() => import("./pages/SchedulePage"));
const ReplayPage = lazy(() => import("./pages/ReplayPage"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const InstallPage = lazy(() => import("./pages/InstallPage"));
const ViewerProfile = lazy(() => import("./pages/ViewerProfile"));
const MembershipPage = lazy(() => import("./pages/MembershipPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const MaintenancePage = ({ message }: { message?: string }) => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center gap-6">
    <div className="h-24 w-24 rounded-full border-2 border-border/60 overflow-hidden shadow-lg">
      <img src="/logo.png" alt="RealTime48" className="h-full w-full object-cover" />
    </div>
    <div className="space-y-3 max-w-sm">
      <h1 className="text-2xl font-bold text-foreground">
        Real<span className="neon-text">Time48</span>
      </h1>
      <p className="text-lg font-semibold text-foreground">🔧 Sedang Maintenance</p>
      <p className="text-sm text-muted-foreground">
        {message || "Website sedang dalam perbaikan sementara. Silakan kembali dalam beberapa menit."}
      </p>
    </div>
  </div>
);

const PageLoader = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6 cyber-grid relative overflow-hidden">
    {/* Scan line effect */}
    <div className="absolute inset-0 scan-line pointer-events-none" />
    <div className="relative">
      <div className="h-24 w-24 rounded-full border border-[hsl(var(--neon-cyan)/0.4)] overflow-hidden shadow-[0_0_30px_hsl(var(--neon-cyan)/0.2)] animate-float">
        <img src="/logo.png" alt="RealTime48" className="h-full w-full object-cover" />
      </div>
      <div className="absolute -inset-3 rounded-full border border-[hsl(var(--neon-cyan)/0.2)] animate-ping opacity-20" />
      <div className="absolute -inset-6 rounded-full border border-[hsl(var(--neon-magenta)/0.1)] animate-pulse opacity-15" />
    </div>
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm font-bold text-foreground">Real<span className="neon-text">Time48</span></p>
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--neon-cyan))] animate-pulse shadow-[0_0_6px_hsl(var(--neon-cyan)/0.6)]" style={{ animationDelay: `${i * 200}ms` }} />
        ))}
      </div>
    </div>
  </div>
);

/** Wrapper that checks maintenance_mode from site_settings and blocks non-admin routes */
const MaintenanceGate = ({ children }: { children: React.ReactNode }) => {
  const [maintenance, setMaintenance] = useState<boolean | null>(null);
  const [maintenanceMsg, setMaintenanceMsg] = useState("");
  const location = useLocation();

  useEffect(() => {
    const check = async () => {
      try {
        const { data } = await supabase
          .from("site_settings")
          .select("key, value")
          .in("key", ["maintenance_mode", "maintenance_message"]);

        const modeRow = data?.find((r: any) => r.key === "maintenance_mode");
        const msgRow = data?.find((r: any) => r.key === "maintenance_message");
        setMaintenance(modeRow?.value === "true");
        setMaintenanceMsg(msgRow?.value || "");
      } catch {
        setMaintenance(false);
      }
    };
    check();

    // Listen for realtime changes to instantly toggle
    const channel = supabase
      .channel("maintenance-mode")
      .on("postgres_changes", { event: "*", schema: "public", table: "site_settings" }, (payload) => {
        const row = payload.new as any;
        if (row?.key === "maintenance_mode") setMaintenance(row.value === "true");
        if (row?.key === "maintenance_message") setMaintenanceMsg(row.value || "");
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Still loading
  if (maintenance === null) return <PageLoader />;

  // Admin routes always pass through
  const isAdminRoute = location.pathname.startsWith("/admin");
  if (maintenance && !isAdminRoute) {
    return <MaintenancePage message={maintenanceMsg} />;
  }

  return <>{children}</>;
};

const App = () => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <MaintenanceGate>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/admin" element={<AdminLogin />} />
                  <Route path="/admin/dashboard" element={<AdminDashboard />} />
                  <Route path="/auth" element={<ViewerAuth />} />
                  <Route path="/live" element={<LivePage />} />
                  <Route path="/coins" element={<CoinShop />} />
                  <Route path="/schedule" element={<SchedulePage />} />
                  <Route path="/replay" element={<ReplayPage />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/install" element={<InstallPage />} />
                  <Route path="/profile" element={<ViewerProfile />} />
                  <Route path="/membership" element={<MembershipPage />} />
                  <Route path="/faq" element={<FaqPage />} />
                  <Route path="/about" element={<AboutPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </MaintenanceGate>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;