import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();

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
    </div>
  );
};

export default SiteSettingsManager;
