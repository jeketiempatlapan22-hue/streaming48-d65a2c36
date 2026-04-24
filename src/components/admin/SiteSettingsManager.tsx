import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, Send, Terminal } from "lucide-react";

const settingsKeys = [
  { key: "site_title", label: "Judul Website", placeholder: "RealTime48 Streaming", type: "input" as const },
  { key: "whatsapp_number", label: "Nomor WhatsApp Admin", placeholder: "6281234567890", type: "input" as const, hint: "Contoh: 6281234567890 (tanpa +)" },
  { key: "whatsapp_admin_numbers", label: "Nomor WhatsApp Bot (Whitelist)", placeholder: "6281234567890,6289876543210", type: "input" as const, hint: "Nomor yang boleh kirim command ke bot WhatsApp, pisahkan dengan koma" },
  { key: "whatsapp_channel", label: "Link Saluran WhatsApp", placeholder: "https://whatsapp.com/channel/...", type: "input" as const, hint: "Link saluran WhatsApp untuk live alternatif (ditampilkan di halaman Live jika diaktifkan)" },
  { key: "purchase_message", label: "Pesan untuk halaman tanpa token", placeholder: "Untuk pembelian token streaming...", type: "textarea" as const },
  { key: "subscription_info", label: "Informasi Langganan", placeholder: "Paket langganan kami meliputi...", type: "textarea" as const },
  { key: "announcement_text", label: "Teks Pengumuman", placeholder: "Pengumuman penting...", type: "textarea" as const },
  
];

type WebhookTestResult = {
  ok: boolean;
  status: number;
  durationMs: number;
  message: string;
  bodyPreview?: string;
};

type CommandTestRow = {
  label: string;
  role: "admin" | "owner" | "reseller";
  phone: string;
  command: string;
  status: "idle" | "running" | "ok" | "error" | "skipped";
  durationMs?: number;
  reply?: string;
  reason?: string;
  errorMessage?: string;
};

type ResellerLite = { id: string; name: string; phone: string; wa_command_prefix: string };

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTwimlMessage(xml: string): string | null {
  const m = xml.match(/<Message[^>]*>([\s\S]*?)<\/Message>/i);
  return m ? decodeXml(m[1].trim()) : null;
}

const SiteSettingsManager = () => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookResult, setWebhookResult] = useState<WebhookTestResult | null>(null);
  const { toast } = useToast();

  const runWebhookTest = async () => {
    setTestingWebhook(true);
    setWebhookResult(null);
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
      (projectId ? `https://${projectId}.supabase.co` : "");
    const url = `${supabaseUrl}/functions/v1/twilio-webhook`;

    const form = new URLSearchParams({
      From: "whatsapp:+6281234567890",
      Body: "MENU",
      MessageSid: `TEST${Date.now()}`,
    }).toString();

    const start = performance.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      const text = await res.text();
      const duration = Math.round(performance.now() - start);
      const ok = res.status === 200;
      setWebhookResult({
        ok,
        status: res.status,
        durationMs: duration,
        message: ok
          ? `Server menerima request dan mengembalikan 200 dalam ${(duration / 1000).toFixed(2)} detik.`
          : `Server mengembalikan status ${res.status} dalam ${(duration / 1000).toFixed(2)} detik.`,
        bodyPreview: text.slice(0, 240),
      });
      toast({
        title: ok ? "✅ Webhook OK" : "⚠️ Webhook gagal",
        description: ok
          ? `200 OK dalam ${duration} ms`
          : `HTTP ${res.status} dalam ${duration} ms`,
        variant: ok ? "default" : "destructive",
      });
    } catch (e) {
      const duration = Math.round(performance.now() - start);
      const message = e instanceof Error ? e.message : "Network error";
      setWebhookResult({
        ok: false,
        status: 0,
        durationMs: duration,
        message: `Tidak bisa menghubungi endpoint (${message}).`,
      });
      toast({
        title: "❌ Tidak bisa menghubungi webhook",
        description: message,
        variant: "destructive",
      });
    } finally {
      setTestingWebhook(false);
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

      {/* Test Webhook Twilio */}
      <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <label className="block text-sm font-bold text-foreground">🤖 Test Webhook Twilio</label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Kirim request uji ke endpoint <code className="rounded bg-background px-1 py-0.5">twilio-webhook</code> dan periksa apakah server menerima serta mengembalikan 200 OK dalam hitungan detik.
            </p>
          </div>
          <Button
            size="sm"
            onClick={runWebhookTest}
            disabled={testingWebhook}
            className="shrink-0 gap-1"
          >
            {testingWebhook ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Menguji...
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                Test Webhook
              </>
            )}
          </Button>
        </div>
        {webhookResult && (
          <div
            className={`mt-2 flex items-start gap-2 rounded-lg border p-3 text-xs ${
              webhookResult.ok
                ? "border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/10 text-foreground"
                : "border-destructive/40 bg-destructive/10 text-foreground"
            }`}
          >
            {webhookResult.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-semibold">
                {webhookResult.ok ? "✅ Webhook diterima" : "❌ Webhook gagal"}
                {" — "}
                <span className="font-mono">
                  HTTP {webhookResult.status || "n/a"} · {(webhookResult.durationMs / 1000).toFixed(2)}s
                </span>
              </div>
              <p className="text-muted-foreground">{webhookResult.message}</p>
              {webhookResult.bodyPreview && (
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[10px] text-muted-foreground">
                  {webhookResult.bodyPreview}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

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
