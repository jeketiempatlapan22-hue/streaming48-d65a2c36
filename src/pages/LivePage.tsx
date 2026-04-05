import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import PlaylistSwitcher from "@/components/viewer/PlaylistSwitcher";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { VideoPlayerHandle } from "@/components/VideoPlayer";
import logo from "@/assets/logo.png";
import ConnectionStatus from "@/components/viewer/ConnectionStatus";
import PipButton from "@/components/viewer/PipButton";
import SecurityAlert from "@/components/viewer/SecurityAlert";
import LiveViewerCount from "@/components/viewer/LiveViewerCount";
import type { AnimationType } from "@/components/viewer/PlayerAnimations";
import ViewerBroadcast from "@/components/viewer/ViewerBroadcast";
import { Menu, X, MessageCircle, Home, Phone } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";

import { useSignedStreamUrl } from "@/hooks/useSignedStreamUrl";
import { useProxyStream } from "@/hooks/useProxyStream";
import { withRetry, withTimeout } from "@/lib/queryCache";

const VideoPlayer = lazy(() => import("@/components/VideoPlayer"));
const LiveChat = lazy(() => import("@/components/viewer/LiveChat"));
const UsernameModal = lazy(() => import("@/components/viewer/UsernameModal"));
const LivePoll = lazy(() => import("@/components/viewer/LivePoll"));
const LineupAvatars = lazy(() => import("@/components/viewer/LineupAvatars"));
const PlayerAnimations = lazy(() => import("@/components/viewer/PlayerAnimations"));

const DeviceLimitScreen = ({ tokenCode, getFingerprint, navigate }: { tokenCode: string; getFingerprint: () => string; navigate: (path: string) => void }) => {
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    setResetError("");
    try {
      const fp = getFingerprint();
      const { data } = await supabase.rpc("self_reset_token_session" as any, { _token_code: tokenCode, _fingerprint: fp });
      const result = data as any;
      if (result?.success) {
        setResetSuccess(true);
        setTimeout(() => window.location.reload(), 1000);
      } else {
        setResetError(result?.error || "Gagal reset sesi.");
      }
    } catch { setResetError("Terjadi kesalahan."); }
    setResetting(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-card p-8 text-center">
        <h2 className="mb-2 text-xl font-bold text-destructive">Batas Perangkat Tercapai</h2>
        <p className="mb-4 text-muted-foreground">Token sedang digunakan di perangkat lain.</p>
        {resetSuccess ? (
          <p className="text-sm font-medium text-[hsl(var(--success))]">✅ Sesi direset! Memuat ulang...</p>
        ) : (
          <div className="space-y-3">
            <button onClick={handleReset} disabled={resetting} className="w-full rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {resetting ? "Mereset..." : "🔄 Reset Sesi (maks 2x/24jam)"}
            </button>
            {resetError && <p className="text-sm text-destructive">{resetError}</p>}
            <button onClick={() => navigate("/")} className="rounded-full bg-secondary px-6 py-3 font-semibold text-secondary-foreground hover:bg-secondary/80">🏠 Ke Beranda</button>
          </div>
        )}
      </div>
    </div>
  );
};
// Sort playlists: 1st m3u8, 2nd youtube, 3rd proxy, then remaining
const sortPlaylists = (list: any[]): any[] => {
  if (!list || list.length <= 1) return list;
  const firstM3u8 = list.find((p) => p.type === "m3u8");
  const firstYoutube = list.find((p) => p.type === "youtube");
  const firstProxy = list.find((p) => p.type === "proxy");
  const rest = list.filter(
    (p) => p !== firstM3u8 && p !== firstYoutube && p !== firstProxy
  );
  return [firstM3u8, firstYoutube, firstProxy, ...rest].filter(Boolean);
};

