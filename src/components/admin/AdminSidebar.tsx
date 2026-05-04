import { useEffect, useMemo, useState } from "react";
import logo from "@/assets/logo.png";
import {
  Radio, Key, Monitor, Settings, LogOut, Theater, FileText, ClipboardList, Coins, Package,
  Shield, Activity, ScrollText, UsersRound, UserCog, Image, BarChart3, Gauge, Ticket,
  KeyRound, ShoppingBag, Sparkles, Tv2, ChevronDown, MessageSquare,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface AdminSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  onLogout: () => void;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

interface SectionItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface SectionGroup {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: SectionItem[];
}

// Grouping menu admin berdasarkan fungsi/kebutuhan operasional.
// ID setiap item dipertahankan agar switch(activeSection) di AdminDashboard tetap valid.
const sectionGroups: SectionGroup[] = [
  {
    id: "ops",
    label: "Operasional Live",
    icon: Radio,
    items: [
      { id: "live", label: "Live & Playlist", icon: Radio },
      { id: "monitor", label: "Monitor, Poll & Quiz", icon: Monitor },
      { id: "restream", label: "Halaman Restream", icon: Tv2 },
    ],
  },
  {
    id: "content",
    label: "Show & Konten",
    icon: Theater,
    items: [
      { id: "shows", label: "Show Manager", icon: Theater },
      { id: "replay-passwords", label: "Sandi Global Replay", icon: KeyRound },
      { id: "descriptions", label: "Deskripsi LP", icon: FileText },
      { id: "member-photos", label: "Foto Member", icon: UsersRound },
      { id: "media", label: "Media Library", icon: Image },
    ],
  },
  {
    id: "tokens",
    label: "Token & Akses",
    icon: Key,
    items: [
      { id: "tokens", label: "Token Factory", icon: Key },
      { id: "manual-token", label: "Token Manual + WA", icon: Sparkles },
      { id: "password-resets", label: "Reset Password", icon: KeyRound },
    ],
  },
  {
    id: "orders",
    label: "Order & Pembayaran",
    icon: ShoppingBag,
    items: [
      { id: "show-orders", label: "Order Show", icon: Ticket },
      { id: "orders", label: "Order Membership", icon: ClipboardList },
      { id: "coin-orders", label: "Order Koin", icon: Coins },
      { id: "coin-packages", label: "Paket Koin", icon: Package },
    ],
  },
  {
    id: "team",
    label: "User & Tim",
    icon: UsersRound,
    items: [
      { id: "users", label: "Manajemen User", icon: UserCog },
      { id: "moderators", label: "Akun Moderator", icon: UsersRound },
      { id: "resellers", label: "Reseller", icon: ShoppingBag },
      { id: "reseller-audit", label: "Audit Token Reseller", icon: ScrollText },
    ],
  },
  {
    id: "security",
    label: "Keamanan & Monitoring",
    icon: Shield,
    items: [
      { id: "feedback", label: "Kritik & Saran", icon: MessageSquare },
      { id: "security", label: "Security Log", icon: Shield },
      { id: "health", label: "System Health", icon: Activity },
      { id: "logs", label: "Live Logs", icon: ScrollText },
      { id: "auth-metrics", label: "Auth Metrics", icon: BarChart3 },
      { id: "traffic", label: "Traffic Monitor", icon: Gauge },
      { id: "rate-limits", label: "Rate Limits", icon: Shield },
    ],
  },
  {
    id: "settings",
    label: "Pengaturan",
    icon: Settings,
    items: [
      { id: "site", label: "Pengaturan", icon: Settings },
    ],
  },
];

const STORAGE_KEY = "admin_sidebar_groups_open_v1";

const AdminSidebar = ({ activeSection, onSectionChange, onLogout, mobileOpen, onMobileOpenChange }: AdminSidebarProps) => {
  // Map: groupId -> activeSection's parent group (for auto-expand)
  const groupOfActive = useMemo(() => {
    return sectionGroups.find((g) => g.items.some((i) => i.id === activeSection))?.id ?? null;
  }, [activeSection]);

  // Persisted open/closed state per group. Default: all open on first visit.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return Object.fromEntries(sectionGroups.map((g) => [g.id, true]));
  });

  // Auto-expand the group containing the active section.
  useEffect(() => {
    if (!groupOfActive) return;
    setOpenGroups((prev) => (prev[groupOfActive] ? prev : { ...prev, [groupOfActive]: true }));
  }, [groupOfActive]);

  // Persist preferences across sessions.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(openGroups)); } catch {}
  }, [openGroups]);

  const toggleGroup = (id: string) => setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleSectionChange = (id: string) => {
    onSectionChange(id);
    onMobileOpenChange?.(false);
  };

  const sidebarContent = (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <img src={logo} alt="RealTime48" className="h-8 w-8 rounded-full object-cover" />
        <div className="flex flex-col">
          <span className="text-sm font-black font-heading text-foreground">Real<span className="text-primary">Time48</span></span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Admin Panel</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {sectionGroups.map((group, idx) => {
          const GroupIcon = group.icon;
          const isOpen = openGroups[group.id] ?? true;
          const hasActive = group.items.some((i) => i.id === activeSection);
          return (
            <div key={group.id} className={idx > 0 ? "mt-1 border-t border-border/40 pt-2" : ""}>
              {/* Group header / toggle */}
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  hasActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
                aria-expanded={isOpen}
                aria-controls={`admin-group-${group.id}`}
              >
                <span className="flex items-center gap-2">
                  <GroupIcon className="h-3.5 w-3.5" />
                  {group.label}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-0" : "-rotate-90"}`}
                />
              </button>

              {/* Group items */}
              {isOpen && (
                <div id={`admin-group-${group.id}`} className="mt-1 space-y-0.5">
                  {group.items.map((item) => {
                    const ItemIcon = item.icon;
                    const isActive = activeSection === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSectionChange(item.id)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                        }`}
                      >
                        <ItemIcon className="h-4 w-4" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <button
          onClick={() => { onLogout(); onMobileOpenChange?.(false); }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />Logout
        </button>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden w-56 flex-col border-r border-border bg-card md:flex lg:w-64 2xl:w-72">{sidebarContent}</aside>
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent
          side="left"
          className="flex h-[100dvh] max-h-[100dvh] w-[85vw] max-w-xs flex-col gap-0 overflow-hidden p-0 [&>button]:z-10"
          style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          <SheetHeader className="sr-only"><SheetTitle>Menu Admin</SheetTitle></SheetHeader>
          {sidebarContent}
        </SheetContent>
      </Sheet>
    </>
  );
};

export default AdminSidebar;
