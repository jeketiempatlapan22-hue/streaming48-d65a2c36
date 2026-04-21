import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Copy, Plus, Calendar, Clock, KeyRound, Film, CheckCircle2 } from "lucide-react";

interface Show {
  id: string;
  title: string;
  price?: string;
  schedule_date?: string;
  schedule_time?: string;
  lineup?: string;
  team?: string;
  category?: string;
  is_replay?: boolean;
  is_subscription?: boolean;
  is_bundle?: boolean;
  access_password?: string;
  bundle_replay_info?: string;
  bundle_replay_passwords?: any;
  background_image_url?: string;
  short_id?: string;
}

interface Props {
  show: Show;
  sessionToken: string;
  onTokenCreated: () => void;
}

const LIVE_BASE = "https://realtime48stream.my.id/live";

const ResellerShowCard = ({ show, sessionToken, onTokenCreated }: Props) => {
  const [maxDevices, setMaxDevices] = useState("1");
  const [duration, setDuration] = useState("7");
  const [generating, setGenerating] = useState(false);
  const [lastToken, setLastToken] = useState<{
    code: string;
    link: string;
    message: string;
  } | null>(null);
  const { toast } = useToast();

  const isMembership = !!show.is_subscription;

  const buildShareMessage = (params: {
    code: string;
    link: string;
    maxDevices: number;
    durationDays: number;
    expiresAt: string | null;
  }) => {
    const expDate = params.expiresAt
      ? new Date(params.expiresAt).toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
          day: "2-digit",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";

    const scheduleParts = [show.schedule_date, show.schedule_time].filter(Boolean).join(" • ");
    const scheduleLine = scheduleParts ? `\n🗓️ Jadwal Show: *${scheduleParts} WIB*` : "";

    let msg = `━━━━━━━━━━━━━━━━━━
✅ *Token Reseller Berhasil Dibuat!*
━━━━━━━━━━━━━━━━━━

🎬 Show: *${show.title}*${scheduleLine}
🔑 Token: ${params.code}
📱 Max Device: *${params.maxDevices}*
⏰ Durasi: *${params.durationDays} hari*
📅 Kedaluwarsa: ${expDate}

ℹ️ *Catatan Masa Berlaku:*
Token aktif mengikuti jadwal show. Masa berlaku dihitung dari *jadwal show + ${params.durationDays} hari*, bukan dari saat token dibuat. Jadi token tetap bisa dipakai saat show berlangsung meski dibuat lebih awal.

📺 *Link Nonton:*
${params.link}

🔄 *Info Replay:*
🔗 Link: https://replaytime.lovable.app`;

    if (show.access_password) {
      msg += `\n🔐 Sandi Replay: *${show.access_password}*`;
    } else {
      msg += `\nℹ️ Sandi replay belum diatur untuk show ini.`;
    }

    msg += `\n\n⚠️ _Jangan bagikan token/link ini ke orang lain._
━━━━━━━━━━━━━━━━━━`;

    return msg;
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const md = Math.max(1, Math.min(10, parseInt(maxDevices) || 1));
      // Non-membership shows are forced to 1 day server-side; only membership uses custom duration
      const dd = isMembership
        ? Math.max(1, Math.min(90, parseInt(duration) || 7))
        : 1;
      const { data, error } = await supabase.rpc("reseller_create_token", {
        _session_token: sessionToken,
        _show_id: show.id,
        _max_devices: md,
        _duration_days: dd,
      });
      if (error) throw error;
      const res = data as any;
      if (!res?.success) {
        toast({ title: "Gagal", description: res?.error || "Tidak dapat membuat token", variant: "destructive" });
        return;
      }
      const link = `${LIVE_BASE}?t=${res.code}`;
      const message = buildShareMessage({
        code: res.code,
        link,
        maxDevices: md,
        durationDays: dd,
        expiresAt: res.expires_at ?? null,
      });
      setLastToken({ code: res.code, link, message });
      toast({ title: "Token dibuat!", description: res.code });
      onTokenCreated();
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Gagal", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = async () => {
    if (!lastToken) return;
    try {
      await navigator.clipboard.writeText(lastToken.link);
      toast({ title: "Tersalin!", description: "Link siap dibagikan" });
    } catch {
      toast({ title: "Gagal menyalin", variant: "destructive" });
    }
  };

  const copyFullMessage = async () => {
    if (!lastToken) return;
    try {
      await navigator.clipboard.writeText(lastToken.message);
      toast({ title: "Pesan tersalin!", description: "Format lengkap siap dibagikan" });
    } catch {
      toast({ title: "Gagal menyalin", variant: "destructive" });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {show.background_image_url && (
        <div className="aspect-[16/7] w-full bg-muted overflow-hidden">
          <img src={show.background_image_url} alt={show.title} className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}
      <div className="p-4 space-y-3">
        <div>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <h3 className="font-bold text-foreground text-base leading-tight flex-1 min-w-0 break-words">
              {show.title}
            </h3>
            <div className="flex gap-1 flex-wrap">
              {show.is_replay && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30">Replay</span>}
              {show.is_subscription && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">Member</span>}
              {show.is_bundle && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">Bundle</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-muted-foreground">
            {show.schedule_date && (
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{show.schedule_date}</span>
            )}
            {show.schedule_time && (
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{show.schedule_time}</span>
            )}
            {show.short_id && <span className="font-mono">#{show.short_id}</span>}
          </div>
          {show.lineup && (
            <p className="mt-2 text-[11px] text-muted-foreground line-clamp-2">{show.lineup}</p>
          )}
        </div>



        <div className={isMembership ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2"}>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Max Device</label>
            <Input type="number" min={1} max={10} value={maxDevices} onChange={(e) => setMaxDevices(e.target.value)} className="h-9" />
          </div>
          {isMembership ? (
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Durasi (hari)</label>
              <Input type="number" min={1} max={90} value={duration} onChange={(e) => setDuration(e.target.value)} className="h-9" />
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground bg-muted/30 border border-border rounded-md px-2 py-1.5 flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Durasi token: <span className="font-semibold text-foreground">1 hari</span> (otomatis)
            </div>
          )}
        </div>

        <div className="text-[10px] text-muted-foreground bg-primary/5 border border-primary/20 rounded-md px-2 py-1.5 flex items-start gap-1.5">
          <Calendar className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
          <span>
            Berlaku: <span className="font-semibold text-foreground">jadwal show + {isMembership ? `${Math.max(1, Math.min(90, parseInt(duration) || 7))} hari` : "1 hari"}</span>
            {(show.schedule_date || show.schedule_time) && (
              <> (mulai {[show.schedule_date, show.schedule_time].filter(Boolean).join(" • ")} WIB)</>
            )}
          </span>
        </div>

        <Button onClick={generate} disabled={generating} className="w-full" size="sm">
          <Plus className="h-4 w-4 mr-1" />
          {generating ? "Membuat..." : "Buat Token Baru"}
        </Button>

        {lastToken && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" /> Token berhasil dibuat
            </div>

            <div className="font-mono text-[11px] bg-background/60 p-2 rounded break-all">{lastToken.code}</div>
            <div className="font-mono text-[10px] text-muted-foreground bg-background/60 p-2 rounded break-all">{lastToken.link}</div>

            {show.access_password && (
              <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-2 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-300">
                  <Film className="h-3 w-3" /> Info Replay
                </div>
                <div className="text-[11px] text-foreground flex items-center gap-1.5">
                  <KeyRound className="h-3 w-3 text-purple-400" />
                  <span className="text-muted-foreground">Sandi:</span>
                  <span className="font-mono bg-background/60 px-1.5 py-0.5 rounded">{show.access_password}</span>
                </div>
                <div className="text-[10px] text-muted-foreground break-all">
                  🔗 https://replaytime.lovable.app
                </div>
              </div>
            )}

            <pre className="text-[10px] text-foreground/90 bg-background/60 p-2 rounded whitespace-pre-wrap break-words font-sans leading-relaxed max-h-48 overflow-y-auto">
{lastToken.message}
            </pre>

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={copyLink} variant="outline" size="sm">
                <Copy className="h-3.5 w-3.5 mr-1" /> Salin Link
              </Button>
              <Button onClick={copyFullMessage} size="sm">
                <Copy className="h-3.5 w-3.5 mr-1" /> Salin Pesan
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResellerShowCard;
