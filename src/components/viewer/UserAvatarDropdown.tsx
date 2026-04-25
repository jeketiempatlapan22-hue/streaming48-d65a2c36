import { useState, useEffect, useRef, useCallback } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { User, Coins, LogOut, ShoppingBag, Tv, LogIn, Settings, Camera, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompressor";
import { toast } from "sonner";

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
  const [displayUsername, setDisplayUsername] = useState<string | null>(username || null);
  const [editOpen, setEditOpen] = useState(false);
  const [editUsername, setEditUsername] = useState(username || "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync when parent prop changes
  useEffect(() => {
    if (username) setDisplayUsername(username);
  }, [username]);

  const fetchProfile = useCallback(async () => {
    if (!isLoggedIn) {
      setAvatarUrl(null);
      setDisplayUsername(null);
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("avatar_url, username")
      .eq("id", user.id)
      .maybeSingle();
    setAvatarUrl(data?.avatar_url ?? null);
    if (data?.username) {
      setDisplayUsername(data.username);
      setEditUsername(data.username);
    }
  }, [isLoggedIn]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  // Listen for profile-updated events from anywhere in the app
  useEffect(() => {
    const onUpdated = () => { fetchProfile(); };
    window.addEventListener("profile:updated", onUpdated);
    return () => window.removeEventListener("profile:updated", onUpdated);
  }, [fetchProfile]);

  useEffect(() => {
    if (editOpen) {
      setEditUsername(displayUsername || username || "");
      setPreviewUrl(null);
      setPendingFile(null);
      fetchProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen]);

  const handleLogout = async () => {
    try { await supabase.auth.signOut(); } catch {}
    window.location.href = "/";
  };

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("File harus berupa gambar");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Ukuran maksimal 8 MB");
      return;
    }
    setPendingFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const broadcastProfileUpdated = () => {
    try { window.dispatchEvent(new CustomEvent("profile:updated")); } catch {}
  };

  const handleRemoveAvatar = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Tidak ada sesi pengguna"); return; }
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: null })
        .eq("id", user.id);
      if (error) throw error;
      setAvatarUrl(null);
      setPreviewUrl(null);
      setPendingFile(null);
      broadcastProfileUpdated();
      toast.success("Foto profil dihapus");
    } catch (err: any) {
      toast.error(err.message || "Gagal menghapus foto");
      // Resync from DB to be safe
      await fetchProfile();
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    let uploadFailed = false;
    let uploadAttempted = false;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Sesi tidak ditemukan"); return; }

      const updates: { avatar_url?: string | null; username?: string } = {};

      // Upload new avatar if any
      if (pendingFile) {
        uploadAttempted = true;
        setUploading(true);
        try {
          const compressed = await compressImage(pendingFile, { maxWidth: 512, maxHeight: 512, quality: 0.85 });
          const ext = (compressed.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
          const path = `${user.id}/avatar-${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("avatars")
            .upload(path, compressed, { upsert: true, cacheControl: "3600", contentType: compressed.type });
          if (upErr) throw upErr;
          const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
          updates.avatar_url = pub.publicUrl;
        } catch (upErr: any) {
          uploadFailed = true;
          toast.error(`Upload foto gagal: ${upErr?.message || "kesalahan jaringan"}`);
        } finally {
          setUploading(false);
        }
      }

      // Username
      const trimmed = editUsername.trim();
      const currentName = displayUsername || username || "";
      if (trimmed.length > 0 && trimmed.length <= 50 && trimmed !== currentName) {
        updates.username = trimmed;
      }

      if (Object.keys(updates).length === 0) {
        if (!uploadFailed) {
          toast.info("Tidak ada perubahan");
          setEditOpen(false);
        }
        // Resync to ensure UI matches DB even if nothing was saved
        await fetchProfile();
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user.id);
      if (error) throw error;

      // Optimistic local update
      if (typeof updates.avatar_url !== "undefined") setAvatarUrl(updates.avatar_url);
      if (updates.username) setDisplayUsername(updates.username);

      // Authoritative resync from DB (handles upload-failed-but-name-saved case)
      await fetchProfile();
      broadcastProfileUpdated();

      if (uploadFailed) {
        toast.warning("Username tersimpan, tapi foto gagal diunggah");
        // Keep dialog open so user can retry the photo upload
        setPendingFile(null);
        setPreviewUrl(null);
      } else {
        toast.success("Profil diperbarui");
        setEditOpen(false);
      }
    } catch (err: any) {
      toast.error(err.message || "Gagal menyimpan profil");
      // Resync from DB so the UI never shows stale optimistic data
      await fetchProfile();
    } finally {
      setUploading(false);
      setSaving(false);
    }
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

  const displayPreview = previewUrl || avatarUrl;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="relative flex h-9 w-9 items-center justify-center rounded-full overflow-hidden border-2 border-primary/40 bg-gradient-to-br from-primary/30 to-accent/30 text-foreground transition hover:border-primary hover:shadow-[0_0_12px_hsl(var(--primary)/0.5)] active:scale-95"
            aria-label="Menu pengguna"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayUsername || "User"} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs font-bold">{getInitial(displayUsername)}</span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 bg-card border-border">
          <DropdownMenuLabel className="flex items-center gap-2.5 py-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full overflow-hidden border border-primary/30 bg-primary/10 shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayUsername || "User"} className="h-full w-full object-cover" />
              ) : (
                <span className="text-sm font-bold text-primary">{getInitial(displayUsername)}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{displayUsername || "User"}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <Coins className="h-3 w-3 text-[hsl(var(--warning))]" />
                <span className="text-[11px] font-bold text-[hsl(var(--warning))]">{coinBalance} Koin</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setEditOpen(true)} className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4 text-primary" />
            <span>Edit Profil</span>
          </DropdownMenuItem>
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Edit Profil
            </DialogTitle>
            <DialogDescription>
              Perbarui foto avatar dan username Anda.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Avatar */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative group">
                <div className="h-24 w-24 rounded-full overflow-hidden border-2 border-primary/40 bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shadow-[0_0_20px_hsl(var(--primary)/0.25)]">
                  {displayPreview ? (
                    <img src={displayPreview} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-2xl font-bold text-primary">{getInitial(editUsername || username)}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || saving}
                  className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg border-2 border-card hover:bg-primary/90 active:scale-95 transition disabled:opacity-50"
                  aria-label="Ubah foto"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePickFile}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || saving}
                  className="text-xs"
                >
                  <Camera className="h-3.5 w-3.5 mr-1.5" /> Pilih Foto
                </Button>
                {avatarUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRemoveAvatar}
                    disabled={uploading || saving}
                    className="text-xs text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Hapus
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">JPG / PNG, maks. 8 MB</p>
            </div>

            {/* Username */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground">Username</label>
              <Input
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                placeholder="Username Anda"
                maxLength={50}
                className="bg-background"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={saving || uploading}
            >
              Batal
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || uploading}
              className="min-w-[100px]"
            >
              {saving || uploading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Menyimpan</>
              ) : (
                "Simpan"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default UserAvatarDropdown;
