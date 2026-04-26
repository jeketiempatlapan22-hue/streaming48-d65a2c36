import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, Trash2, Image as ImageIcon } from "lucide-react";
import MediaPickerDialog from "./MediaPickerDialog";

const HERO_VIDEO_BUCKET = "hero-videos";
const HERO_VIDEO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const HERO_VIDEO_ALLOWED = ["video/mp4", "video/webm", "video/quicktime"];

const settingsKeys = [
  { key: "site_title", label: "Judul Website", placeholder: "RealTime48 Streaming", type: "input" as const },
  { key: "whatsapp_number", label: "Nomor WhatsApp Admin", placeholder: "6281234567890", type: "input" as const, hint: "Contoh: 6281234567890 (tanpa +)" },
  { key: "whatsapp_admin_numbers", label: "Nomor WhatsApp Bot (Whitelist)", placeholder: "6281234567890,6289876543210", type: "input" as const, hint: "Nomor yang boleh kirim command ke bot WhatsApp, pisahkan dengan koma" },
  { key: "whatsapp_channel", label: "Link Saluran WhatsApp", placeholder: "https://whatsapp.com/channel/...", type: "input" as const, hint: "Link saluran WhatsApp untuk live alternatif (ditampilkan di halaman Live jika diaktifkan)" },
  { key: "purchase_message", label: "Pesan untuk halaman tanpa token", placeholder: "Untuk pembelian token streaming...", type: "textarea" as const },
  { key: "subscription_info", label: "Informasi Langganan", placeholder: "Paket langganan kami meliputi...", type: "textarea" as const },
  { key: "announcement_text", label: "Teks Pengumuman", placeholder: "Pengumuman penting...", type: "textarea" as const },
  
];