const LivePage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tokenCode = searchParams.get("t") || "";
  const [tokenData, setTokenData] = useState<any>(null);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stream, setStream] = useState<any>(null);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<any>(null);
  const [username, setUsername] = useState(() => localStorage.getItem("rt48_username") || "");
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [countdown, setCountdown] = useState("");
  const [nextShowTime, setNextShowTime] = useState("");
  const [playerAnimation, setPlayerAnimation] = useState<AnimationType>("none");
  const [showMismatch, setShowMismatch] = useState(false);
  const [mismatchShowTitle, setMismatchShowTitle] = useState("");
  const [showReplayBlocked, setShowReplayBlocked] = useState(false);
  const [externalShowId, setExternalShowId] = useState<string | null>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);

  const getFingerprint = useCallback(() => {
    let fp = localStorage.getItem("rt48_fp");
    if (!fp) { fp = crypto.randomUUID(); localStorage.setItem("rt48_fp", fp); }
    return fp;
  }, []);

  const fp = getFingerprint();

  const isProxyPlaylist = activePlaylist?.type === "proxy";

  // For m3u8/youtube: use signed stream URL via edge function
  const { signedUrl, loading: signedLoading, proxyType } = useSignedStreamUrl(
    !isProxyPlaylist && activePlaylist ? { id: activePlaylist.id, type: activePlaylist.type, url: activePlaylist.url } : null,
    tokenCode,
    fp
  );

  // For proxy: call hanabira48 API directly (domain whitelisted, no CORS)
  const { playbackUrl: proxyUrl, customHeaders: proxyHeaders, loading: proxyLoading } = useProxyStream(
    isProxyPlaylist,
    externalShowId
  );

  // Unified URL, loading, and type for VideoPlayer
  const effectiveStreamUrl = isProxyPlaylist ? proxyUrl : signedUrl;
  const effectiveStreamLoading = isProxyPlaylist ? proxyLoading : signedLoading;
  const effectiveType = isProxyPlaylist ? "m3u8" : (proxyType || activePlaylist?.type || "m3u8");
  const effectiveHeaders = isProxyPlaylist ? proxyHeaders : null;

  const runWithTimeoutRetry = async <T,>(
    request: () => Promise<{ data: T | null; error: any }>,
    timeoutMs: number,
    retries: number
  ) => {
    return withRetry(
      () =>
        withTimeout(request(), timeoutMs, "Permintaan ke server timeout")
          .then((result) => ({ data: result.data, error: result.error }))
          .catch((error) => ({ data: null, error })),
      retries,
      700
    );
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          8_000,
          "Session timeout"
        );

        if (session?.user) {
          const profileRes = await withTimeout(
            (async () => await supabase.from("profiles").select("username").eq("id", session.user.id).maybeSingle())(),
            8_000,
            "Profile timeout"
          ).catch(() => null);

          if (profileRes?.data?.username) {
            setUsername(profileRes.data.username);
            localStorage.setItem("rt48_username", profileRes.data.username);
            return;
          }
          setShowUsernameModal(true);
          return;
        }

        const stored = localStorage.getItem("rt48_username");
        if (!stored) setShowUsernameModal(true);
      } catch {
        const stored = localStorage.getItem("rt48_username");
        if (!stored) setShowUsernameModal(true);
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    const validate = async () => {
      try {
        if (!tokenCode) {
          const settingsRes = await withTimeout(
            (async () => await supabase.from("site_settings").select("*"))(),
            8_000,
            "Settings timeout"
          ).catch(() => null);

          if (settingsRes?.data) {
            settingsRes.data.forEach((s: any) => {
              if (s.key === "purchase_message") setPurchaseMessage(s.value);
              if (s.key === "whatsapp_number") setWhatsappNumber(s.value);
            });
          }

          setError("no_token");
          return;
        }

        const settingsEarlyRes = await withTimeout(
          (async () => await supabase.from("site_settings").select("*"))(),
          8_000,
          "Settings timeout"
        ).catch(() => null);

        if (settingsEarlyRes?.data) {
          settingsEarlyRes.data.forEach((s: any) => {
            if (s.key === "whatsapp_number") setWhatsappNumber(s.value);
          });
        }

        const validationResult = await runWithTimeoutRetry(
          async () => await supabase.rpc("validate_token", { _code: tokenCode }),
          10_000,
          1
        );

        const result = validationResult.data as any;
        if (validationResult.error || !result?.valid) {
          const errText = String(result?.error || validationResult.error?.message || "").toLowerCase();
          if (errText.includes("diblokir")) { setBlocked(true); return; }
          setError(result?.error || "Server sedang sibuk, coba muat ulang.");
          return;
        }

        const fp = getFingerprint();
        const sessionResult = await runWithTimeoutRetry(
          async () => await supabase.rpc("create_token_session", { _token_code: tokenCode, _fingerprint: fp, _user_agent: navigator.userAgent }),
          10_000,
          1
        );

        const sd = sessionResult.data as any;
        if (sessionResult.error || !sd?.success) {
          setError(sd?.error === "device_limit" ? "device_limit" : "Server sedang sibuk, coba lagi.");
          return;
        }

        setTokenData({ id: result.id, code: result.code, show_id: result.show_id, expires_at: result.expires_at, created_at: result.created_at });

        const [streamRes, playlistRes, settingsRes] = await Promise.allSettled([
          withTimeout((async () => await (supabase.rpc as any)("get_stream_status"))(), 8_000, "Stream timeout"),
          withTimeout((async () => await (supabase.rpc as any)("get_safe_playlists"))(), 8_000, "Playlist timeout"),
          withTimeout((async () => await supabase.from("site_settings").select("*"))(), 8_000, "Settings timeout"),
        ]);

        if (streamRes.status === "fulfilled" && streamRes.value.data?.length) setStream(streamRes.value.data[0]);
        if (playlistRes.status === "fulfilled" && playlistRes.value.data?.length) {
          const sorted = sortPlaylists(playlistRes.value.data);
          setPlaylists(sorted);
          setActivePlaylist(sorted[0]);
        }

        let activeShowId = "";
        const settingsData = settingsRes.status === "fulfilled" ? settingsRes.value.data : null;
        if (settingsData) {
          settingsData.forEach((s: any) => {
            if (s.key === "next_show_time") setNextShowTime(s.value);
            if (s.key === "whatsapp_number") setWhatsappNumber(s.value);
            if (s.key === "player_animation") setPlayerAnimation((s.value || "none") as AnimationType);
            if (s.key === "active_show_id") activeShowId = s.value;
          });
        }

        // Fetch external_show_id for proxy player
        if (activeShowId) {
          const showRes = await withTimeout(
            (async () => await supabase.rpc("get_public_shows"))(),
            8_000,
            "Shows timeout"
          ).catch(() => null);
          const allShows = showRes?.data as any[] | undefined;
          const activeShow = allShows?.find((s: any) => s.id === activeShowId);
          if (activeShow?.external_show_id) {
            setExternalShowId(activeShow.external_show_id);
          }

        // Membership tokens (MBR-) can access ANY live show — skip mismatch check
        const isMembershipToken = result.code?.startsWith("MBR-");
        if (result.show_id && result.show_id !== activeShowId && !isMembershipToken) {
            const tokenShow = allShows?.find((s: any) => s.id === result.show_id);
            setShowMismatch(true);
            setMismatchShowTitle(JSON.stringify({
              tokenShowTitle: tokenShow?.title || "Show Lain",
              tokenShowDate: tokenShow?.schedule_date || "",
              tokenShowTime: tokenShow?.schedule_time || "",
              activeShowTitle: activeShow?.title || "Show Lain",
            }));
          }
        }
      } catch {
        setError("Server sedang sibuk, coba muat ulang halaman.");
      } finally {
        setLoading(false);
      }
    };
    validate();
  }, [tokenCode, getFingerprint]);

  useEffect(() => {
    if (!tokenCode) return;
    const fpVal = getFingerprint();
    const releaseSession = () => {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/release_token_session`;
      const body = JSON.stringify({ _token_code: tokenCode, _fingerprint: fpVal });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      };
      try {
        fetch(url, { method: "POST", headers, body, keepalive: true }).catch(() => {});
      } catch {
        try {
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon?.(`${url}?apikey=${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`, blob);
        } catch {}
      }
    };
    window.addEventListener("beforeunload", releaseSession);
    return () => {
      window.removeEventListener("beforeunload", releaseSession);
    };
  }, [tokenCode, getFingerprint]);

  useEffect(() => {
    if (!tokenCode || !tokenData?.id || blocked) return;
    const fpVal = getFingerprint();
    let consecutiveDeviceLimitErrors = 0;
    const MAX_DEVICE_LIMIT_TOLERANCE = 3;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const { data } = await supabase.rpc("create_token_session", {
            _token_code: tokenCode,
            _fingerprint: fpVal,
            _user_agent: navigator.userAgent,
          });
          const result = data as any;
          if (!result?.success) {
            const errorText = String(result?.error || "").toLowerCase();
            if (errorText.includes("diblokir")) {
              setBlocked(true);
              return;
            }
            if (errorText === "device_limit") {
              consecutiveDeviceLimitErrors++;
              // Auto-reset if within tolerance (covers refresh race conditions)
              if (consecutiveDeviceLimitErrors <= MAX_DEVICE_LIMIT_TOLERANCE) {
                console.warn(`[Session] device_limit hit ${consecutiveDeviceLimitErrors}/${MAX_DEVICE_LIMIT_TOLERANCE}, attempting self-reset...`);
                try {
                  await supabase.rpc("self_reset_token_session" as any, { _token_code: tokenCode, _fingerprint: fpVal });
                } catch {}
                return;
              }
              // Beyond tolerance, show error
              setError("device_limit");
              return;
            }
            // Other errors: don't kick, just log
            return;
          }
          consecutiveDeviceLimitErrors = 0;
        } catch {
          // Transient network errors — never kick the user
        }
      })();
    }, 180_000); // 180s interval for reduced DB load at scale
    return () => window.clearInterval(interval);
  }, [tokenCode, tokenData?.id, getFingerprint, blocked]);

  // Refresh playlists (used on initial load and when admin goes live)
  const refreshPlaylists = useCallback(async () => {
    try {
      const { data } = await (supabase.rpc as any)("get_safe_playlists");
      if (data?.length) {
        const sorted = sortPlaylists(data);
        setPlaylists(sorted);
        setActivePlaylist((prev: any) => {
          if (!prev || !sorted.find((p: any) => p.id === prev.id)) return sorted[0];
          return prev;
        });
      }
    } catch {}
  }, []);

  // Consolidated realtime channel: streams + site_settings + shows + tokens
  useEffect(() => {
    const ch = supabase.channel("live-combined-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "streams" }, (p: any) => {
        if (p.new) {
          const wasLive = stream?.is_live;
          setStream(p.new);
          // When admin turns live ON, refresh playlists to ensure we have them
          if (!wasLive && p.new.is_live) {
            refreshPlaylists();
          }
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "site_settings" }, (p: any) => {
        if (p.new?.key === "player_animation") {
          setPlayerAnimation((p.new.value || "none") as AnimationType);
        }
      });

    // Only add show/token filters if we have token data
    if (tokenData?.show_id) {
      ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "shows", filter: `id=eq.${tokenData.show_id}` }, (p: any) => {
        if (p.new?.is_replay === true) setShowReplayBlocked(true);
      });
    }
    if (tokenData?.id) {
      ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "tokens", filter: `id=eq.${tokenData.id}` }, (p: any) => {
        if (p.new.status === "blocked") setBlocked(true);
      });
    }

    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tokenData?.show_id, tokenData?.id, refreshPlaylists]);

  // Blocked status is handled via realtime subscription on tokens table (line ~393)
  // No polling needed — saves ~60,000 req/hr at 1000 users

  useEffect(() => {
    if (!nextShowTime || stream?.is_live) { setCountdown(""); return; }
    const target = new Date(nextShowTime).getTime();
    const update = () => { const d = target - Date.now(); if (d <= 0) { setCountdown(""); return; } setCountdown(`${Math.floor(d/3600000).toString().padStart(2,"0")}:${Math.floor((d%3600000)/60000).toString().padStart(2,"0")}:${Math.floor((d%60000)/1000).toString().padStart(2,"0")}`); };
    update(); const i = setInterval(update, 1000); return () => clearInterval(i);
  }, [nextShowTime, stream?.is_live]);

  useEffect(() => { const h = (e: MouseEvent) => { if ((e.target as HTMLElement).closest(".player-area")) e.preventDefault(); }; document.addEventListener("contextmenu", h); return () => document.removeEventListener("contextmenu", h); }, []);

  const handleUsernameSet = async (name: string) => { setUsername(name); localStorage.setItem("rt48_username", name); setShowUsernameModal(false); const { data: { session } } = await supabase.auth.getSession(); if (session?.user) await supabase.from("profiles").upsert({ id: session.user.id, username: name }, { onConflict: "id" }); };

  const handlePlaylistSwitch = useCallback((newPlaylist: any) => {
    if (activePlaylist?.id === newPlaylist.id) return;
    playerRef.current?.pause();
    setActivePlaylist(newPlaylist);
  }, [activePlaylist?.id]);

  // === RENDER SECTION (after all hooks) ===

  if (loading) return (<div className="flex min-h-screen items-center justify-center bg-background"><div className="text-center"><div className="mx-auto mb-4 h-16 w-16 rounded-full overflow-hidden shadow-[0_0_16px_hsl(var(--primary)/0.4)] animate-float"><img src={logo} alt="RT48" className="h-full w-full object-cover" /></div><p className="text-muted-foreground">Memvalidasi akses...</p></div></div>);

  if (blocked) return (
    <div className="flex min-h-screen items-center justify-center bg-destructive/5 px-4">
      <div className="w-full max-w-lg rounded-2xl border-2 border-destructive bg-card p-8 text-center shadow-[0_0_40px_hsl(var(--destructive)/0.3)]">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-destructive/10 animate-pulse">
          <span className="text-5xl">🚫</span>
        </div>
        <h1 className="mb-4 text-3xl sm:text-4xl font-black text-destructive uppercase tracking-tight leading-tight animate-pulse">
          DILARANG RESTREAM YA DEECK !!!!!
        </h1>
        <div className="mb-4 rounded-xl bg-destructive/10 border border-destructive/20 p-4">
          <h2 className="text-lg font-bold text-destructive mb-1">🔒 TOKEN DIBLOKIR</h2>
          <p className="text-sm text-muted-foreground">
            Token kamu telah diblokir oleh admin karena terdeteksi pelanggaran. Akses streaming tidak tersedia.
          </p>
        </div>
        <p className="text-xs text-muted-foreground mb-6">
          Jika kamu merasa ini adalah kesalahan, hubungi admin untuk konfirmasi.
        </p>
        <div className="flex flex-col gap-3">
          {whatsappNumber && (
            <a
              href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent("Halo admin, token saya diblokir tetapi saya tidak melakukan pelanggaran. Mohon konfirmasi.\n\nToken: " + tokenCode)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[hsl(var(--success))] px-8 py-3 font-semibold text-primary-foreground hover:bg-[hsl(var(--success))]/90 active:scale-[0.97] transition-transform"
            >
              💬 Hubungi Admin via WhatsApp
            </a>
          )}
          <button onClick={() => navigate("/")} className="rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-transform">
            🏠 Kembali ke Beranda
          </button>
        </div>
      </div>
    </div>
  );

  if (showReplayBlocked) return (<div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="w-full max-w-md rounded-2xl border border-accent/30 bg-card p-8 text-center"><div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-accent/10"><span className="text-4xl">🎬</span></div><h2 className="mb-2 text-xl font-bold text-foreground">Show Telah Berakhir</h2><p className="text-sm text-muted-foreground mb-4">Show ini telah dijadikan replay. Akses streaming langsung tidak tersedia lagi.</p><p className="text-xs text-muted-foreground mb-6">Kamu bisa menonton replay dengan menukarkan koin di halaman utama.</p><button onClick={() => navigate("/")} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90">🏠 Ke Beranda</button></div></div>);

  if (error === "device_limit") return (<DeviceLimitScreen tokenCode={tokenCode} getFingerprint={getFingerprint} navigate={navigate} />);

  if (error === "no_token") return (<div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center"><div className="mx-auto mb-4 h-16 w-16 rounded-full overflow-hidden animate-float"><img src={logo} alt="RT48" className="h-full w-full object-cover" /></div><h2 className="mb-2 text-xl font-bold text-foreground">Akses Streaming</h2><p className="mb-6 text-muted-foreground">{purchaseMessage || "Beli token untuk mengakses streaming."}</p>{whatsappNumber && <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--success))] px-6 py-3 font-semibold text-primary-foreground">💬 Hubungi WhatsApp</a>}<div className="mt-4"><a href="/" className="text-sm text-primary hover:underline">← Kembali</a></div></div></div>);

  if (error) return (<div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="rounded-xl border border-destructive/30 bg-card p-8 text-center"><h2 className="mb-2 text-xl font-bold text-destructive">Akses Ditolak</h2><p className="text-muted-foreground">{error}</p><div className="mt-4"><a href="/" className="text-sm text-primary hover:underline">← Kembali</a></div></div></div>);

  const isLive = stream?.is_live || false;

  if (showMismatch) {
    let mismatchInfo = { tokenShowTitle: "Show Lain", tokenShowDate: "", tokenShowTime: "", activeShowTitle: "Show Lain" };
    try { mismatchInfo = JSON.parse(mismatchShowTitle); } catch {}
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--warning))]/30 bg-card p-8 text-center shadow-lg">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[hsl(var(--warning))]/10">
            <span className="text-4xl">🎫</span>
          </div>
          <h2 className="mb-3 text-xl font-bold text-foreground">Token Kamu Berbeda</h2>
          <div className="mb-4 rounded-xl bg-[hsl(var(--warning))]/5 border border-[hsl(var(--warning))]/20 p-4 space-y-2">
            <p className="text-sm font-semibold text-foreground">
              Token kamu adalah untuk show:
            </p>
            <p className="text-lg font-bold text-primary">
              🎭 {mismatchInfo.tokenShowTitle}
            </p>
            {mismatchInfo.tokenShowDate && (
              <p className="text-sm text-muted-foreground">
                📅 {mismatchInfo.tokenShowDate} {mismatchInfo.tokenShowTime ? `• 🕐 ${mismatchInfo.tokenShowTime}` : ""}
              </p>
            )}
          </div>
          <div className="mb-4 rounded-lg bg-secondary p-3">
            <p className="text-xs text-muted-foreground mb-1">Show yang sedang live saat ini:</p>
            <p className="text-sm font-semibold text-foreground">🔴 {mismatchInfo.activeShowTitle}</p>
          </div>
          <p className="text-xs text-muted-foreground mb-6">
            Kembali lagi untuk menonton live show-mu sesuai tanggalnya. Token hanya berlaku untuk show yang kamu beli.
          </p>
          <div className="flex flex-col gap-3">
            <button onClick={() => navigate("/schedule")} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-transform">📅 Lihat Jadwal Show</button>
            <button onClick={() => navigate("/")} className="rounded-full bg-secondary px-6 py-3 font-semibold text-secondary-foreground hover:bg-secondary/80 active:scale-[0.97] transition-transform">🏠 Kembali ke Beranda</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background lg:flex-row">
      <ConnectionStatus />
      <ViewerBroadcast />
      <SecurityAlert />
      {playerAnimation !== "none" && <Suspense fallback={null}><PlayerAnimations type={playerAnimation} backgroundOnly /></Suspense>}
      {showUsernameModal && <Suspense fallback={null}><UsernameModal onSubmit={handleUsernameSet} /></Suspense>}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <img src={logo} alt="RT48" className="h-8 w-8 rounded-full object-cover" />
          <div className="flex-1 min-w-0"><h1 className="text-sm font-bold text-foreground lg:text-base truncate">{stream?.title || "RealTime48"}</h1></div>
          
          <LiveViewerCount isLive={isLive} />
          {isLive ? <span className="flex items-center gap-1.5 rounded-full bg-destructive/20 px-3 py-1 text-xs font-semibold text-destructive"><span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />LIVE</span> : <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">OFFLINE</span>}
          
          <Sheet>
            <SheetTrigger asChild>
              <button className="rounded-lg bg-secondary p-2 text-secondary-foreground transition hover:bg-secondary/80 active:scale-[0.95]">
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 border-border bg-card p-0">
              <SheetHeader className="px-6 pt-6 pb-4">
                <SheetTitle className="flex items-center gap-2 text-foreground">
                  <img src={logo} alt="RT48" className="h-7 w-7 rounded-full border border-border/60 object-cover" />
                  RealTime48
                </SheetTitle>
              </SheetHeader>
              <div className="px-6 pb-6 space-y-2">
                {whatsappNumber && (
                  <a
                    href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent("Halo admin")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-4 text-left transition hover:border-[hsl(var(--success))]/40 hover:bg-[hsl(var(--success))]/5"
                  >
                    <Phone className="h-5 w-5 text-[hsl(var(--success))]" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Hubungi Admin</p>
                      <p className="text-xs text-muted-foreground">Chat via WhatsApp</p>
                    </div>
                  </a>
                )}
                <a
                  href="/"
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-4 text-left transition hover:border-primary/30 hover:bg-primary/5"
                >
                  <Home className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Beranda</p>
                    <p className="text-xs text-muted-foreground">Kembali ke halaman utama</p>
                  </div>
                </a>
              </div>
            </SheetContent>
          </Sheet>
        </header>
        <div className="player-area relative z-10">
          {/* Membership badge overlay on player */}
          {tokenData?.code?.startsWith("MBR-") && tokenData?.expires_at && (() => {
            const expiresAt = new Date(tokenData.expires_at);
            const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
            return (
              <div className="absolute top-2 left-2 z-30 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-yellow-500/40 px-2.5 py-1">
                <span className="text-xs">👑</span>
                <span className="text-[10px] font-semibold text-yellow-400">{daysLeft}d</span>
              </div>
            );
          })()}
          {/* PiP button overlay on player */}
          <div className="absolute top-2 right-2 z-30">
            <PipButton />
          </div>
          {isLive && activePlaylist ? (
            <div className="relative">
              {effectiveStreamUrl ? (
                <Suspense fallback={<div className="flex aspect-video w-full items-center justify-center bg-card"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
                  <VideoPlayer
                    ref={playerRef}
                    key={activePlaylist.id}
                    playlist={{ url: effectiveStreamUrl, type: effectiveType, label: activePlaylist.title }}
                    autoPlay
                    tokenCode={tokenData?.code}
                    customHeaders={effectiveHeaders}
                  />
                </Suspense>
              ) : effectiveStreamLoading ? (
                <div className="flex aspect-video w-full items-center justify-center bg-card">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-8 w-8 animate-spin rounded-full border-3 border-primary border-t-transparent" />
                    <p className="text-sm text-muted-foreground animate-pulse">Memuat stream...</p>
                  </div>
                </div>
              ) : (
                <div className="flex aspect-video w-full items-center justify-center bg-card">
                  <p className="text-sm text-destructive">Gagal memuat stream. Coba refresh.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="relative flex aspect-video w-full flex-col items-center justify-center bg-card">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full overflow-hidden opacity-30"><img src={logo} alt="RT48" className="h-full w-full object-cover" /></div>
              {countdown ? <div className="text-center"><p className="text-sm text-muted-foreground">Show dimulai dalam</p><p className="mt-2 font-mono text-4xl font-bold text-primary">{countdown}</p></div> : <div className="text-center"><p className="font-mono text-2xl font-bold text-destructive tracking-widest">STREAMING OFFLINE</p><p className="mt-2 text-sm text-muted-foreground">Tidak ada jadwal saat ini</p></div>}
            </div>
          )}
        </div>
        {isLive && playlists.length > 1 && (
          <div className="border-t border-border px-3 py-1.5">
            <PlaylistSwitcher
              playlists={playlists}
              activePlaylistId={activePlaylist?.id ?? null}
              onSelect={handlePlaylistSwitch}
            />
          </div>
        )}
        <Suspense fallback={null}>
          <LineupAvatars />
        </Suspense>
        <div className="border-t border-border px-4 py-2"><h2 className="text-sm font-bold text-foreground">{stream?.title || "RealTime48"}</h2></div>
      </div>
      <div className="h-[50vh] border-t border-border lg:h-screen lg:sticky lg:top-0 lg:w-80 lg:border-l lg:border-t-0 xl:w-96 flex flex-col relative">
        <div className="absolute top-0 left-0 right-0 z-10">
          <Suspense fallback={null}>
            <LivePoll voterId={tokenData?.id || username || "anon"} />
          </Suspense>
        </div>
        <div className="flex-1 min-h-0">
          <Suspense fallback={<div className="flex h-full items-center justify-center"><p className="text-xs text-muted-foreground">Memuat chat...</p></div>}>
            <LiveChat username={username} tokenId={tokenData?.id} isLive={isLive} isAdmin={false} />
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default LivePage;
