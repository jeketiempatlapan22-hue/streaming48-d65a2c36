import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Copy, Sparkles, Send, RefreshCw, Ticket } from "lucide-react";

const SITE_URL = "realtime48stream.my.id";
const REPLAY_URL = "https://replaytime.lovable.app";

const DURATION_OPTIONS = [
  { key: "1h", label: "1 Jam", ms: 3_600_000, label_h: "1 jam" },
  { key: "1d", label: "1 Hari", ms: 86_400_000, label_h: "1 hari" },
  { key: "3d", label: "3 Hari", ms: 3 * 86_400_000, label_h: "3 hari" },
  { key: "7d", label: "1 Minggu", ms: 7 * 86_400_000, label_h: "7 hari" },
  { key: "30d", label: "1 Bulan", ms: 30 * 86_400_000, label_h: "30 hari" },
  { key: "custom", label: "Custom (hari)", ms: 0, label_h: "" },
] as const;

interface Show {
  id: string;
  title: string;
  is_active: boolean;
  is_subscription: boolean;
  is_replay: boolean;
  is_bundle: boolean;
  access_password: string | null;
  group_link: string | null;
  schedule_date: string | null;
  schedule_time: string | null;
  membership_duration_days: number;
  bundle_duration_days: number;
  bundle_replay_info: string | null;
  bundle_replay_passwords: any;
}

const buildPrefix = (show: Show | null): string => {
  if (!show) return "rt48_";
  if (show.is_bundle) return "BDL-";
  if (show.is_subscription) return "MBR-";
  return "rt48_";
};

const buildMessage = (opts: {
  show: Show | null;
  tokenCode: string;
  durationLabel: string;
  customDescription: string;
}): string => {
  const { show, tokenCode, durationLabel, customDescription } = opts;
  const liveLink = `https://${SITE_URL}/live?t=${tokenCode}`;
  let msg = "";

  if (show?.is_bundle) {
    msg = `━━━━━━━━━━━━━━━━━━\n📦 *Token Bundle Show*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Paket: *${show.title}*\n⏰ Durasi Token: *${durationLabel}*\n`;
    msg += `\n🎫 *Token Akses:* ${tokenCode}\n📺 *Link Nonton:*\n${liveLink}\n`;
    if (show.schedule_date) {
      msg += `📅 *Jadwal:* ${show.schedule_date} ${show.schedule_time || ""}\n`;
    }
    const bundlePasswords = Array.isArray(show.bundle_replay_passwords) ? show.bundle_replay_passwords : [];
    if (bundlePasswords.length > 0) {
      msg += `\n📦 *Sandi Replay Bundle:*\n`;
      for (const entry of bundlePasswords) {
        if (entry?.show_name && entry?.password) {
          msg += `  🎭 ${entry.show_name}: *${entry.password}*\n`;
        }
      }
    }
    if (show.bundle_replay_info) {
      msg += `\n🎬 *Info Replay:*\n🔗 ${show.bundle_replay_info}\n`;
    } else {
      msg += `\n🎬 *Link Replay:*\n🔗 ${REPLAY_URL}\n`;
    }
  } else if (show?.is_subscription) {
    msg = `━━━━━━━━━━━━━━━━━━\n✅ *Token Membership*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${show.title}*\n📦 Tipe: *Membership*\n⏰ Durasi: *${durationLabel}*\n`;
    msg += `\n🎫 *Token Membership:* ${tokenCode}\n📺 *Link Nonton:*\n${liveLink}\n`;
    if (show.group_link) {
      msg += `\n🔗 *Link Grup:*\n${show.group_link}\n`;
    }
    msg += `\n🔄 *Info Replay:*\n🔗 Link: ${REPLAY_URL}\n`;
    if (show.access_password) {
      msg += `🔑 Sandi Replay: ${show.access_password}\n`;
    }
  } else if (show?.is_replay) {
    msg = `━━━━━━━━━━━━━━━━━━\n✅ *Token Replay Show*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${show.title}*\n📦 Tipe: *Replay*\n⏰ Durasi: *${durationLabel}*\n`;
    msg += `\n🎫 *Token Akses:* ${tokenCode}\n`;
    msg += `\n🔗 *Link Replay:*\n${REPLAY_URL}\n`;
    if (show.access_password) {
      msg += `🔐 *Sandi Replay:* ${show.access_password}\n`;
    }
  } else if (show) {
    msg = `━━━━━━━━━━━━━━━━━━\n✅ *Token Show*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${show.title}*\n⏰ Durasi: *${durationLabel}*\n`;
    msg += `\n🎫 *Token Akses:* ${tokenCode}\n📺 *Link Nonton:*\n${liveLink}\n`;
    if (show.schedule_date) {
      msg += `📅 *Jadwal:* ${show.schedule_date} ${show.schedule_time || ""}\n`;
    }
    if (show.access_password) {
      msg += `\n🔄 *Info Replay:*\n🔗 Link: ${REPLAY_URL}\n`;
      msg += `🔑 Sandi Replay: ${show.access_password}\n`;
    }
  } else {
    msg = `━━━━━━━━━━━━━━━━━━\n✅ *Token Akses (ALL Show)*\n━━━━━━━━━━━━━━━━━━\n\n⏰ Durasi: *${durationLabel}*\n`;
    msg += `\n🎫 *Token Akses:* ${tokenCode}\n📺 *Link Nonton:*\n${liveLink}\n`;
    msg += `\n🔄 *Info Replay:*\n🔗 Link: ${REPLAY_URL}\n`;
  }

  if (customDescription.trim()) {
    msg += `\n📝 *Catatan:*\n${customDescription.trim()}\n`;
  }

  msg += `\n⚠️ _Jangan bagikan token/link ini ke orang lain._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih!_ 🙏`;
  return msg;
};

