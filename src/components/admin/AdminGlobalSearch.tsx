import { useState, useEffect } from "react";
import { CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Radio, Key, Monitor, Settings, Theater, FileText, ClipboardList, Coins, Package, Shield, Activity, ScrollText, UsersRound, UserCog, Image, BarChart3, Gauge, Ticket, KeyRound, Search } from "lucide-react";

const sections = [
  { id: "live", label: "Live & Playlist", icon: Radio, keywords: ["live", "stream", "playlist", "siaran"] },
  { id: "tokens", label: "Token Factory", icon: Key, keywords: ["token", "kunci", "akses"] },
  { id: "shows", label: "Show Manager", icon: Theater, keywords: ["show", "pertunjukan", "acara", "replay"] },
  { id: "orders", label: "Order Membership", icon: ClipboardList, keywords: ["order", "pesanan", "membership", "langganan"] },
  { id: "show-orders", label: "Order Show", icon: Ticket, keywords: ["order", "tiket", "show"] },
  { id: "coin-packages", label: "Paket Koin", icon: Package, keywords: ["koin", "paket", "coin", "package"] },
  { id: "coin-orders", label: "Order Koin", icon: Coins, keywords: ["koin", "order", "beli"] },
  { id: "descriptions", label: "Deskripsi LP", icon: FileText, keywords: ["deskripsi", "landing", "halaman"] },
  { id: "security", label: "Security Log", icon: Shield, keywords: ["security", "keamanan", "log"] },
  { id: "health", label: "System Health", icon: Activity, keywords: ["health", "sistem", "status"] },
  { id: "logs", label: "Live Logs", icon: ScrollText, keywords: ["log", "catatan"] },
  { id: "monitor", label: "Monitor & Poll", icon: Monitor, keywords: ["monitor", "poll", "voting"] },
  { id: "site", label: "Pengaturan", icon: Settings, keywords: ["setting", "pengaturan", "broadcast"] },
  { id: "moderators", label: "Akun Moderator", icon: UsersRound, keywords: ["moderator", "mod", "akun"] },
  { id: "users", label: "Manajemen User", icon: UserCog, keywords: ["user", "pengguna", "ban"] },
  { id: "media", label: "Media Library", icon: Image, keywords: ["media", "gambar", "foto", "upload"] },
  { id: "password-resets", label: "Reset Password", icon: KeyRound, keywords: ["password", "reset", "sandi"] },
  { id: "auth-metrics", label: "Auth Metrics", icon: BarChart3, keywords: ["auth", "metrik", "login"] },
  { id: "traffic", label: "Traffic Monitor", icon: Gauge, keywords: ["traffic", "pengunjung", "visitor"] },
];

interface AdminGlobalSearchProps {
  onNavigate: (sectionId: string) => void;
}

const AdminGlobalSearch = ({ onNavigate }: AdminGlobalSearchProps) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleSelect = (sectionId: string) => {
    onNavigate(sectionId);
    setOpen(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground sm:gap-2 sm:px-3"
        aria-label="Cari menu admin"
      >
        <Search className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        <span className="hidden sm:inline">Cari menu...</span>
        <kbd className="hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline">⌘K</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Cari menu admin..." />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>Tidak ditemukan.</CommandEmpty>
          <CommandGroup heading="Menu Admin">
            {sections.map((s) => {
              const Icon = s.icon;
              return (
                <CommandItem
                  key={s.id}
                  value={`${s.label} ${s.keywords.join(" ")}`}
                  onSelect={() => handleSelect(s.id)}
                  className="gap-3"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{s.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
};

export default AdminGlobalSearch;
