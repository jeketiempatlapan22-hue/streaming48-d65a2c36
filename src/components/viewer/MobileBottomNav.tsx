import { Home, Tv, PlayCircle, Coins, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface MobileBottomNavProps {
  isLive?: boolean;
  loading?: boolean;
  /** Token valid milik user untuk show yang sedang live (jika ada) */
  liveAccessToken?: string | null;
}

/**
 * Skeleton/placeholder version of MobileBottomNav.
 * Memiliki dimensi & struktur identik dengan bar asli sehingga tidak
 * menimbulkan layout shift ketika halaman masih loading.
 */
export const MobileBottomNavSkeleton = () => {
  return (
    <>
      <div className="h-16 md:hidden" aria-hidden="true" />
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border/60 bg-background/95 backdrop-blur-lg shadow-[0_-4px_20px_rgba(0,0,0,0.3)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Memuat navigasi"
        aria-busy="true"
      >
        <ul className="grid grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i}>
              <div className="flex flex-col items-center justify-center gap-1 py-2">
                <Skeleton className="h-5 w-5 rounded-md" />
                <Skeleton className="h-2 w-8 rounded-sm" />
              </div>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
};

const items = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  { href: "/live", label: "Live", icon: Tv, match: (p: string) => p.startsWith("/live"), highlight: "live" as const },
  { href: "/replay", label: "Replay", icon: PlayCircle, match: (p: string) => p.startsWith("/replay") },
  { href: "/coins", label: "Koin", icon: Coins, match: (p: string) => p.startsWith("/coins") },
  { href: "/profile", label: "Profil", icon: User, match: (p: string) => p.startsWith("/profile") },
];

const MobileBottomNav = ({ isLive = false, loading = false, liveAccessToken = null }: MobileBottomNavProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  if (loading) return <MobileBottomNavSkeleton />;

  const handleLiveClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (!isLive) {
      toast.info("Belum ada show yang sedang live", {
        description: "Cek jadwal show terbaru di halaman utama.",
      });
      navigate("/");
      return;
    }
    if (!liveAccessToken) {
      toast.error("Akses ditolak", {
        description: "Kamu belum membeli show yang sedang live. Silakan beli terlebih dahulu.",
      });
      navigate("/");
      return;
    }
    navigate(`/live?t=${encodeURIComponent(liveAccessToken)}`);
  };

  return (
    <>
      {/* Spacer so content does not hide behind the bar */}
      <div className="h-16 md:hidden" aria-hidden="true" />
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border/60 bg-background/95 backdrop-blur-lg shadow-[0_-4px_20px_rgba(0,0,0,0.3)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Navigasi utama"
      >
        <ul className="grid grid-cols-5">
          {items.map((item) => {
            const active = item.match(path);
            const Icon = item.icon;
            const isLiveItem = item.highlight === "live";
            const showLiveDot = isLiveItem && isLive;
            const hasLiveAccess = isLiveItem && isLive && !!liveAccessToken;
            return (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={isLiveItem ? handleLiveClick : undefined}
                  className={`relative flex flex-col items-center justify-center gap-0.5 py-2 transition-all active:scale-95 ${
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-current={active ? "page" : undefined}
                  aria-label={
                    isLiveItem
                      ? isLive
                        ? hasLiveAccess
                          ? "Tonton live sekarang"
                          : "Live sedang berlangsung — beli akses dulu"
                        : "Live (tidak ada show aktif)"
                      : item.label
                  }
                >
                  {active && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
                  )}
                  <div className="relative">
                    <Icon
                      className={`h-5 w-5 transition-transform ${active ? "scale-110" : ""}`}
                      strokeWidth={active ? 2.5 : 2}
                    />
                    {showLiveDot && (
                      <span className="absolute -top-1 -right-1 flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] leading-none ${active ? "font-bold" : "font-medium"}`}>
                    {item.label}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
};

export default MobileBottomNav;
