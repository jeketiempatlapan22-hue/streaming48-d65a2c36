import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import HlsReplayPlayer from "@/components/replay/HlsReplayPlayer";
import YoutubeReplayPlayer from "@/components/replay/YoutubeReplayPlayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SharedNavbar from "@/components/SharedNavbar";
import { Lock, Clock, AlertCircle, RotateCcw, ExternalLink } from "lucide-react";
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
  const [showThumb, setShowThumb] = useState<string | null>(null);

  const fp = getFingerprint();

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

      // Try to fetch poster
      try {
        const { data: shows } = await supabase.rpc("get_public_shows" as any);
        const show = (shows as any[])?.find((s) => s.id === d.show_id);
        if (show?.background_image_url) setShowThumb(show.background_image_url);
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
    if (initialToken || (initialShort && initialPw)) {
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

  // Fallback to external when no media is configured for this show
  const fallbackExternal = access?.success && access.has_media === false;

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

        {/* Player */}
        {access?.success && !lockMsg && !isExpired && access.has_media && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">{access.show_title}</h2>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                {access.access_via === "global_password"
                  ? "Sandi Global"
                  : access.access_via === "show_password"
                  ? "Sandi Show"
                  : access.access_via === "live_token_upgrade"
                  ? "Token Live"
                  : "Token Replay"}
              </span>
            </div>

            {access.m3u8_url ? (
              <HlsReplayPlayer
                src={access.m3u8_url}
                poster={showThumb}
                onError={(msg) =>
                  toast({ title: "Player error", description: msg, variant: "destructive" })
                }
              />
            ) : access.youtube_url ? (
              <YoutubeReplayPlayer url={access.youtube_url} poster={showThumb} />
            ) : null}

            {access.expires_at && (
              <p className="text-center text-[11px] text-muted-foreground">
                Akses berlaku sampai{" "}
                {new Date(access.expires_at).toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReplayPlayPage;