const ManualTokenGenerator = () => {
  const [shows, setShows] = useState<Show[]>([]);
  const [showId, setShowId] = useState<string>("__all__");
  const [durationKey, setDurationKey] = useState<string>("1d");
  const [customDays, setCustomDays] = useState("3");
  const [maxDevices, setMaxDevices] = useState("1");
  const [customDescription, setCustomDescription] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string>("");
  const [generatedMessage, setGeneratedMessage] = useState<string>("");
  const { toast } = useToast();

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("shows")
        .select("id,title,is_active,is_subscription,is_replay,is_bundle,access_password,group_link,schedule_date,schedule_time,membership_duration_days,bundle_duration_days,bundle_replay_info,bundle_replay_passwords")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      setShows((data as any) || []);
    };
    load();
  }, []);

  const selectedShow = useMemo(
    () => (showId === "__all__" ? null : shows.find((s) => s.id === showId) || null),
    [shows, showId]
  );

  const showTypeBadge = useMemo(() => {
    if (!selectedShow) return { label: "Semua Show", color: "bg-primary/10 text-primary" };
    if (selectedShow.is_bundle) return { label: "📦 Bundle", color: "bg-purple-500/10 text-purple-500" };
    if (selectedShow.is_subscription) return { label: "💎 Membership", color: "bg-yellow-500/10 text-yellow-500" };
    if (selectedShow.is_replay) return { label: "🔄 Replay", color: "bg-blue-500/10 text-blue-500" };
    return { label: "🎭 Reguler", color: "bg-primary/10 text-primary" };
  }, [selectedShow]);

  const durationInfo = useMemo(() => {
    // Membership shows MUST follow admin-defined membership_duration_days,
    // overriding any UI-selected duration. This keeps manual tokens consistent
    // with QRIS/coin/bot purchase flows.
    if (selectedShow?.is_subscription) {
      const days = Math.max(1, Number(selectedShow.membership_duration_days) || 30);
      return { ms: days * 86_400_000, label_h: `${days} hari (Membership)`, locked: true as const, storedDuration: "membership" };
    }
    // Bundle shows follow bundle_duration_days when set
    if (selectedShow?.is_bundle && Number(selectedShow.bundle_duration_days) > 0) {
      const days = Number(selectedShow.bundle_duration_days);
      return { ms: days * 86_400_000, label_h: `${days} hari (Bundle)`, locked: true as const, storedDuration: "bundle" };
    }
    if (durationKey === "custom") {
      const days = Math.max(1, Math.min(365, parseInt(customDays) || 1));
      return { ms: days * 86_400_000, label_h: `${days} hari`, locked: false as const, storedDuration: "custom" };
    }
    const opt = DURATION_OPTIONS.find((d) => d.key === durationKey)!;
    return { ms: opt.ms, label_h: opt.label_h, locked: false as const, storedDuration: durationKey };
  }, [durationKey, customDays, selectedShow]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGeneratedToken("");
    setGeneratedMessage("");

    const prefix = buildPrefix(selectedShow);
    const code = `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const expiresAt = new Date(Date.now() + durationInfo.ms);
    const md = Math.min(9999, Math.max(1, parseInt(maxDevices) || 1));

    const { error } = await supabase.from("tokens").insert({
      code,
      max_devices: md,
      duration_type: durationInfo.storedDuration,
      expires_at: expiresAt.toISOString(),
      show_id: selectedShow?.id ?? null,
      status: "active",
      is_public: false,
    });

    if (error) {
      toast({ title: "Gagal membuat token", description: error.message, variant: "destructive" });
      setGenerating(false);
      return;
    }

    const message = buildMessage({
      show: selectedShow,
      tokenCode: code,
      durationLabel: durationInfo.label_h,
      customDescription,
    });

    setGeneratedToken(code);
    setGeneratedMessage(message);
    toast({ title: "✅ Token & pesan siap!", description: code });
    setGenerating(false);
  };

  const copyMessage = () => {
    navigator.clipboard.writeText(generatedMessage);
    toast({ title: "Pesan disalin ke clipboard" });
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`https://${SITE_URL}/live?t=${generatedToken}`);
    toast({ title: "Link nonton disalin" });
  };

  const sendViaWa = () => {
    const clean = recipientPhone.replace(/[^0-9]/g, "");
    if (clean.length < 9) {
      toast({ title: "Nomor WhatsApp tidak valid", variant: "destructive" });
      return;
    }
    let normalized = clean;
    if (normalized.startsWith("0")) normalized = "62" + normalized.slice(1);
    if (!normalized.startsWith("62")) normalized = "62" + normalized;
    const url = `https://wa.me/${normalized}?text=${encodeURIComponent(generatedMessage)}`;
    window.open(url, "_blank");
  };

  const reset = () => {
    setGeneratedToken("");
    setGeneratedMessage("");
    setRecipientPhone("");
    setCustomDescription("");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Ticket className="h-5 w-5 text-primary" />
          <h3 className="text-base font-bold text-foreground">🎫 Token Generator Manual</h3>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Buat token + pesan format bot WhatsApp/Telegram langsung dari admin panel. Pesan otomatis menyesuaikan tipe show (Reguler / Replay / Membership / Bundle) lengkap dengan info replay & sandi.
        </p>

        <div className="space-y-4">
          {/* Show selector */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Pilih Show (atau biarkan untuk token ALL)</label>
            <Select value={showId} onValueChange={setShowId}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Pilih show..." />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__all__">🌐 ALL Show (tanpa show_id)</SelectItem>
                {shows.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.is_bundle ? "📦 " : s.is_subscription ? "💎 " : s.is_replay ? "🔄 " : "🎭 "}
                    {s.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-2 flex items-center gap-2">
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${showTypeBadge.color}`}>
                {showTypeBadge.label}
              </span>
              {selectedShow?.access_password && (
                <span className="inline-flex items-center rounded-md bg-[hsl(var(--warning))]/10 px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--warning))]">
                  🔐 Punya sandi replay
                </span>
              )}
            </div>
          </div>

          {/* Duration + max devices */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Durasi</label>
              <Select value={durationKey} onValueChange={setDurationKey}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {durationKey === "custom" && (
                <Input
                  type="number" min={1} max={365}
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  className="mt-2 bg-background"
                  placeholder="Hari (1-365)"
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Max Device</label>
              <Input
                type="number" min={1} max={9999}
                value={maxDevices}
                onChange={(e) => setMaxDevices(e.target.value)}
                className="bg-background"
              />
            </div>
          </div>

          {/* Custom description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Catatan Tambahan (opsional)</label>
            <Textarea
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              className="bg-background"
              rows={2}
              placeholder="Mis. 'Untuk paket VIP bulan ini'..."
            />
          </div>

          <Button
            className="w-full gap-2"
            onClick={handleGenerate}
            disabled={generating}
          >
            <Sparkles className="h-4 w-4" />
            {generating ? "Membuat token..." : "Buat Token & Pesan"}
          </Button>
        </div>
      </div>

      {/* Result */}
      {generatedToken && (
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-foreground">✅ Token Berhasil Dibuat</h4>
            <Button size="sm" variant="ghost" onClick={reset} className="gap-1">
              <RefreshCw className="h-3 w-3" /> Reset
            </Button>
          </div>

          <div className="rounded-lg bg-background p-3">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Token Code</p>
            <p className="font-mono text-sm font-bold text-primary break-all">{generatedToken}</p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pesan Format Bot</p>
              <Button size="sm" variant="ghost" onClick={copyMessage} className="h-6 gap-1 text-xs">
                <Copy className="h-3 w-3" /> Salin
              </Button>
            </div>
            <Textarea
              value={generatedMessage}
              onChange={(e) => setGeneratedMessage(e.target.value)}
              className="bg-background font-mono text-xs"
              rows={14}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Bisa diedit sebelum dikirim. Pesan auto-menyesuaikan tipe show & sandi replay.</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" className="gap-2" onClick={copyLink}>
              <Copy className="h-4 w-4" /> Salin Link Nonton
            </Button>
            <Button variant="outline" className="gap-2" onClick={copyMessage}>
              <Copy className="h-4 w-4" /> Salin Pesan
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-background p-3 space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">Kirim langsung via WhatsApp</label>
            <div className="flex gap-2">
              <Input
                type="tel"
                placeholder="08xxxx atau 62xxxx"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                className="bg-background"
              />
              <Button onClick={sendViaWa} className="gap-2 shrink-0" disabled={!recipientPhone.trim()}>
                <Send className="h-4 w-4" /> Kirim
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">Akan membuka wa.me dengan pesan terisi.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManualTokenGenerator;
