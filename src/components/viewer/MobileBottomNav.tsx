import { Home, Tv, PlayCircle, Coins, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useProfileAvatar } from "@/hooks/useProfileAvatar";

interface MobileBottomNavProps {
  isLive?: boolean;
  loading?: boolean;
  /** Token valid milik user untuk show yang sedang live (jika ada) */
  liveAccessToken?: string | null;
  /** Judul show yang sedang live (untuk toast informatif) */
  activeShowTitle?: string | null;
  /** ID show aktif untuk deep-link ke jadwal */
  activeShowId?: string | null;
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

type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  match: (p: string) => boolean;
  highlight?: "live";
};

const items: NavItem[] = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  { href: "/live", label: "Live", icon: Tv, match: (p: string) => p.startsWith("/live"), highlight: "live" },
  { href: "/replay", label: "Replay", icon: PlayCircle, match: (p: string) => p.startsWith("/replay") },
  { href: "/coins", label: "Koin", icon: Coins, match: (p: string) => p.startsWith("/coins") },
  { href: "/profile", label: "Profil", icon: User, match: (p: string) => p.startsWith("/profile") },
];

const MobileBottomNav = ({
  isLive = false,
  loading = false,
  liveAccessToken = null,
  activeShowTitle = null,
  activeShowId = null,
}: MobileBottomNavProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;
  const { isLoggedIn, avatarUrl, username } = useProfileAvatar();

  if (loading) return <MobileBottomNavSkeleton />;

  const openSchedule = () => {
    // Sertakan ID show pada hash agar SchedulePage bisa scroll/fokus ke kartu terkait
    const target = activeShowId ? `/schedule#show-${activeShowId}` : "/schedule";
    navigate(target);
  };

  const handleLiveClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (!isLive) {
      toast.info("Belum ada show yang sedang live", {
        description: "Cek jadwal show terbaru untuk pertunjukan berikutnya.",
        action: { label: "Lihat Jadwal", onClick: () => navigate("/schedule") },
      });
      return;
    }
    if (!liveAccessToken) {
      const showLabel = activeShowTitle ? `“${activeShowTitle}”` : "show yang sedang live";
      toast.error(`Akses ditolak — ${activeShowTitle || "belum membeli show"}`, {
        description: `Kamu belum membeli akses untuk ${showLabel}. Buka jadwal show untuk membeli tiket.`,
        duration: 8000,
        action: { label: "Buka Jadwal Show", onClick: openSchedule },
      });
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
            const isProfileItem = item.href === "/profile";
            const showLiveDot = isLiveItem && isLive;
            const hasLiveAccess = isLiveItem && isLive && !!liveAccessToken;
            const profileHref = isProfileItem ? (isLoggedIn ? "/profile" : "/auth") : item.href;
            const initial = (username || "U").trim().charAt(0).toUpperCase();
            return (
              <li key={item.href}>
                <a
                  href={isProfileItem ? profileHref : item.href}
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
                      : isProfileItem
                        ? isLoggedIn
                          ? `Profil ${username || "saya"}`
                          : "Login / Daftar"
                        : item.label
                  }
                >
                  {active && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
                  )}
                  <div className="relative">
                    {isProfileItem && isLoggedIn ? (
                      <span
                        className={`flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border bg-gradient-to-br from-primary/30 to-accent/30 transition-all ${
                          active ? "border-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)]" : "border-border"
                        }`}
                      >
                        {avatarUrl ? (
                          <img src={avatarUrl} alt={username || "User"} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[10px] font-bold text-foreground">{initial}</span>
                        )}
                      </span>
                    ) : (
                      <Icon
                        className={`h-5 w-5 transition-transform ${active ? "scale-110" : ""}`}
                        strokeWidth={active ? 2.5 : 2}
                      />
                    )}
                    {showLiveDot && (
                      <span className="absolute -top-1 -right-1 flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] leading-none ${active ? "font-bold" : "font-medium"}`}>
                    {isProfileItem && isLoggedIn ? "Saya" : item.label}
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
