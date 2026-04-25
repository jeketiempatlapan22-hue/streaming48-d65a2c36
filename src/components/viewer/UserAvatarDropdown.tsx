import { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, Coins, LogOut, ShoppingBag, Tv, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface UserAvatarDropdownProps {
  username?: string | null;
  coinBalance?: number;
  isLoggedIn: boolean;
  onLoginClick?: () => void;
}

const getInitial = (name?: string | null) => {
  if (!name) return "U";
  return name.trim().charAt(0).toUpperCase();
};

const UserAvatarDropdown = ({ username, coinBalance = 0, isLoggedIn, onLoginClick }: UserAvatarDropdownProps) => {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn) { setAvatarUrl(null); return; }
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (mounted && data?.avatar_url) setAvatarUrl(data.avatar_url);
    })();
    return () => { mounted = false; };
  }, [isLoggedIn]);

  const handleLogout = async () => {
    try { await supabase.auth.signOut(); } catch {}
    window.location.href = "/";
  };

  if (!isLoggedIn) {
    return (
      <button
        onClick={onLoginClick}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary transition hover:bg-primary/20 active:scale-95"
        title="Login / Daftar"
        aria-label="Login"
      >
        <LogIn className="h-4 w-4" />
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-full overflow-hidden border-2 border-primary/40 bg-gradient-to-br from-primary/30 to-accent/30 text-foreground transition hover:border-primary hover:shadow-[0_0_12px_hsl(var(--primary)/0.5)] active:scale-95"
          aria-label="Menu pengguna"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={username || "User"} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs font-bold">{getInitial(username)}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-card border-border">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full overflow-hidden border border-primary/30 bg-primary/10 shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt={username || "User"} className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm font-bold text-primary">{getInitial(username)}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{username || "User"}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <Coins className="h-3 w-3 text-[hsl(var(--warning))]" />
              <span className="text-[11px] font-bold text-[hsl(var(--warning))]">{coinBalance} Koin</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/profile" className="cursor-pointer">
            <User className="mr-2 h-4 w-4 text-primary" />
            <span>Profil Saya</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/coins" className="cursor-pointer">
            <ShoppingBag className="mr-2 h-4 w-4 text-[hsl(var(--warning))]" />
            <span>Beli Koin</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/live" className="cursor-pointer">
            <Tv className="mr-2 h-4 w-4 text-accent" />
            <span>Tonton Live</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Logout</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserAvatarDropdown;
