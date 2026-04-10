import { useState, useEffect } from "react";
import { Shield, Coins, Menu, User, Home, Calendar, Film, Settings, Crown, Info, MessageCircle, Download, LogIn } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.png";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getInstallPrompt, clearInstallPrompt, onInstallPromptChange, type BeforeInstallPromptEvent } from "@/lib/installPrompt";

interface SharedNavbarProps {
  showCoinBadge?: boolean;
}

const SharedNavbar = ({ showCoinBadge = true }: SharedNavbarProps) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [coinUser, setCoinUser] = useState<any>(null);
  const [coinBalance, setCoinBalance] = useState(0);
  const [coinUsername, setCoinUsername] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(getInstallPrompt());
  const [isStandalone, setIsStandalone] = useState(false);
  const [loginPopup, setLoginPopup] = useState(false);

  useEffect(() => {
    setIsStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true
    );

    const unsub = onInstallPromptChange((p) => {
      setInstallPrompt(p);
      if (!p) setIsStandalone(true);
    });

    // Delay auth check — use cached session to avoid extra DB hit
    const timer = setTimeout(async () => {
      try {
        const { data: { session } } = await Promise.race([
          supabase.auth.getSession(),
          new Promise<{ data: { session: null } }>((r) => setTimeout(() => r({ data: { session: null } }), 5000)),
        ]);
        if (session?.user) {
          setCoinUser(session.user);
          const [balRes, profileRes] = await Promise.allSettled([
            supabase.from("coin_balances").select("balance").eq("user_id", session.user.id).maybeSingle(),
            supabase.from("profiles").select("username").eq("id", session.user.id).maybeSingle(),
          ]);
          setCoinBalance(balRes.status === "fulfilled" ? (balRes.value.data?.balance || 0) : 0);
          setCoinUsername(profileRes.status === "fulfilled" ? (profileRes.value.data?.username || "") : "");
        }
      } catch {}
    }, 500);

    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);

  const handleInstallClick = async () => {
    const prompt = installPrompt || getInstallPrompt();
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setIsStandalone(true);
      clearInstallPrompt();
      setInstallPrompt(null);
    } else {
      window.location.href = "/install";
    }
  };

  const handleCoinClick = () => {
    if (coinUser) {
      window.location.href = "/coins";
    } else {
      setLoginPopup(true);
    }
  };

  const menuItems = [
    { icon: <Home className="h-5 w-5 text-primary" />, label: "Beranda", description: "Halaman utama", href: "/" },
    { icon: <Calendar className="h-5 w-5 text-primary" />, label: "Jadwal Show", description: "Lihat jadwal & countdown", href: "/schedule" },
    { icon: <Crown className="h-5 w-5 text-yellow-500" />, label: "Membership", description: "Paket langganan eksklusif", href: "/membership" },
    { icon: <Coins className="h-5 w-5 text-[hsl(var(--warning))]" />, label: "Coin Shop", description: "Beli koin untuk akses show", href: coinUser ? "/coins" : undefined, onClick: coinUser ? undefined : () => setLoginPopup(true) },
    { icon: <Film className="h-5 w-5 text-accent" />, label: "Replay Show", description: "Tonton ulang show yang sudah berlalu", href: "/replay" },
    { icon: <Info className="h-5 w-5 text-primary" />, label: "Tentang", description: "Info lengkap platform", href: "/about" },
    { icon: <MessageCircle className="h-5 w-5 text-primary" />, label: "FAQ", description: "Pertanyaan yang sering diajukan", href: "/faq" },
    ...(coinUser ? [{ icon: <User className="h-5 w-5 text-primary" />, label: "Profil Saya", description: "Token, koin & pengaturan", href: "/profile" }] : []),
  ];

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-[hsl(var(--neon-cyan)/0.15)] bg-background/85 backdrop-blur-xl shadow-[0_2px_20px_hsl(var(--neon-cyan)/0.05)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-full border border-border/60 overflow-hidden shadow-sm">
              <img src={logo} alt="RealTime48" className="h-full w-full object-cover" />
            </div>
            <span className="text-sm font-black font-heading tracking-tight">Real<span className="neon-text">Time48</span></span>
          </a>
          <div className="flex items-center gap-2">
            

            {showCoinBadge && coinUser && (
              <a href="/profile" className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5 hover:bg-[hsl(var(--warning))]/20 transition">
                <Coins className="h-4 w-4 text-[hsl(var(--warning))]" />
                <span className="text-sm font-bold text-[hsl(var(--warning))]">{coinBalance}</span>
              </a>
            )}
            {showCoinBadge && !coinUser && (
              <button
                onClick={handleCoinClick}
                className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--warning))]/10 px-3 py-1.5 text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))]/20 transition"
              >
                <Coins className="h-4 w-4" />
                <span className="text-xs font-semibold">Beli Koin</span>
              </button>
            )}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <button className="rounded-lg border border-[hsl(var(--neon-cyan)/0.2)] bg-secondary p-2 text-secondary-foreground transition hover:bg-[hsl(var(--neon-cyan)/0.1)] hover:border-[hsl(var(--neon-cyan)/0.4)] hover:shadow-[0_0_12px_hsl(var(--neon-cyan)/0.15)] active:scale-[0.95]">
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 border-[hsl(var(--neon-cyan)/0.15)] bg-card/95 backdrop-blur-xl p-0 flex flex-col">
                <SheetHeader className="px-6 pt-6 pb-2">
                  <SheetTitle className="flex items-center gap-2 text-foreground">
                    <img src={logo} alt="RealTime48" className="h-6 w-6 rounded-full object-cover" />
                     <span className="font-display tracking-tight">RealTime48</span>
                  </SheetTitle>
                </SheetHeader>

                <ScrollArea className="flex-1 px-6 pb-6">
                  {coinUser ? (
                    <div className="mt-2 rounded-xl border border-border bg-background p-4">
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
                    <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                          <LogIn className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">Belum Login</p>
                          <p className="text-xs text-muted-foreground">Login untuk akses semua fitur</p>
                        </div>
                      </div>
                      <a href="/auth" className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition active:scale-[0.98]">
                        <LogIn className="h-4 w-4" /> Login / Daftar
                      </a>
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    {menuItems.map((item, i) => {
                      const content = (
                        <>
                          <div className="mt-0.5 shrink-0">{item.icon}</div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{item.label}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                          </div>
                        </>
                      );
                      const cls = "flex w-full items-start gap-3 rounded-xl border border-border bg-background p-4 text-left transition-all duration-300 hover:border-[hsl(var(--neon-cyan)/0.3)] hover:bg-[hsl(var(--neon-cyan)/0.05)] hover:shadow-[0_0_12px_hsl(var(--neon-cyan)/0.08)]";

                      if (item.onClick) {
                        return (
                          <button key={i} onClick={() => { setSheetOpen(false); item.onClick!(); }} className={cls}>
                            {content}
                          </button>
                        );
                      }
                      return (
                        <a key={i} href={item.href} className={cls}>
                          {content}
                        </a>
                      );
                    })}

                  </div>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>

      {/* Login Required Popup */}
      <Dialog open={loginPopup} onOpenChange={setLoginPopup}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5 text-primary" />
              Login Diperlukan
            </DialogTitle>
            <DialogDescription>
              Kamu perlu login atau daftar terlebih dahulu untuk mengakses fitur ini.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <a
              href="/auth"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]"
            >
              <LogIn className="h-4 w-4" /> Login / Daftar
            </a>
            <button
              onClick={() => setLoginPopup(false)}
              className="flex w-full items-center justify-center rounded-xl bg-secondary px-4 py-3 text-sm font-medium text-secondary-foreground transition hover:bg-secondary/80"
            >
              Nanti
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SharedNavbar;
