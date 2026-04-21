import { useState, useEffect, lazy, Suspense } from "react";

const ResellerLogin = lazy(() => import("@/components/reseller/ResellerLogin"));
const ResellerDashboard = lazy(() => import("@/components/reseller/ResellerDashboard"));

const STORAGE_KEY = "rt48_reseller_session_v1";

export type ResellerSession = {
  reseller_id: string;
  name: string;
  phone: string;
  prefix: string;
  session_token: string;
  expires_at: string;
};

const Loader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="text-center space-y-3">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
      <p className="text-xs text-muted-foreground">Memuat...</p>
    </div>
  </div>
);

const ResellerPage = () => {
  const [session, setSession] = useState<ResellerSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ResellerSession;
        if (new Date(parsed.expires_at).getTime() > Date.now()) {
          setSession(parsed);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch { /* noop */ }
    setLoading(false);
  }, []);

  const handleLogin = (s: ResellerSession) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    setSession(s);
  };

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  };

  if (loading) return <Loader />;

  return (
    <Suspense fallback={<Loader />}>
      {session ? (
        <ResellerDashboard session={session} onLogout={handleLogout} />
      ) : (
        <ResellerLogin onLogin={handleLogin} />
      )}
    </Suspense>
  );
};

export default ResellerPage;
