import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompressor";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { broadcastProfileUpdated } from "@/hooks/useProfileAvatar";

interface ProfileAvatarEditorProps {
  /** Username untuk fallback inisial */
  username?: string | null;
  /** Callback opsional setelah perubahan tersimpan */
  onChanged?: () => void;
}

const getInitial = (name?: string | null) => {
  if (!name) return "U";
  return name.trim().charAt(0).toUpperCase();
};

/**
 * Komponen edit avatar yang ditempatkan di halaman Profil.
 * - Pilih foto → kompresi → upload ke storage `avatars`
 * - Hapus foto saat ini
 * - Update kolom `profiles.avatar_url`
 * - Broadcast `profile:updated` agar header / nav tersinkronisasi
 */
const ProfileAvatarEditor = ({ username, onChanged }: ProfileAvatarEditorProps) => {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) setAvatarUrl(data?.avatar_url ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  // Cleanup blob preview
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleUpload = async () => {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Sesi tidak ditemukan"); return; }

      const compressed = await compressImage(pendingFile, { maxWidth: 512, maxHeight: 512, quality: 0.85 });
      const ext = (compressed.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, compressed, { upsert: true, cacheControl: "3600", contentType: compressed.type });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: pub.publicUrl })
        .eq("id", user.id);
      if (dbErr) throw dbErr;

      setAvatarUrl(pub.publicUrl);
      setPendingFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      broadcastProfileUpdated();
      onChanged?.();
      toast.success("Foto profil diperbarui");
    } catch (err: any) {
      toast.error(err?.message || "Gagal mengunggah foto");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Sesi tidak ditemukan"); return; }
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: null })
        .eq("id", user.id);
      if (error) throw error;
      setAvatarUrl(null);
      setPendingFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      broadcastProfileUpdated();
      onChanged?.();
      toast.success("Foto profil dihapus");
    } catch (err: any) {
      toast.error(err?.message || "Gagal menghapus foto");
    } finally {
      setRemoving(false);
    }
  };

  const display = previewUrl || avatarUrl;
  const busy = uploading || removing;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <div className="h-24 w-24 rounded-full overflow-hidden border-2 border-primary/40 bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shadow-[0_0_20px_hsl(var(--primary)/0.25)]">
          {display ? (
            <img src={display} alt="Avatar" className="h-full w-full object-cover" />
          ) : username ? (
            <span className="text-2xl font-bold text-primary">{getInitial(username)}</span>
          ) : (
            <User className="h-10 w-10 text-primary" />
          )}
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg border-2 border-card hover:bg-primary/90 active:scale-95 transition disabled:opacity-50"
          aria-label="Pilih foto avatar"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePick}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        {pendingFile ? (
          <>
            <Button type="button" size="sm" onClick={handleUpload} disabled={busy} className="text-xs gap-1.5">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              {uploading ? "Mengunggah..." : "Unggah Foto"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
                setPendingFile(null);
              }}
              disabled={busy}
              className="text-xs"
            >
              Batal
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="text-xs gap-1.5"
            >
              <Camera className="h-3.5 w-3.5" /> Pilih Foto
            </Button>
            {avatarUrl && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRemove}
                disabled={busy}
                className="text-xs gap-1.5 text-destructive hover:text-destructive"
              >
                {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Hapus
              </Button>
            )}
          </>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">JPG / PNG, maks. 8 MB</p>
    </div>
  );
};

export default ProfileAvatarEditor;
