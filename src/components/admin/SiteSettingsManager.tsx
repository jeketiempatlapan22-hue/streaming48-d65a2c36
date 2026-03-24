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
  { key: "whatsapp_channel", label: "Link Saluran WhatsApp", placeholder: "https://whatsapp.com/channel/...", type: "input" as const },
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
