import logo from "@/assets/logo.png";
import { Radio, Key, Monitor, Settings, LogOut, Theater, FileText, ClipboardList, Coins, Package, BarChart3, Shield, Activity, ScrollText, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface AdminSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  onLogout: () => void;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

const sections = [
  { id: "live", label: "Live & Playlist", icon: Radio },
  { id: "tokens", label: "Token Factory", icon: Key },
  { id: "shows", label: "Show Manager", icon: Theater },
  { id: "orders", label: "Order Langganan", icon: ClipboardList },
  { id: "coin-packages", label: "Paket Koin", icon: Package },
  { id: "coin-orders", label: "Order Koin", icon: Coins },
  { id: "descriptions", label: "Deskripsi LP", icon: FileText },
  { id: "polls", label: "Live Poll", icon: BarChart3 },
  { id: "security", label: "Security Log", icon: Shield },
  { id: "health", label: "System Health", icon: Activity },
  { id: "logs", label: "Live Logs", icon: ScrollText },
  { id: "monitor", label: "Monitor", icon: Monitor },
  { id: "site", label: "Pengaturan", icon: Settings },
];

const AdminSidebar = ({ activeSection, onSectionChange, onLogout, mobileOpen, onMobileOpenChange }: AdminSidebarProps) => {
  const handleSectionChange = (id: string) => { onSectionChange(id); onMobileOpenChange?.(false); };

  const sidebarContent = (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <img src={logo} alt="RealTime48" className="h-8 w-8 rounded-full object-cover" />
        <div className="flex flex-col">
          <span className="text-sm font-bold text-foreground">Real<span className="text-primary">Time48</span></span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Admin Panel</span>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <button key={s.id} onClick={() => handleSectionChange(s.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                activeSection === s.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}>
              <Icon className="h-4 w-4" />{s.label}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <button onClick={() => { onLogout(); onMobileOpenChange?.(false); }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive">
          <LogOut className="h-4 w-4" />Logout
        </button>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden w-56 flex-col border-r border-border bg-card md:flex lg:w-64">{sidebarContent}</aside>
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="flex w-72 flex-col p-0">
          <SheetHeader className="sr-only"><SheetTitle>Menu</SheetTitle></SheetHeader>
          {sidebarContent}
        </SheetContent>
      </Sheet>
    </>
  );
};

export default AdminSidebar;
