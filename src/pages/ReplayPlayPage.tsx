import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import HlsReplayPlayer from "@/components/replay/HlsReplayPlayer";
import YoutubeReplayPlayer from "@/components/replay/YoutubeReplayPlayer";
import LineupAvatars from "@/components/viewer/LineupAvatars";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SharedNavbar from "@/components/SharedNavbar";
import { Lock, Clock, AlertCircle, RotateCcw, ExternalLink, Youtube, Film, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FP_KEY = "rt48_replay_fp";
const getFingerprint = (): string => {
  let fp = localStorage.getItem(FP_KEY);
  if (!fp) {
    fp =
      "fp-" +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2);
    localStorage.setItem(FP_KEY, fp);
  }
  return fp;
};

interface AccessData {
  success: boolean;
  access_via?: string;
  token_code?: string;
  show_id?: string;
  show_title?: string;
  m3u8_url?: string | null;
  youtube_url?: string | null;
  has_media?: boolean;
  expires_at?: string | null;
  error?: string;
  message?: string;
}

interface ShowMeta {
  background_image_url?: string | null;
  schedule_date?: string | null;
  schedule_time?: string | null;
  team?: string | null;
  lineup?: string | null;
}

type Source = "auto" | "m3u8" | "youtube";

const resolveAuto = (a: AccessData | null): "m3u8" | "youtube" | null => {
  if (!a) return null;
  if (a.m3u8_url) return "m3u8";
  if (a.youtube_url) return "youtube";
  return null;
};

