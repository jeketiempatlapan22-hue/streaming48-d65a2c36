import { useState, useEffect } from "react";
import { Shield, Coins, Menu, User, Home, Calendar, Film, Settings, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";

interface SharedNavbarProps {
  showCoinBadge?: boolean;
}

const SharedNavbar = ({ showCoinBadge = true }: SharedNavbarProps) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [coinUser, setCoinUser] = useState<any>(null);
  const [coinBalance, setCoinBalance] = useState(0);
  const [coinUsername, setCoinUsername] = useState("");

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setCoinUser(session.user);
        const [balRes, profileRes] = await Promise.all([
          supabase.from("coin_balances").select("balance").eq("user_id", session.user.id).maybeSingle(),
          supabase.from("profiles").select("username").eq("id", session.user.id).maybeSingle(),
        ]);
        setCoinBalance(balRes.data?.balance || 0);
        setCoinUsername(profileRes.data?.username || "");
      }
    };
    checkAuth();
  }, []);

  const menuItems = [
    { icon: <Home className="h-5 w-5 text-primary" />, label: "Beranda", description: "Halaman utama", href: "/" },
    { icon: <Calendar className="h-5 w-5 text-primary" />, label: "Jadwal Show", description: "Lihat jadwal & countdown", href: "/schedule" },
    { icon: <Coins className="h-5 w-5 text-[hsl(var(--warning))]" />, label: "Coin Shop", description: "Beli koin untuk akses show", href: "/coins" },
    { icon: <Crown className="h-5 w-5 text-yellow-500" />, label: "Membership", description: "Paket langganan eksklusif", href: "/membership" },
    { icon: <Film className="h-5 w-5 text-primary" />, label: "Replay Show", description: "Tonton ulang show lalu", href: "/replay" },
    ...(coinUser ? [{ icon: <User className="h-5 w-5 text-primary" />, label: "Profil Saya", description: "Token, koin & pengaturan", href: "/profile" }] : []),
    { icon: <Settings className="h-5 w-5 text-muted-foreground" />, label: "Admin", description: "Panel admin", href: "/admin" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <a href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shadow-[0_0_8px_hsl(var(--primary)/0.3)]">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-bold">Real<span className="text-primary">Time48</span></span>
        </a>
        <div className="flex items-center gap-2">
          {showCoinBadge && coinUser && (
            <a href="/profile" className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5 hover:bg-[hsl(var(--warning))]/20 transition">
              <Coins className="h-4 w-4 text-[hsl(var(--warning))]" />
              <span className="text-sm font-bold text-[hsl(var(--warning))]">{coinBalance}</span>
            </a>
          )}
          {showCoinBadge && !coinUser && (
            <a href="/coins" className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5 text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))]/20 transition">
              <Coins className="h-4 w-4" />
              <span className="text-xs font-semibold">Beli Koin</span>
            </a>
          )}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button className="rounded-lg bg-secondary p-2 text-secondary-foreground transition hover:bg-secondary/80 active:scale-[0.95]">
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 border-border bg-card">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-foreground">
                  <div className="h-6 w-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                    <Shield className="h-3 w-3 text-primary" />
                  </div>
                  RealTime48
                </SheetTitle>
              </SheetHeader>

              {coinUser ? (
                <div className="mt-4 rounded-xl border border-border bg-background p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{coinUsername || "User"}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Coins className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />
                        <span className="text-xs font-bold text-[hsl(var(--warning))]">{coinBalance} Koin</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <a href="/coins" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-2 text-xs font-semibold text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))]/20 transition">
                      <Coins className="h-3.5 w-3.5" /> Coin Shop
                    </a>
                    <a href="/profile" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20 transition">
                      <User className="h-3.5 w-3.5" /> Profil
                    </a>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-border bg-background p-4">
                  <a href="/auth" className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition">
                    <User className="h-4 w-4" /> Login / Daftar
                  </a>
                </div>
              )}

              <div className="mt-4 space-y-2">
                {menuItems.map((item, i) => (
                  <a key={i} href={item.href}
                    className="flex w-full items-start gap-3 rounded-xl border border-border bg-background p-4 text-left transition hover:border-primary/30 hover:bg-primary/5">
                    <div className="mt-0.5 shrink-0">{item.icon}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{item.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                    </div>
                  </a>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
};

export default SharedNavbar;