const SiteSettingsManager = () => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const saveValueImmediate = async (key: string, value: string) => {
    const { error } = await supabase
      .from("site_settings")
      .upsert({ key, value }, { onConflict: "key" });
    if (error) throw error;
  };

  const extractStoragePath = (publicUrl: string): string | null => {
    // .../storage/v1/object/public/hero-videos/<path>
    const marker = `/storage/v1/object/public/${HERO_VIDEO_BUCKET}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(publicUrl.slice(idx + marker.length));
  };

  const handleVideoUpload = async (file: File) => {
    if (!HERO_VIDEO_ALLOWED.includes(file.type)) {
      toast({
        title: "Format tidak didukung",
        description: "Gunakan MP4, WebM, atau MOV.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > HERO_VIDEO_MAX_BYTES) {
      toast({
        title: "Ukuran terlalu besar",
        description: `Maksimal 10 MB. File Anda ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
        variant: "destructive",
      });
      return;
    }

    setUploadingVideo(true);
    setUploadProgress(10);
    try {
      // Hapus video lama jika berasal dari bucket ini agar tidak menumpuk storage
      const previous = values.hero_video_url || "";
      const previousPath = previous ? extractStoragePath(previous) : null;

      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const path = `hero/${Date.now()}.${ext}`;

      setUploadProgress(30);
      const { error: upErr } = await supabase.storage
        .from(HERO_VIDEO_BUCKET)
        .upload(path, file, {
          cacheControl: "31536000",
          contentType: file.type,
          upsert: false,
        });
      if (upErr) throw upErr;

      setUploadProgress(70);
      const { data: pub } = supabase.storage.from(HERO_VIDEO_BUCKET).getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      await saveValueImmediate("hero_video_url", publicUrl);
      setValues((p) => ({ ...p, hero_video_url: publicUrl }));

      // Best-effort cleanup file lama
      if (previousPath) {
        supabase.storage.from(HERO_VIDEO_BUCKET).remove([previousPath]).catch(() => {});
      }

      setUploadProgress(100);
      toast({ title: "🎬 Video berhasil diupload", description: "URL otomatis tersimpan." });
    } catch (e: any) {
      toast({
        title: "Upload gagal",
        description: e?.message || "Coba lagi atau gunakan URL eksternal.",
        variant: "destructive",
      });
    } finally {
      setUploadingVideo(false);
      setTimeout(() => setUploadProgress(0), 800);
      if (videoFileInputRef.current) videoFileInputRef.current.value = "";
    }
  };

  const handleRemoveUploadedVideo = async () => {
    const current = values.hero_video_url || "";
    const path = extractStoragePath(current);
    try {
      if (path) {
        await supabase.storage.from(HERO_VIDEO_BUCKET).remove([path]);
      }
      await saveValueImmediate("hero_video_url", "");
      setValues((p) => ({ ...p, hero_video_url: "" }));
      toast({ title: "Video dihapus" });
    } catch (e: any) {
      toast({ title: "Gagal menghapus", description: e?.message, variant: "destructive" });
    }
  };

  useEffect(() => {
    const fetchSettings = async () => {
      const { data } = await supabase.from("site_settings").select("*");
      if (data) {
        const v: Record<string, string> = {};
        data.forEach((s: any) => { v[s.key] = s.value; });
        setValues(v);
      }
    };
    fetchSettings();
  }, []);

  const saveSetting = async (key: string) => {
    setSaving(key);
    await supabase.from("site_settings").upsert(
      { key, value: values[key] || "" },
      { onConflict: "key" }
    );
    setSaving(null);
    toast({ title: "Pengaturan disimpan" });
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6">
      <h3 className="text-sm font-semibold text-foreground">🌐 Pengaturan Website</h3>
      {settingsKeys.map((s) => (
        <div key={s.key}>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">{s.label}</label>
          <div className={s.type === "textarea" ? "flex flex-col gap-2" : "flex gap-2"}>
            {s.type === "textarea" ? (
              <Textarea
                value={values[s.key] || ""}
                onChange={(e) => setValues((p) => ({ ...p, [s.key]: e.target.value }))}
                className="bg-background" rows={3} placeholder={s.placeholder}
              />
            ) : (
              <Input
                value={values[s.key] || ""}
                onChange={(e) => setValues((p) => ({ ...p, [s.key]: e.target.value }))}
                className="bg-background" placeholder={s.placeholder}
              />
            )}
            <Button size="sm" className={s.type === "textarea" ? "self-end" : ""} onClick={() => saveSetting(s.key)} disabled={saving === s.key}>
              Simpan
            </Button>
          </div>
          {s.hint && <p className="mt-1 text-[10px] text-muted-foreground">{s.hint}</p>}
        </div>
      ))}

      {/* Dynamic QRIS Toggle */}
      <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
        <label className="mb-2 block text-sm font-bold text-foreground">💳 QRIS Dinamis (Pak Kasir)</label>
        <p className="mb-3 text-xs text-muted-foreground">Aktifkan untuk menggunakan QRIS dinamis (setiap transaksi mendapat QR unik). Nonaktifkan untuk QRIS statis (gambar manual).</p>
        <div className="flex gap-2">
          {[{ value: "true", label: "✅ Dinamis" }, { value: "false", label: "📷 Statis" }].map((opt) => (
            <button key={opt.value}
              onClick={async () => {
                setValues((p) => ({ ...p, use_dynamic_qris: opt.value }));
                const { error } = await supabase.from("site_settings").upsert(
                  { key: "use_dynamic_qris", value: opt.value },
                  { onConflict: "key" }
                );
                if (error) {
                  toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
                } else {
                  toast({ title: opt.value === "true" ? "💳 QRIS Dinamis AKTIF" : "📷 QRIS Statis AKTIF" });
                }
              }}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                (values.use_dynamic_qris || "false") === opt.value
                  ? opt.value === "true"
                    ? "bg-primary text-primary-foreground ring-2 ring-primary/50"
                    : "bg-secondary text-secondary-foreground ring-2 ring-secondary/50"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}>{opt.label}</button>
          ))}
        </div>
        {values.use_dynamic_qris === "true" && (
          <p className="mt-2 text-xs text-primary">✓ Setiap transaksi akan mendapat QR unik dari Pak Kasir</p>
        )}
      </div>

      {/* Membership Coin-Only Toggle */}
      <div className="rounded-xl border-2 border-yellow-500/30 bg-yellow-500/5 p-4">
        <label className="mb-2 block text-sm font-bold text-foreground">🪙 Membership Hanya Koin</label>
        <p className="mb-3 text-xs text-muted-foreground">Aktifkan agar membership hanya bisa dibeli dengan koin. Nonaktifkan agar QRIS juga bisa digunakan.</p>
        <div className="flex gap-2">
          {[{ value: "true", label: "🪙 Koin Saja" }, { value: "false", label: "💳 Koin + QRIS" }].map((opt) => (
            <button key={opt.value}
              onClick={async () => {
                setValues((p) => ({ ...p, membership_coin_only: opt.value }));
                const { error } = await supabase.from("site_settings").upsert(
                  { key: "membership_coin_only", value: opt.value },
                  { onConflict: "key" }
                );
                if (error) {
                  toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
                } else {
                  toast({ title: opt.value === "true" ? "🪙 Membership hanya bisa dibeli dengan Koin" : "💳 Membership bisa dibeli dengan Koin + QRIS" });
                }
              }}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                (values.membership_coin_only || "true") === opt.value
                  ? opt.value === "true"
                    ? "bg-yellow-500 text-background ring-2 ring-yellow-500/50"
                    : "bg-primary text-primary-foreground ring-2 ring-primary/50"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}>{opt.label}</button>
          ))}
        </div>
      </div>

      {/* Membership Token Toggle */}
      <div className="rounded-xl border-2 border-yellow-500/30 bg-yellow-500/5 p-4">
        <label className="mb-2 block text-sm font-bold text-foreground">🎫 Token Membership Otomatis</label>
        <p className="mb-3 text-xs text-muted-foreground">Aktifkan agar pembelian membership otomatis menghasilkan token dengan durasi yang ditentukan per-show.</p>
        <div className="flex gap-2">
          {[{ value: "true", label: "✅ Aktif" }, { value: "false", label: "❌ Nonaktif" }].map((opt) => (
            <button key={opt.value}
              onClick={async () => {
                setValues((p) => ({ ...p, membership_token_enabled: opt.value }));
                const { error } = await supabase.from("site_settings").upsert(
                  { key: "membership_token_enabled", value: opt.value },
                  { onConflict: "key" }
                );
                if (error) {
                  toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
                } else {
                  toast({ title: opt.value === "true" ? "🎫 Token membership AKTIF" : "🎫 Token membership NONAKTIF" });
                }
              }}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                (values.membership_token_enabled || "true") === opt.value
                  ? opt.value === "true"
                    ? "bg-yellow-500 text-background ring-2 ring-yellow-500/50"
                    : "bg-secondary text-secondary-foreground ring-2 ring-secondary/50"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}>{opt.label}</button>
          ))}
        </div>
        {values.membership_token_enabled !== "false" && (
          <p className="mt-2 text-xs text-yellow-600">✓ Pembelian membership akan otomatis mendapat token (durasi diatur per-show)</p>
        )}
      </div>

      {/* Maintenance Mode Toggle */}
      <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-4">
        <label className="mb-2 block text-sm font-bold text-foreground">🔧 Maintenance Mode</label>
        <p className="mb-3 text-xs text-muted-foreground">Aktifkan untuk menutup akses website sementara. Admin tetap bisa masuk.</p>
        <div className="flex gap-2 mb-3">
          {[{ value: "true", label: "🔴 Aktif (Tutup)" }, { value: "false", label: "🟢 Nonaktif (Buka)" }].map((opt) => (
            <button key={opt.value}
              onClick={async () => {
                setValues((p) => ({ ...p, maintenance_mode: opt.value }));
                const { error } = await supabase.from("site_settings").upsert(
                  { key: "maintenance_mode", value: opt.value },
                  { onConflict: "key" }
                );
                if (error) {
                  toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
                } else {
                  toast({ title: opt.value === "true" ? "🔧 Maintenance mode AKTIF — website ditutup" : "🟢 Maintenance mode NONAKTIF — website dibuka" });
                }
              }}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                (values.maintenance_mode || "false") === opt.value
                  ? opt.value === "true"
                    ? "bg-destructive text-destructive-foreground ring-2 ring-destructive/50"
                    : "bg-[hsl(var(--success))] text-primary-foreground ring-2 ring-[hsl(var(--success))]/50"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}>{opt.label}</button>
          ))}
        </div>
        {values.maintenance_mode === "true" && (
          <p className="text-xs text-destructive font-semibold">⚠️ Website sedang ditutup untuk semua user. Admin masih bisa akses /adpan</p>
        )}
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Pesan Maintenance (opsional)</label>
          <div className="flex gap-2">
            <Input
              value={values.maintenance_message || ""}
              onChange={(e) => setValues((p) => ({ ...p, maintenance_message: e.target.value }))}
              className="bg-background" placeholder="Website sedang dalam perbaikan..."
            />
            <Button size="sm" onClick={() => saveSetting("maintenance_message")} disabled={saving === "maintenance_message"}>
              Simpan
            </Button>
          </div>
        </div>
      </div>

      {/* WhatsApp Channel Button on Live Page */}
      <div className="rounded-xl border-2 border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 p-4">
        <label className="mb-2 block text-sm font-bold text-foreground">📺 Tombol Saluran WhatsApp di Halaman Live</label>
        <p className="mb-3 text-xs text-muted-foreground">
          Tampilkan tombol "Gabung Saluran WhatsApp" di halaman Live agar penonton bisa menonton live lainnya. Pastikan link saluran sudah diisi di atas.
        </p>
        <div className="flex gap-2">
          {[{ value: "true", label: "✅ Aktif" }, { value: "false", label: "❌ Nonaktif" }].map((opt) => (
            <button key={opt.value}
              onClick={async () => {
                setValues((p) => ({ ...p, whatsapp_channel_enabled: opt.value }));
                const { error } = await supabase.from("site_settings").upsert(
                  { key: "whatsapp_channel_enabled", value: opt.value },
                  { onConflict: "key" }
                );
                if (error) {
                  toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
                } else {
                  toast({ title: opt.value === "true" ? "📺 Tombol Saluran WhatsApp AKTIF" : "📺 Tombol Saluran WhatsApp NONAKTIF" });
                }
              }}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                (values.whatsapp_channel_enabled || "false") === opt.value
                  ? opt.value === "true"
                    ? "bg-[hsl(var(--success))] text-primary-foreground ring-2 ring-[hsl(var(--success))]/50"
                    : "bg-destructive text-destructive-foreground ring-2 ring-destructive/50"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}>{opt.label}</button>
          ))}
        </div>
        {values.whatsapp_channel_enabled === "true" && !values.whatsapp_channel && (
          <p className="mt-2 text-xs text-destructive">⚠️ Link Saluran WhatsApp belum diisi di atas — tombol tidak akan muncul.</p>
        )}
        {values.whatsapp_channel_enabled === "true" && values.whatsapp_channel && (
          <p className="mt-2 text-xs text-[hsl(var(--success))]">✓ Tombol akan muncul di halaman Live</p>
        )}
      </div>

      {/* WhatsApp Fallback Confirmation Toggle */}
      <div className="rounded-xl border-2 border-blue-500/30 bg-blue-500/5 p-4">
        <label className="mb-2 block text-sm font-bold text-foreground">📱 Konfirmasi WA Manual (Fallback Fonnte)</label>
        <p className="mb-3 text-xs text-muted-foreground">
          Aktifkan untuk menampilkan tombol "Kirim Konfirmasi via WA" ke nomor admin setelah pembayaran terkonfirmasi (Pak Kasir). Berguna sebagai cadangan saat Fonnte bermasalah agar admin tetap menerima detail order.
        </p>
        <div className="flex gap-2 mb-3">
          {[{ value: "true", label: "✅ Aktif" }, { value: "false", label: "❌ Nonaktif" }].map((opt) => (
            <button key={opt.value}
              onClick={async () => {
                setValues((p) => ({ ...p, wa_fallback_enabled: opt.value }));
                const { error } = await supabase.from("site_settings").upsert(
                  { key: "wa_fallback_enabled", value: opt.value },
                  { onConflict: "key" }
                );
                if (error) {
                  toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
                } else {
                  toast({ title: opt.value === "true" ? "📱 WA Fallback AKTIF" : "📱 WA Fallback NONAKTIF" });
                }
              }}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                (values.wa_fallback_enabled || "false") === opt.value
                  ? opt.value === "true"
                    ? "bg-blue-500 text-primary-foreground ring-2 ring-blue-500/50"
                    : "bg-destructive text-destructive-foreground ring-2 ring-destructive/50"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}>{opt.label}</button>
          ))}
        </div>
        {values.wa_fallback_enabled === "true" && !values.whatsapp_number && (
          <p className="text-xs text-destructive">⚠️ Nomor WhatsApp Admin belum diisi di atas — tombol tidak akan muncul.</p>
        )}
        {values.wa_fallback_enabled === "true" && values.whatsapp_number && (
          <p className="text-xs text-blue-500">✓ Tombol konfirmasi akan tampil ke nomor: {values.whatsapp_number}</p>
        )}
      </div>

      <div className="rounded-xl border-2 border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 p-4">
        <label className="mb-2 block text-sm font-bold text-foreground">📢 Pengumuman</label>
        <p className="mb-3 text-xs text-muted-foreground">Aktifkan untuk menampilkan banner pengumuman di landing page</p>
        <div className="flex gap-2">
          {[{ value: "true", label: "✅ Aktif" }, { value: "false", label: "❌ Nonaktif" }].map((opt) => (
            <button key={opt.value}
              onClick={async () => {
                setValues((p) => ({ ...p, announcement_enabled: opt.value }));
                const { error } = await supabase.from("site_settings").upsert(
                  { key: "announcement_enabled", value: opt.value },
                  { onConflict: "key" }
                );
                if (error) {
                  toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
                } else {
                  toast({ title: opt.value === "true" ? "Pengumuman diaktifkan" : "Pengumuman dinonaktifkan" });
                }
              }}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                (values.announcement_enabled || "false") === opt.value
                  ? opt.value === "true"
                    ? "bg-[hsl(var(--success))] text-primary-foreground ring-2 ring-[hsl(var(--success))]/50"
                    : "bg-destructive text-destructive-foreground ring-2 ring-destructive/50"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}>{opt.label}</button>
          ))}
        </div>
        {values.announcement_enabled === "true" && (
          <p className="mt-2 text-xs text-[hsl(var(--success))]">✓ Pengumuman sedang ditampilkan di landing page</p>
        )}
      </div>

      {/* Hero Video Background */}
      <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
        <div>
          <label className="mb-1 block text-sm font-bold text-foreground">🎬 Video Background Hero</label>
          <p className="text-xs text-muted-foreground">
            Tempelkan link video — mendukung <strong>.mp4 / .webm</strong> langsung, juga <strong>HLS (.m3u8)</strong> dan <strong>DASH (.mpd)</strong> untuk adaptive bitrate.
            Disarankan pakai HLS dari CDN (Cloudflare Stream / Bunny / Mux) agar lancar di bandwidth rendah tanpa buffering.
            Video otomatis muted, loop, mulai dari kualitas ringan, dan berhenti saat tidak terlihat.
          </p>
        </div>
        {/* Upload langsung — otomatis jadi URL publik */}
        <div className="rounded-lg border border-dashed border-primary/40 bg-background/50 p-3 space-y-2">
          <label className="block text-xs font-semibold text-foreground">📤 Upload Video (otomatis jadi URL)</label>
          <p className="text-[11px] text-muted-foreground">
            MP4 / WebM / MOV, maksimal <strong>10 MB</strong>. Setelah upload, URL terisi otomatis dan video lama (jika ada) akan dihapus.
          </p>
          <input
            ref={videoFileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleVideoUpload(f);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              type="button"
              onClick={() => videoFileInputRef.current?.click()}
              disabled={uploadingVideo}
            >
              {uploadingVideo ? (
                <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Mengupload {uploadProgress}%</>
              ) : (
                <><Upload className="mr-1 h-4 w-4" /> Pilih File Video</>
              )}
            </Button>
            {values.hero_video_url && extractStoragePath(values.hero_video_url) && (
              <Button
                size="sm"
                variant="destructive"
                type="button"
                onClick={handleRemoveUploadedVideo}
                disabled={uploadingVideo}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Hapus Video
              </Button>
            )}
          </div>
          {uploadingVideo && (
            <div className="h-1 w-full overflow-hidden rounded bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">URL Video (.mp4 / .webm / .m3u8 / .mpd)</label>
          <div className="flex gap-2">
            <Input
              value={values.hero_video_url || ""}
              onChange={(e) => setValues((p) => ({ ...p, hero_video_url: e.target.value }))}
              className="bg-background"
              placeholder="https://cdn.example.com/hero.m3u8 — atau upload di atas"
            />
            <Button size="sm" onClick={() => saveSetting("hero_video_url")} disabled={saving === "hero_video_url"}>
              Simpan
            </Button>
          </div>
          {values.hero_video_url && (
            <p className="mt-1 truncate text-[10px] text-muted-foreground">
              {extractStoragePath(values.hero_video_url)
                ? "📦 Tersimpan di Lovable Cloud Storage"
                : "🌐 URL eksternal"}
            </p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">URL Poster (opsional, gambar fallback saat video belum dimuat)</label>
          <div className="flex gap-2">
            <Input
              value={values.hero_video_poster || ""}
              onChange={(e) => setValues((p) => ({ ...p, hero_video_poster: e.target.value }))}
              className="bg-background"
              placeholder="https://cdn.example.com/hero-poster.jpg"
            />
            <Button size="sm" onClick={() => saveSetting("hero_video_poster")} disabled={saving === "hero_video_poster"}>
              Simpan
            </Button>
          </div>
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium text-muted-foreground">Status</label>
          <div className="flex gap-2">
            {[{ value: "true", label: "✅ Aktif" }, { value: "false", label: "❌ Nonaktif" }].map((opt) => (
              <button key={opt.value}
                onClick={async () => {
                  setValues((p) => ({ ...p, hero_video_enabled: opt.value }));
                  const { error } = await supabase.from("site_settings").upsert(
                    { key: "hero_video_enabled", value: opt.value },
                    { onConflict: "key" }
                  );
                  if (error) {
                    toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
                  } else {
                    toast({ title: opt.value === "true" ? "Video background diaktifkan" : "Video background dinonaktifkan" });
                  }
                }}
                className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-all ${
                  (values.hero_video_enabled || "false") === opt.value
                    ? opt.value === "true"
                      ? "bg-[hsl(var(--success))] text-primary-foreground ring-2 ring-[hsl(var(--success))]/50"
                      : "bg-destructive text-destructive-foreground ring-2 ring-destructive/50"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}>{opt.label}</button>
            ))}
          </div>
          {values.hero_video_enabled === "true" && !values.hero_video_url && (
            <p className="mt-2 text-xs text-destructive">⚠️ Aktif tetapi URL video kosong — video tidak akan tampil.</p>
          )}
          {values.hero_video_enabled === "true" && values.hero_video_url && (
            <p className="mt-2 text-xs text-[hsl(var(--success))]">✓ Video background tampil di hero landing page</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SiteSettingsManager;