const ReplayPlayPage = () => {
  const { toast } = useToast();
  const [params] = useSearchParams();
  const initialToken = params.get("token") || "";
  const initialShort = params.get("show") || "";
  const initialPw = params.get("password") || "";

  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState(initialPw);
  const [shortId] = useState(initialShort);

  const [loading, setLoading] = useState(false);
  const [access, setAccess] = useState<AccessData | null>(null);
  const [lockMsg, setLockMsg] = useState<string>("");
  const [showMeta, setShowMeta] = useState<ShowMeta | null>(null);
  const [source, setSource] = useState<Source>("auto");

  const fp = getFingerprint();

  // Mode auto: ikuti media yang tersedia (M3U8 dulu, fallback YouTube)
  const effectiveSource: "m3u8" | "youtube" | null =
    source === "auto" ? resolveAuto(access) : source;

  const tryAccess = async () => {
    setLoading(true);
    setLockMsg("");
    try {
      const { data, error } = await supabase.rpc("validate_replay_access" as any, {
        _token: token || null,
        _password: password || null,
        _show_id: null,
        _short_id: shortId || null,
      });
      if (error) {
        setAccess({ success: false, error: error.message });
        setLoading(false);
        return;
      }
      const d = data as AccessData;
      if (!d?.success) {
        setAccess(d || { success: false, error: "Akses ditolak" });
        setLoading(false);
        return;
      }

      // Acquire single-device session if there is a token code
      if (d.token_code) {
        const { data: sess } = await supabase.rpc("create_replay_session" as any, {
          _token_code: d.token_code,
          _fingerprint: fp,
          _user_agent: navigator.userAgent,
        });
        const s = sess as any;
        if (s && !s.success) {
          setLockMsg(s.message || "Token sedang aktif di perangkat lain.");
          setAccess(d);
          setLoading(false);
          return;
        }
      }

      // Ambil metadata show (poster, jadwal, lineup, team) — sama seperti LivePage
      try {
        const { data: shows } = await supabase.rpc("get_public_shows" as any);
        const show = (shows as any[])?.find((s) => s.id === d.show_id);
        if (show) {
          setShowMeta({
            background_image_url: show.background_image_url || null,
            schedule_date: show.schedule_date || null,
            schedule_time: show.schedule_time || null,
            team: show.team || null,
            lineup: show.lineup || null,
          });
        }
      } catch {
        /* ignore */
      }

      setAccess(d);
    } catch (e: any) {
      setAccess({ success: false, error: e?.message || "Gagal memvalidasi" });
    }
    setLoading(false);
  };

  useEffect(() => {
    // Auto-attempt when:
    // - replay token in URL, OR
    // - short_id in URL (RPC will auto-grant via user's active token / coin redeem if logged in;
    //   otherwise it will fail silently and the user can enter a password)
    if (initialToken || initialShort) {
      tryAccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResetDevice = async () => {
    if (!access?.token_code) return;
    const { data } = await supabase.rpc("self_reset_replay_session" as any, {
      _token_code: access.token_code,
      _fingerprint: fp,
    });
    const r = data as any;
    if (!r?.success) {
      toast({
        title: "Gagal reset perangkat",
        description: r?.message || r?.error || "Coba lagi nanti",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Perangkat berhasil direset", description: "Memuat ulang…" });
    setLockMsg("");
    setTimeout(() => tryAccess(), 600);
  };

  const isExpired =
    access?.expires_at && new Date(access.expires_at).getTime() < Date.now();

  const fallbackExternal = access?.success && access.has_media === false;

  const accessBadge = useMemo(() => {
    switch (access?.access_via) {
      case "global_password": return "Sandi Global";
      case "show_password": return "Sandi Show";
      case "live_token_upgrade": return "Token Live → Replay";
      case "replay_token": return "Token Replay";
      case "purchased_live_token": return "Akses dari Pembelian Live";
      case "universal_token": return "Akses Membership/Bundle";
      default: return "Akses Replay";
    }
  }, [access?.access_via]);

  const hasBoth = !!(access?.m3u8_url && access?.youtube_url);

  return (
    <div className="min-h-screen bg-background">
      <SharedNavbar />
      <div className="mx-auto max-w-3xl px-4 pt-20 pb-12 space-y-5">
        <header className="text-center">
          <h1 className="text-2xl font-extrabold text-foreground">🎬 Pemutar Replay</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Akses dengan token, sandi show, atau sandi global bulanan
          </p>
        </header>

        {/* Auth form when no access yet */}
        {!access?.success && (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Token Replay (opsional)
              </label>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
                placeholder="RPL-XXXXXXXX"
                className="bg-background font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Sandi Replay
              </label>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Sandi show / sandi global bulanan"
                className="bg-background"
              />
            </div>
            <Button onClick={tryAccess} disabled={loading} className="w-full gap-2">
              <Lock className="h-4 w-4" />
              {loading ? "Memvalidasi..." : "Buka Replay"}
            </Button>
            {access && !access.success && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{access.error || "Akses ditolak"}</p>
              </div>
            )}
          </div>
        )}

        {/* Lock message */}
        {access?.success && lockMsg && (
          <div className="rounded-2xl border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 p-5 space-y-3 text-center">
            <Lock className="mx-auto h-10 w-10 text-[hsl(var(--warning))]" />
            <p className="text-sm font-semibold text-foreground">{lockMsg}</p>
            <p className="text-xs text-muted-foreground">
              Anda dapat mereset perangkat (maks 3x per 24 jam).
            </p>
            <Button onClick={handleResetDevice} variant="outline" className="w-full gap-2">
              <RotateCcw className="h-4 w-4" /> Reset Perangkat
            </Button>
          </div>
        )}

        {/* Expired */}
        {access?.success && isExpired && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 space-y-2 text-center">
            <Clock className="mx-auto h-10 w-10 text-destructive" />
            <p className="text-sm font-semibold text-foreground">
              Akses replay sudah berakhir
            </p>
            <p className="text-xs text-muted-foreground">
              Silakan beli ulang akses replay.
            </p>
          </div>
        )}

        {/* Fallback to external */}
        {fallbackExternal && !lockMsg && !isExpired && (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3 text-center">
            <p className="text-sm text-foreground">
              Show ini belum memiliki link M3U8/YouTube internal.
            </p>
            <a
              href="https://replaytime.lovable.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              <ExternalLink className="h-4 w-4" /> Buka di replaytime.lovable.app
            </a>
          </div>
        )}

        {/* Player + header (mirror LivePage) */}
        {access?.success && !lockMsg && !isExpired && access.has_media && (
          <div className="space-y-4">
            {/* Header judul + badge akses + jadwal */}
            <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold text-foreground">
                    {access.show_title || "Replay Show"}
                  </h2>
                  {(showMeta?.schedule_date || showMeta?.schedule_time) && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5 text-primary" />
                      {showMeta.schedule_date} {showMeta.schedule_time || ""}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-bold text-primary">
                  {accessBadge}
                </span>
              </div>
            </div>

            {/* Info akses replay 14 hari — di atas player agar langsung terlihat */}
            {access.expires_at && (() => {
              const exp = new Date(access.expires_at);
              const msLeft = exp.getTime() - Date.now();
              const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
              const hoursLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60)));
              const isUrgent = daysLeft <= 2;
              const sisaText = daysLeft >= 1 ? `${daysLeft} hari` : `${hoursLeft} jam`;
              const isUpgraded = access.access_via === "live_token_upgrade";
              return (
                <div
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                    isUrgent
                      ? "border-destructive/40 bg-destructive/10"
                      : "border-primary/30 bg-primary/5"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      isUrgent ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary"
                    }`}
                  >
                    <Clock className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-bold ${isUrgent ? "text-destructive" : "text-primary"}`}>
                      Akses Replay 14 Hari{isUpgraded ? " • Otomatis Diperpanjang" : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Sisa <strong>{sisaText}</strong> • Berakhir{" "}
                      {exp.toLocaleString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      WIB
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Selector sumber tonton — di atas player */}
            {hasBoth && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-1.5">
                <button
                  onClick={() => setSource("auto")}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                    source === "auto"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                  title="Pilih otomatis berdasarkan media yang tersedia"
                >
                  ⚡ Auto
                  {source === "auto" && effectiveSource && (
                    <span className="opacity-70">({effectiveSource === "m3u8" ? "HD" : "YT"})</span>
                  )}
                </button>
                <button
                  onClick={() => setSource("m3u8")}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                    source === "m3u8"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <Film className="h-4 w-4" /> M3U8
                </button>
                <button
                  onClick={() => setSource("youtube")}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
                    source === "youtube"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <Youtube className="h-4 w-4" /> YouTube
                </button>
              </div>
            )}

            {/* Player — di atas lineup member */}
            {effectiveSource === "m3u8" && access.m3u8_url ? (
              <HlsReplayPlayer
                src={access.m3u8_url}
                poster={showMeta?.background_image_url || null}
                onError={(msg) =>
                  toast({ title: "Player error", description: msg, variant: "destructive" })
                }
              />
            ) : effectiveSource === "youtube" && access.youtube_url ? (
              <YoutubeReplayPlayer
                url={access.youtube_url}
                poster={showMeta?.background_image_url || null}
              />
            ) : null}

            {/* Lineup + foto member — pindah ke bawah player */}
            {(access.show_id || showMeta?.lineup) && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <LineupAvatars showId={access.show_id} team={showMeta?.team || null} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReplayPlayPage;
