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
  <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
    <img src="/logo.png" alt="RealTime48" className="h-16 w-16 rounded-full object-cover animate-pulse" />
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
