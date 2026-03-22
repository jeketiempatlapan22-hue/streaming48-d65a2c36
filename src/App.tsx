import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";

const Index = lazy(() => import("./pages/Index"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const ViewerAuth = lazy(() => import("./pages/ViewerAuth"));
const LivePage = lazy(() => import("./pages/LivePage"));
const CoinShop = lazy(() => import("./pages/CoinShop"));
const SchedulePage = lazy(() => import("./pages/SchedulePage"));
const ReplayPage = lazy(() => import("./pages/ReplayPage"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const InstallPage = lazy(() => import("./pages/InstallPage"));
const ViewerProfile = lazy(() => import("./pages/ViewerProfile"));
const MembershipPage = lazy(() => import("./pages/MembershipPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6">
    <div className="relative">
      <div className="h-24 w-24 rounded-full border-2 border-border/60 overflow-hidden shadow-lg animate-float">
        <img src="/logo.png" alt="RealTime48" className="h-full w-full object-cover" />
      </div>
      <div className="absolute -inset-2 rounded-full border border-primary/20 animate-ping opacity-30" />
    </div>
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm font-bold text-foreground">Real<span className="text-primary">Time48</span></p>
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
        ))}
      </div>
    </div>
  </div>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
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
              <Route path="/install" element={<InstallPage />} />
              <Route path="/profile" element={<ViewerProfile />} />
              <Route path="/membership" element={<MembershipPage />} />
              <Route path="/faq" element={<FaqPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
