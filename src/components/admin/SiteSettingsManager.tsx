import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const settingsKeys = [
  { key: "site_title", label: "Judul Website", placeholder: "RealTime48 Streaming", type: "input" as const },
  { key: "whatsapp_number", label: "Nomor WhatsApp Admin", placeholder: "6281234567890", type: "input" as const, hint: "Contoh: 6281234567890 (tanpa +)" },
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

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Aktifkan Pengumuman</label>
        <div className="flex gap-2">
          {[{ value: "true", label: "✅ Aktif" }, { value: "false", label: "❌ Nonaktif" }].map((opt) => (
            <button key={opt.value}
              onClick={() => {
                setValues((p) => ({ ...p, announcement_enabled: opt.value }));
                supabase.from("site_settings").upsert({ key: "announcement_enabled", value: opt.value }, { onConflict: "key" });
                toast({ title: "Pengaturan disimpan" });
              }}
              className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${
                (values.announcement_enabled || "false") === opt.value
                  ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}>{opt.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SiteSettingsManager;
