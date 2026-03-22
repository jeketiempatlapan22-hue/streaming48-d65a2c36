import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import LiveControl from "@/components/admin/LiveControl";
import TokenFactory from "@/components/admin/TokenFactory";
import ShowManager from "@/components/admin/ShowManager";
import CoinPackageManager from "@/components/admin/CoinPackageManager";
import CoinOrderManager from "@/components/admin/CoinOrderManager";
import SiteSettingsManager from "@/components/admin/SiteSettingsManager";

const AdminDashboard = () => {
  const [activeSection, setActiveSection] = useState("live");
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { navigate("/admin"); return; }
      const { data } = await supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" });
      if (!data) { await supabase.auth.signOut(); navigate("/admin"); return; }
      setLoading(false);
    };
    checkAuth();
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/admin");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const renderSection = () => {
    switch (activeSection) {
      case "live": return <LiveControl />;
      case "tokens": return <TokenFactory />;
      case "shows": return <ShowManager />;
      case "coin-packages": return <CoinPackageManager />;
      case "coin-orders": return <CoinOrderManager />;
      case "monitor": return <div className="text-muted-foreground text-center py-16">Monitor — Coming soon</div>;
      case "site": return <SiteSettingsManager />;
      default: return <LiveControl />;
    }
  };

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden">
      <AdminSidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onLogout={handleLogout}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3 md:hidden">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <span className="flex-1 text-sm font-bold text-foreground">Real<span className="text-primary">Time48</span></span>
        </header>
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-6 lg:p-8">
          {renderSection()}
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
