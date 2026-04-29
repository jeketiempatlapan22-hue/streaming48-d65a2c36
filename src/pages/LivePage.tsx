import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
import { Menu, X, MessageCircle, Home, Phone, Lock, RotateCcw, Timer, Calendar, MessageSquare, AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";

import { useSignedStreamUrl } from "@/hooks/useSignedStreamUrl";
import { useProxyStream } from "@/hooks/useProxyStream";
import { withRetry, withTimeout } from "@/lib/queryCache";
import { createClientId, safeStorageGet, safeStorageSet, safeJsonParse } from "@/lib/clientId";
import { parseWIBDateTime, formatDateWIB, isUserOutsideWIB, getUserZoneLabel, formatLocal } from "@/lib/timeFormat";
import SectionBoundary from "@/components/SectionBoundary";
import LiveChatBoundary from "@/components/viewer/LiveChatBoundary";

const VideoPlayer = lazy(() => import("@/components/VideoPlayer"));
const LiveChat = lazy(() => import("@/components/viewer/LiveChat"));
const UsernameModal = lazy(() => import("@/components/viewer/UsernameModal"));
const LivePoll = lazy(() => import("@/components/viewer/LivePoll"));
const LineupAvatars = lazy(() => import("@/components/viewer/LineupAvatars"));
const PlayerAnimations = lazy(() => import("@/components/viewer/PlayerAnimations"));
const LiveQuizBanner = lazy(() => import("@/components/viewer/LiveQuizBanner"));
const LiveQuizSlot = lazy(() => import("@/components/viewer/LiveQuizSlot"));

const MAX_RESET_ATTEMPTS = 3;
const RESET_KEY_PREFIX = "rt48_reset_count_";

// Single flip digit (0-9) — animates whenever value changes
const FlipDigit = ({ digit }: { digit: string }) => (
  <span className="relative inline-block w-[0.62em] h-[1em] overflow-hidden align-baseline">
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={digit}
        initial={{ y: "-100%", opacity: 0, rotateX: -90 }}
        animate={{ y: "0%", opacity: 1, rotateX: 0 }}
        exit={{ y: "100%", opacity: 0, rotateX: 90 }}
        transition={{ duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
        className="absolute inset-0 flex items-center justify-center"
        style={{ transformOrigin: "center" }}
      >
        {digit}
      </motion.span>
    </AnimatePresence>
  </span>
);

// Two-digit flip group with subtle scale pulse on full change
const FlipNumber = ({ value }: { value: number }) => {
  const padded = value.toString().padStart(2, "0");
  return (
    <span className="inline-flex" style={{ perspective: 400 }}>
      <FlipDigit digit={padded[0]} />
      <FlipDigit digit={padded[1]} />
    </span>
  );
};

const getShowScheduleTimestamp = (show?: { schedule_date?: string | null; schedule_time?: string | null } | null) => {
  if (!show?.schedule_date) return null;
  return parseWIBDateTime(show.schedule_date, show.schedule_time || "23:59");
};

const resolveDisplayShow = (
  shows: any[] | undefined,
  activeShowId: string | null,
  _isLive: boolean
) => {
  const list = (shows || []).filter((show) => !show?.is_replay);
  // Admin's chosen active show ALWAYS wins — background, title, schedule must follow admin selection.
  if (activeShowId) {
    const adminPick = list.find((show) => show.id === activeShowId);
    if (adminPick) return adminPick;
  }
  // Only fall back to upcoming schedule when admin hasn't picked a show.
  const scheduled = list
    .map((show) => ({ show, ts: getShowScheduleTimestamp(show) }))
    .filter((entry): entry is { show: any; ts: number } => typeof entry.ts === "number" && !Number.isNaN(entry.ts))
    .sort((a, b) => a.ts - b.ts);
  return (
    scheduled.find((entry) => entry.ts >= Date.now())?.show ||
    scheduled[scheduled.length - 1]?.show ||
    null
  );
};

const fetchDisplayShow = async (activeShowId: string | null, isLive: boolean) => {
  // PRIORITAS 1: Kalau admin sudah pilih show, ambil LANGSUNG dari `shows` by id.
  // Ini bypass filter is_active/is_replay — admin yang pilih, admin yang tahu.
  if (activeShowId) {
    // Gunakan RPC SECURITY DEFINER agar non-admin (membership / regular) tetap dapat
    // membaca metadata show yang dipilih admin (RLS tabel `shows` block non-admin).
    const directRes = await withTimeout(
      (async () =>
        await supabase
          .rpc("get_active_show_minimal", { p_show_id: activeShowId })
          .maybeSingle())(),
      8_000,
      "Active show timeout"
    ).catch(() => null);

    if (directRes?.data) {
      // Tetap ambil daftar lengkap untuk validasi token (best-effort, tidak blocking)
      const showRes = await withTimeout(
        (async () => await supabase.rpc("get_public_shows"))(),
        6_000,
        "Shows timeout"
      ).catch(() => null);
      return { activeShow: directRes.data, allShows: showRes?.data as any[] | undefined };
    }
  }

  // PRIORITAS 2: Tidak ada pilihan admin → fallback ke jadwal terdekat dari shows publik.
  const showRes = await withTimeout(
    (async () => await supabase.rpc("get_public_shows"))(),
    8_000,
    "Shows timeout"
  ).catch(() => null);

  const allShows = showRes?.data as any[] | undefined;
  const resolvedShow = resolveDisplayShow(allShows, activeShowId, isLive);

  return { activeShow: resolvedShow, allShows };
};

const DeviceLimitScreen = ({ tokenCode, getFingerprint, navigate, maxDevices }: { tokenCode: string; getFingerprint: () => string; navigate: (path: string) => void; maxDevices?: number }) => {
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);
  // Single-device tokens: user boleh self-reset. Multi-device (>1): TIDAK boleh.
  const isMultiDevice = (maxDevices ?? 1) > 1;
  const canSelfReset = !isMultiDevice;

  // For multi-device: cek apakah ada show terjadwal untuk arahkan user
  const [hasUpcomingShow, setHasUpcomingShow] = useState<boolean | null>(null);
  const [waNumber, setWaNumber] = useState<string>("");

  useEffect(() => {
    if (!isMultiDevice) return;
    (async () => {
      try {
        const [showsRes, settingsRes] = await Promise.all([
          supabase.rpc("get_public_shows"),
          supabase.from("site_settings").select("key,value").eq("key", "whatsapp_number").maybeSingle(),
        ]);
        const shows = (showsRes.data as any[]) || [];
        const upcoming = shows.some((s) => {
          if (s.is_replay) return false;
          const ts = getShowScheduleTimestamp(s);
          return typeof ts === "number" && ts >= Date.now() - 6 * 60 * 60 * 1000; // tampilkan show yg masih hari ini
        });
        setHasUpcomingShow(upcoming);
        const wa = (settingsRes.data as any)?.value || "";
        setWaNumber(wa);
      } catch {
        setHasUpcomingShow(false);
      }
    })();
  }, [isMultiDevice]);

  // Track local reset attempts (per token, daily window)
  const storageKey = `${RESET_KEY_PREFIX}${tokenCode}`;
  const [resetCount, setResetCount] = useState<number>(() => {
    const raw = safeStorageGet(typeof window !== "undefined" ? window.localStorage : undefined, storageKey);
    const parsed = safeJsonParse<{ count?: number; day?: string }>(raw, {});
    const today = new Date().toDateString();
    return parsed?.day === today ? Number(parsed?.count) || 0 : 0;
  });
  const remaining = Math.max(0, MAX_RESET_ATTEMPTS - resetCount);

  const handleReset = async () => {
    if (remaining <= 0) {
      setResetError("Batas reset harian tercapai. Coba lagi besok atau hubungi admin.");
      return;
    }
    setResetting(true);
    setResetError("");
    try {
      const fp = getFingerprint();
      const { data } = await supabase.rpc("self_reset_token_session" as any, { _token_code: tokenCode, _fingerprint: fp });
      const result = data as any;
      if (result?.success) {
        const newCount = resetCount + 1;
        setResetCount(newCount);
        safeStorageSet(typeof window !== "undefined" ? window.localStorage : undefined, storageKey, JSON.stringify({ count: newCount, day: new Date().toDateString() }));
        try {
          const { data: tk } = await supabase.rpc("validate_token", { _code: tokenCode });
          const tid = (tk as any)?.id;
          if (tid) {
            const ch = supabase.channel(`token-reset-${tid}`);
            await ch.subscribe();
            await ch.send({ type: "broadcast", event: "force_logout", payload: { source: "self" } });
            setTimeout(() => supabase.removeChannel(ch), 1500);
          }
        } catch {}
        setResetSuccess(true);
        setTimeout(() => window.location.reload(), 900);
      } else {
        setResetError(result?.error || "Gagal reset sesi.");
      }
    } catch { setResetError("Terjadi kesalahan."); }
    setResetting(false);
  };

  // === MULTI-DEVICE TOKEN: tampilan "telah penuh" tanpa tombol reset ===
  if (isMultiDevice) {
    const waLink = waNumber
      ? `https://wa.me/${waNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
          `Halo admin, token saya (${tokenCode}) sudah penuh. Mohon bantuan untuk reset.`
        )}`
      : "";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-md rounded-3xl border border-border/60 bg-card/90 backdrop-blur-xl p-6 sm:p-7 shadow-2xl shadow-primary/5">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-destructive/20 to-destructive/5 border border-destructive/30">
            <Lock className="h-9 w-9 text-destructive" strokeWidth={2.4} />
          </div>

          <h2 className="mb-2 text-center text-2xl font-bold text-foreground">Token Telah Penuh</h2>
          <p className="mb-2 text-center text-sm leading-relaxed text-muted-foreground">
            Kuota perangkat untuk token ini sudah tercapai
            {typeof maxDevices === "number" ? ` (${maxDevices} perangkat)` : ""}.
          </p>
          <p className="mb-6 text-center text-sm leading-relaxed text-muted-foreground">
            Silakan beli token baru di website kami untuk melanjutkan menonton.
          </p>

          <div className="space-y-2.5">
            {hasUpcomingShow === null ? (
              <div className="flex items-center justify-center py-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : hasUpcomingShow ? (
              <button
                onClick={() => navigate("/schedule")}
                className="group relative w-full overflow-hidden rounded-2xl bg-primary px-6 py-3.5 font-bold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
              >
                <span className="relative z-10 inline-flex items-center justify-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Lihat Jadwal Show
                </span>
              </button>
            ) : waLink ? (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-[hsl(var(--success))] px-6 py-3.5 font-bold text-primary-foreground shadow-lg shadow-[hsl(var(--success))]/30 transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
              >
                <MessageSquare className="h-4 w-4" />
                Hubungi Admin via WhatsApp
              </a>
            ) : (
              <p className="text-center text-xs text-muted-foreground italic">
                Belum ada jadwal show. Silakan cek website kami nanti.
              </p>
            )}

            <button
              onClick={() => navigate("/")}
              className="w-full rounded-2xl border border-border bg-secondary/40 px-6 py-3 text-sm font-medium text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground active:scale-[0.98]"
            >
              Kembali ke Beranda
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === SINGLE-DEVICE TOKEN: bisa self-reset (UI lama) ===
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-3xl border border-border/60 bg-card/90 backdrop-blur-xl p-6 sm:p-7 shadow-2xl shadow-primary/5">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 shadow-[0_0_30px_hsl(var(--primary)/0.25)]">
          <Lock className="h-9 w-9 text-primary" strokeWidth={2.4} />
        </div>

        <h2 className="mb-2 text-center text-2xl font-bold text-foreground">Link Sudah Digunakan</h2>
        <p className="mb-6 text-center text-sm leading-relaxed text-muted-foreground">
          Link ini sudah digunakan di perangkat lain.<br />
          Silahkan reset link ini untuk menggunakan di perangkat ini.
        </p>

        {resetSuccess ? (
          <div className="rounded-2xl border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 p-5 text-center">
            <p className="text-sm font-semibold text-[hsl(var(--success))]">✅ Sesi direset! Memuat ulang...</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-border/60 bg-background/40 p-5 mb-3">
              <p className="text-center text-sm text-muted-foreground mb-3">
                Sisa kesempatan reset:{" "}
                <span className="font-bold text-primary">{remaining}x</span>{" "}
                <span className="text-xs">dari {MAX_RESET_ATTEMPTS}x</span>
              </p>

              <div className="mb-5 flex items-center justify-center gap-2">
                {Array.from({ length: MAX_RESET_ATTEMPTS }).map((_, i) => {
                  const filled = i < remaining;
                  return (
                    <span
                      key={i}
                      className={`h-2 w-12 rounded-full transition-all ${
                        filled
                          ? "bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.6)]"
                          : "bg-muted"
                      }`}
                    />
                  );
                })}
              </div>

              <button
                onClick={handleReset}
                disabled={resetting || remaining <= 0}
                className="group relative w-full overflow-hidden rounded-2xl bg-primary px-6 py-3.5 font-bold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                <span className="relative z-10 inline-flex items-center justify-center gap-2">
                  <RotateCcw className={`h-4 w-4 ${resetting ? "animate-spin" : ""}`} />
                  {resetting ? "Mereset..." : "Reset ke Perangkat Ini"}
                </span>
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              </button>
            </div>

            {resetError && (
              <p className="mb-3 text-center text-sm text-destructive">{resetError}</p>
            )}

            <button
              onClick={() => navigate("/")}
              className="w-full rounded-2xl border border-border bg-secondary/40 px-6 py-3 text-sm font-medium text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground active:scale-[0.98]"
            >
              Kembali ke Beranda
            </button>
          </>
        )}
      </div>
    </div>
  );
};
// Playlists are now sorted by admin-defined sort_order from DB
// No client-side reordering needed

const LivePage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tokenCode = searchParams.get("t") || "";
  const [tokenData, setTokenData] = useState<any>(null);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [forcedOut, setForcedOut] = useState(false);
  const [membershipPaused, setMembershipPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [stream, setStream] = useState<any>(null);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<any>(null);
  const [username, setUsername] = useState(() => safeStorageGet(typeof window !== "undefined" ? window.localStorage : undefined, "rt48_username") || "");
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappChannel, setWhatsappChannel] = useState("");
  const [whatsappChannelEnabled, setWhatsappChannelEnabled] = useState(false);
  const [countdown, setCountdown] = useState<{ d: number; h: number; m: number; s: number } | null>(null);
  const [nextShowTime, setNextShowTime] = useState("");
  const [playerAnimation, setPlayerAnimation] = useState<AnimationType>("none");
  const [showMismatch, setShowMismatch] = useState(false);
  const [mismatchShowTitle, setMismatchShowTitle] = useState("");
  const [tokenNotStarted, setTokenNotStarted] = useState<null | {
    startsAt: string;
    showTitle: string;
    showDate: string;
    showTime: string;
  }>(null);
  const [showReplayBlocked, setShowReplayBlocked] = useState(false);
  const [externalShowId, setExternalShowId] = useState<string | null>(null);
  const [activeShowTeam, setActiveShowTeam] = useState<string | null>(null);
  const [activeShowTitle, setActiveShowTitle] = useState<string | null>(null);
  const [activeShowImage, setActiveShowImage] = useState<string | null>(null);
  const [activeShowDate, setActiveShowDate] = useState<string | null>(null);
  const [activeShowTime, setActiveShowTime] = useState<string | null>(null);
  const [offlineBackgroundOverride, setOfflineBackgroundOverride] = useState<string | null>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);

  const getFingerprint = useCallback(() => {
    let fp = safeStorageGet(typeof window !== "undefined" ? window.localStorage : undefined, "rt48_fp");
    if (!fp) {
      fp = createClientId("fp");
      safeStorageSet(typeof window !== "undefined" ? window.localStorage : undefined, "rt48_fp", fp);
    }
    return fp;
  }, []);

  const fp = getFingerprint();

  const isProxyPlaylist = activePlaylist?.type === "proxy";
  const isDirectPlaylist = activePlaylist?.type === "direct";

  // For m3u8/youtube: use signed stream URL via edge function (skip for direct & proxy)
  const { signedUrl, loading: signedLoading, proxyType } = useSignedStreamUrl(
    !isProxyPlaylist && !isDirectPlaylist && activePlaylist ? { id: activePlaylist.id, type: activePlaylist.type, url: activePlaylist.url } : null,
    tokenCode,
    fp
  );

  // For proxy: call hanabira48 API directly (domain whitelisted, no CORS)
  const { playbackUrl: proxyUrl, customHeadersRef: proxyHeadersRef, loading: proxyLoading } = useProxyStream(
    isProxyPlaylist && !loading && !error && !showMismatch && !showReplayBlocked && !blocked,
    externalShowId
  );

  // Unified URL, loading, and type for VideoPlayer
  const effectiveStreamUrl = isDirectPlaylist
    ? activePlaylist?.url
    : isProxyPlaylist ? proxyUrl : signedUrl;
  const effectiveStreamLoading = isDirectPlaylist ? false : (isProxyPlaylist ? proxyLoading : signedLoading);
  const effectiveType = (isDirectPlaylist || isProxyPlaylist) ? "m3u8" : (proxyType || activePlaylist?.type || "m3u8");
  const effectiveHeadersRef = isProxyPlaylist ? proxyHeadersRef : undefined;

  const applyActiveShowMetadata = useCallback((show: any | null) => {
    setExternalShowId(show?.external_show_id || null);
    setActiveShowTeam(show?.team || null);
    setActiveShowTitle(show?.title || null);
    setActiveShowImage(show?.background_image_url || null);
    setActiveShowDate(show?.schedule_date || null);
    setActiveShowTime(show?.schedule_time || null);
  }, []);

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

  const syncPlaylists = useCallback((nextPlaylists: any[]) => {
    // Filter out inactive playlists client-side as safety net
    const activePlaylists = nextPlaylists.filter((p: any) => p.is_active !== false);
    setPlaylists(activePlaylists);
    setActivePlaylist((prev: any) => {
      if (!activePlaylists.length) return null;
      if (!prev) return activePlaylists[0];
      return activePlaylists.find((item: any) => item.id === prev.id) || activePlaylists[0];
    });
  }, []);

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
            safeStorageSet(typeof window !== "undefined" ? window.localStorage : undefined, "rt48_username", profileRes.data.username);
            return;
          }
          setShowUsernameModal(true);
          return;
        }

        const stored = safeStorageGet(typeof window !== "undefined" ? window.localStorage : undefined, "rt48_username");
        if (!stored) setShowUsernameModal(true);
      } catch {
        const stored = safeStorageGet(typeof window !== "undefined" ? window.localStorage : undefined, "rt48_username");
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
          async () => await (supabase.rpc as any)("validate_active_live_token", { _code: tokenCode }),
          10_000,
          1
        );

        const result = validationResult.data as any;
        if (validationResult.error || !result?.valid) {
          const errText = String(result?.error || validationResult.error?.message || "").toLowerCase();
          if (result?.membership_paused === true || errText.includes("dijeda")) { setMembershipPaused(true); return; }
          if (errText.includes("diblokir")) { setBlocked(true); return; }

          // Token belum aktif (jadwal show belum tiba)
          if (result?.token_not_started === true && result?.starts_at) {
            const sTitle = result?.token_show_title || "Show Kamu";
            const sDate = result?.token_show_date || "";
            const sTime = result?.token_show_time || "";
            setTokenNotStarted({
              startsAt: result.starts_at,
              showTitle: sTitle,
              showDate: sDate,
              showTime: sTime,
            });
            toast.error("Token belum aktif", {
              description: `Token kamu untuk "${sTitle}" baru aktif ${sDate} ${sTime}.`,
              duration: 8000,
            });
            setLoading(false);
            return;
          }

          // Token milik show lain — server sudah memvalidasi & memblokir.
          // Tampilkan layar "Show Mismatch" agar user paham token tidak berlaku.
          if (result?.show_mismatch === true) {
            const tTitle = result?.token_show_title || "Show Lain";
            const aTitle = result?.active_show_title || "Show Lain";
            setShowMismatch(true);
            setMismatchShowTitle(JSON.stringify({
              tokenShowTitle: tTitle,
              tokenShowDate: "",
              tokenShowTime: "",
              activeShowTitle: aTitle,
            }));
            toast.error("Token tidak sesuai jadwal", {
              description: `Token kamu untuk "${tTitle}", tapi yang sedang live adalah "${aTitle}".`,
              duration: 8000,
            });
            setLoading(false);
            return;
          }

          // Token mungkin sudah dipindah ke replay (show is_replay = true).
          // Coba validate_replay_access; jika berhasil → redirect ke pemain replay internal.
          try {
            const { data: replayData } = await supabase.rpc("validate_replay_access" as any, { _token: tokenCode });
            if ((replayData as any)?.success) {
              setRedirecting(true);
              // Use replace to prevent back navigation to broken state
              try { window.location.replace(`/replay-play?token=${encodeURIComponent(tokenCode)}`); } catch {}
              return;
            }
          } catch { /* abaikan, lanjut tampilkan error normal */ }

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

        const [streamRes, playlistRes, settingsRes] = await Promise.allSettled([
          withTimeout((async () => await (supabase.rpc as any)("get_stream_status"))(), 8_000, "Stream timeout"),
          withTimeout((async () => await (supabase.rpc as any)("get_safe_playlists"))(), 8_000, "Playlist timeout"),
          withTimeout((async () => await supabase.from("site_settings").select("*"))(), 8_000, "Settings timeout"),
        ]);

        if (streamRes.status === "fulfilled" && streamRes.value.data?.length) setStream(streamRes.value.data[0]);
        if (playlistRes.status === "fulfilled") {
          syncPlaylists(playlistRes.value.data || []);
        }

        let activeShowId = "";
        const settingsData = settingsRes.status === "fulfilled" ? settingsRes.value.data : null;
        if (settingsData) {
          settingsData.forEach((s: any) => {
            if (s.key === "next_show_time") setNextShowTime(s.value);
            if (s.key === "whatsapp_number") setWhatsappNumber(s.value);
            if (s.key === "whatsapp_channel") setWhatsappChannel(s.value || "");
            if (s.key === "whatsapp_channel_enabled") setWhatsappChannelEnabled(s.value === "true");
            if (s.key === "player_animation") setPlayerAnimation((s.value || "none") as AnimationType);
            if (s.key === "active_show_id") activeShowId = s.value;
            if (s.key === "offline_background_url") setOfflineBackgroundOverride(s.value || null);
          });
        }

        const { activeShow, allShows } = await fetchDisplayShow(
          activeShowId || null,
          Boolean(streamRes.status === "fulfilled" && streamRes.value.data?.[0]?.is_live)
        );

        const tokenShowFallbackRes =
          result.show_id && !allShows?.some((s: any) => s.id === result.show_id)
            ? await withTimeout(
                (async () =>
                  await supabase
                    .from("shows")
                    .select("id, title, schedule_date, schedule_time, is_subscription, is_bundle, bundle_duration_days")
                    .eq("id", result.show_id)
                    .maybeSingle())(),
                8_000,
                "Token show timeout"
              ).catch(() => null)
            : null;

        const tokenShow = allShows?.find((s: any) => s.id === result.show_id) || tokenShowFallbackRes?.data || null;
        const normalizedTokenCode = String(result.code || "").toUpperCase();
        const isMembershipToken =
          Boolean(tokenShow?.is_subscription) ||
          normalizedTokenCode.startsWith("MBR-") ||
          normalizedTokenCode.startsWith("MRD-");
        // Bundle tokens: detect by validate_token response, show flag, OR code prefix
        const isBundleToken = Boolean(result.is_bundle) || Boolean(tokenShow?.is_bundle) || normalizedTokenCode.startsWith("BDL-");
        // Custom tokens (RT48-) created via bot command - universal access
        const isCustomToken = normalizedTokenCode.startsWith("RT48-");

        // Tampilkan metadata show: prioritas show pilihan admin (active_show_id),
        // fallback ke show milik token agar countdown/judul/jadwal tetap muncul
        // untuk user membership/custom/bundle saat admin belum memilih show aktif.
        const displayShow = activeShow || tokenShow;
        applyActiveShowMetadata(displayShow);
        // Lengkapi jadwal jika activeShow tidak punya schedule tapi tokenShow punya
        if (activeShow && tokenShow) {
          if (!activeShow.schedule_date && tokenShow.schedule_date) {
            setActiveShowDate(tokenShow.schedule_date);
          }
          if (!activeShow.schedule_time && tokenShow.schedule_time) {
            setActiveShowTime(tokenShow.schedule_time);
          }
        }

        setTokenData({
          id: result.id,
          code: result.code,
          show_id: result.show_id,
          expires_at: result.expires_at,
          created_at: result.created_at,
          is_membership: isMembershipToken,
          is_bundle: isBundleToken,
          is_custom: isCustomToken,
        });

        if (result.show_id && activeShowId && result.show_id !== activeShowId && !isMembershipToken && !isBundleToken && !isCustomToken) {
          // HARD-BLOCK: Token milik show lain tidak boleh masuk ke show yang sedang live.
          // Token reseller/regular hanya berlaku untuk show yang dibuat berdasarkan jadwalnya.
          const tTitle = tokenShow?.title || "Show Lain";
          const aTitle = activeShow?.title || "Show Lain";
          setShowMismatch(true);
          setMismatchShowTitle(JSON.stringify({
            tokenShowTitle: tTitle,
            tokenShowDate: tokenShow?.schedule_date || "",
            tokenShowTime: tokenShow?.schedule_time || "",
            activeShowTitle: aTitle,
          }));
          toast.error("Token tidak sesuai jadwal", {
            description: `Token kamu untuk "${tTitle}", tapi yang sedang live adalah "${aTitle}".`,
            duration: 8000,
          });
        } else {
          setShowMismatch(false);
          setMismatchShowTitle("");
        }
      } catch {
        setError("Server sedang sibuk, coba muat ulang halaman.");
      } finally {
        setLoading(false);
      }
    };
    validate();
  }, [tokenCode, getFingerprint, syncPlaylists]);

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
          const { data: accessData, error: accessErr } = await (supabase.rpc as any)("validate_active_live_token", { _code: tokenCode });
          const accessResult = accessData as any;
          if (accessErr || !accessResult?.valid) {
            setError(accessResult?.error || "Akses live tidak valid untuk show aktif.");
            return;
          }

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
              const isMulti = (tokenData?.max_devices ?? 1) > 1;
              consecutiveDeviceLimitErrors++;
              // Single-device tokens: auto self-reset (covers refresh race conditions)
              // Multi-device tokens: NEVER auto-reset — user harus beli ulang.
              if (!isMulti && consecutiveDeviceLimitErrors <= MAX_DEVICE_LIMIT_TOLERANCE) {
                console.warn(`[Session] device_limit hit ${consecutiveDeviceLimitErrors}/${MAX_DEVICE_LIMIT_TOLERANCE}, attempting self-reset...`);
                try {
                  await supabase.rpc("self_reset_token_session" as any, { _token_code: tokenCode, _fingerprint: fpVal });
                } catch {}
                return;
              }
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

  // Refresh playlists + externalShowId (used on polling and when admin goes live)
  const refreshPlaylists = useCallback(async () => {
    try {
      const [playlistRes, settingsRes] = await Promise.allSettled([
        (supabase.rpc as any)("get_safe_playlists"),
        supabase.from("site_settings").select("value").eq("key", "active_show_id").maybeSingle(),
      ]);
      if (playlistRes.status === "fulfilled") {
        syncPlaylists(playlistRes.value.data || []);
      }
      // Also refresh externalShowId so proxy player can reconnect
      const showId = settingsRes.status === "fulfilled" ? settingsRes.value.data?.value ?? null : null;
      const { data: streamData } = await (supabase.rpc as any)("get_stream_status");
      const { activeShow } = await fetchDisplayShow(showId, Boolean(streamData?.[0]?.is_live));
      applyActiveShowMetadata(activeShow);
      if (tokenCode) {
        const { data: accessData, error: accessErr } = await (supabase.rpc as any)("validate_active_live_token", { _code: tokenCode });
        const accessResult = accessData as any;
        if (accessErr || !accessResult?.valid) {
          setError(accessResult?.error || "Akses live tidak valid untuk show aktif.");
        }
      }
    } catch {}
  }, [applyActiveShowMetadata, syncPlaylists, tokenCode]);

  // Consolidated realtime channel: streams + site_settings + shows + tokens
  useEffect(() => {
    const ch = supabase.channel("live-combined-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "streams" }, (p: any) => {
        if (p.new) {
          // Auto-switch to live: update stream state immediately so player flips from countdown → video.
          setStream(p.new);
          // Refresh playlists & active show metadata so the player picks up admin's latest config.
          refreshPlaylists();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "playlists" }, () => {
        // Admin added/edited/removed a playlist while live — pick it up immediately.
        refreshPlaylists();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "site_settings" }, (p: any) => {
        if (p.new?.key === "player_animation") {
          setPlayerAnimation((p.new.value || "none") as AnimationType);
        }
        if (p.new?.key === "next_show_time") {
          setNextShowTime(p.new.value || "");
        }
        if (p.new?.key === "active_show_id") {
          // Refresh active show metadata (image, schedule, etc.)
          refreshPlaylists();
        }
        if (p.new?.key === "offline_background_url") {
          setOfflineBackgroundOverride(p.new.value || null);
        }
        // Also refresh playlists when any setting changes (admin may have toggled playlist)
        if (p.new?.key === "playlist_version") {
          refreshPlaylists();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shows" }, () => {
        refreshPlaylists();
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

  // Force-logout broadcast: admin or another device reset this token's sessions
  // → terminate playback immediately on this device.
  useEffect(() => {
    if (!tokenData?.id) return;
    const ch = supabase.channel(`token-reset-${tokenData.id}`)
      .on("broadcast", { event: "force_logout" }, () => {
        setForcedOut(true);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tokenData?.id]);

  // Membership pause: jika token ini membership (MBR-/MRD-), dengar event jeda global.
  // Cover via broadcast (instan) + postgres_changes site_settings (cadangan).
  useEffect(() => {
    if (!tokenData?.is_membership) return;
    const broadcastCh = supabase
      .channel("membership-control")
      .on("broadcast", { event: "membership_paused" }, () => setMembershipPaused(true))
      .on("broadcast", { event: "membership_resumed" }, () => setMembershipPaused(false))
      .subscribe();
    const dbCh = supabase
      .channel(`membership-pause-db-${tokenData.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_settings", filter: "key=eq.membership_paused" },
        (payload: any) => {
          const v = payload.new?.value ?? "false";
          setMembershipPaused(v === "true");
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(broadcastCh);
      supabase.removeChannel(dbCh);
    };
  }, [tokenData?.is_membership, tokenData?.id]);

  // Periodic playlist polling (realtime on playlists table blocked by RLS for non-admin viewers)
  useEffect(() => {
    if (!tokenData?.id) return;
    const interval = setInterval(() => {
      refreshPlaylists();
    }, 15_000); // every 15s
    return () => clearInterval(interval);
  }, [tokenData?.id, refreshPlaylists]);

  // Safety-net: poll stream status every 30s in case realtime drops.
  // Ensures player switches to LIVE even if WS reconnect missed the toggle event.
  useEffect(() => {
    if (!tokenData?.id) return;
    const poll = async () => {
      try {
        const { data } = await (supabase.rpc as any)("get_stream_status");
        if (data?.length) {
          setStream((prev: any) => {
            const next = data[0];
            // Only update if changed to avoid unnecessary re-renders
            if (!prev || prev.is_live !== next.is_live || prev.title !== next.title) {
              return next;
            }
            return prev;
          });
        }
      } catch {}
    };
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, [tokenData?.id]);

  // Blocked status is handled via realtime subscription on tokens table (line ~393)
  // No polling needed — saves ~60,000 req/hr at 1000 users

  useEffect(() => {
    if (stream?.is_live) { setCountdown(null); return; }
    // Target time = WIB wall-clock yang dikonversi ke UTC ms.
    // Countdown menampilkan DURASI sampai event (sama untuk semua zona waktu user).
    let targetUtcMs: number | null = null;
    const scheduledShowMs = getShowScheduleTimestamp({ schedule_date: activeShowDate, schedule_time: activeShowTime });
    if (scheduledShowMs != null) {
      targetUtcMs = scheduledShowMs;
    } else if (nextShowTime) {
      const m = nextShowTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (m) {
        const [, y, mo, d, h, mi] = m;
        // Wall-clock WIB → UTC ms (subtract 7h)
        targetUtcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, 0) - 7 * 3600 * 1000;
      } else {
        const t = new Date(nextShowTime).getTime();
        if (!isNaN(t)) targetUtcMs = t;
      }
    }
    if (targetUtcMs == null) { setCountdown(null); return; }

    const target = targetUtcMs;
    const update = () => {
      const diff = target - Date.now();
      if (diff <= 0) { setCountdown(null); return; }
      setCountdown({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, [nextShowTime, stream?.is_live, activeShowDate, activeShowTime]);

  // Countdown khusus saat token belum aktif (jadwal show belum tiba)
  const [notStartedCountdown, setNotStartedCountdown] = useState<{ d: number; h: number; m: number; s: number } | null>(null);
  useEffect(() => {
    if (!tokenNotStarted?.startsAt) { setNotStartedCountdown(null); return; }
    const target = new Date(tokenNotStarted.startsAt).getTime();
    if (isNaN(target)) { setNotStartedCountdown(null); return; }
    const tick = () => {
      const diff = target - Date.now();
      if (diff <= 0) {
        setNotStartedCountdown({ d: 0, h: 0, m: 0, s: 0 });
        // Token sudah aktif → reload agar validate ulang
        try { window.location.reload(); } catch {}
        return;
      }
      setNotStartedCountdown({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [tokenNotStarted?.startsAt]);

  useEffect(() => { const h = (e: MouseEvent) => { if ((e.target as HTMLElement).closest(".player-area")) e.preventDefault(); }; document.addEventListener("contextmenu", h); return () => document.removeEventListener("contextmenu", h); }, []);

  const handleUsernameSet = async (name: string) => { setUsername(name); safeStorageSet(typeof window !== "undefined" ? window.localStorage : undefined, "rt48_username", name); setShowUsernameModal(false); const { data: { session } } = await supabase.auth.getSession(); if (session?.user) await supabase.from("profiles").upsert({ id: session.user.id, username: name }, { onConflict: "id" }); };

  const handlePlaylistSwitch = useCallback((newPlaylist: any) => {
    if (activePlaylist?.id === newPlaylist.id) return;
    playerRef.current?.pause();
    setActivePlaylist(newPlaylist);
  }, [activePlaylist?.id]);

  // === RENDER SECTION (after all hooks) ===

  if (loading || redirecting) return (<div className="flex min-h-screen items-center justify-center bg-background"><div className="text-center"><div className="mx-auto mb-4 h-16 w-16 rounded-full overflow-hidden shadow-[0_0_16px_hsl(var(--primary)/0.4)] animate-float"><img src={logo} alt="RT48" className="h-full w-full object-cover" /></div><p className="text-muted-foreground">{redirecting ? "Mengarahkan ke replay..." : "Memvalidasi akses..."}</p></div></div>);

  if (membershipPaused) return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--warning))]/40 bg-card p-8 text-center shadow-lg">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[hsl(var(--warning))]/10">
          <span className="text-4xl">⏸️</span>
        </div>
        <h2 className="mb-2 text-xl font-bold text-foreground">Akses Membership Sedang Dijeda</h2>
        <p className="mb-2 text-sm text-muted-foreground">
          Admin sedang menjeda layanan membership untuk sementara.
        </p>
        <p className="mb-6 text-xs text-muted-foreground">
          Token kamu <strong>tetap aktif</strong> dan akan otomatis bisa digunakan kembali ketika admin mengaktifkan layanan.
        </p>
        <div className="flex flex-col gap-3">
          {whatsappNumber && (
            <a
              href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent("Halo admin, saya mendapat pesan akses membership sedang dijeda. Mohon info kapan layanan kembali aktif.\n\nToken: " + tokenCode)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[hsl(var(--success))] px-6 py-3 font-semibold text-primary-foreground hover:bg-[hsl(var(--success))]/90 active:scale-[0.97] transition-transform"
            >
              💬 Hubungi Admin
            </a>
          )}
          <button onClick={() => navigate("/schedule")} className="rounded-full bg-secondary px-6 py-3 font-semibold text-secondary-foreground hover:bg-secondary/80">
            📅 Lihat Jadwal Show
          </button>
          <button onClick={() => navigate("/")} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90">
            🏠 Kembali ke Beranda
          </button>
        </div>
      </div>
    </div>
  );

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

  if (forcedOut) return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--warning))]/40 bg-card p-8 text-center shadow-lg">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[hsl(var(--warning))]/10">
          <RotateCcw className="h-9 w-9 text-[hsl(var(--warning))]" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-foreground">Sesi Dihentikan</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Link token ini baru saja di-reset (oleh admin atau di perangkat lain). Sesi di perangkat ini telah dihentikan.
        </p>
        <div className="flex flex-col gap-3">
          <button onClick={() => window.location.reload()} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90">🔄 Klaim Ulang Sesi</button>
          <button onClick={() => navigate("/")} className="rounded-full bg-secondary px-6 py-3 font-semibold text-secondary-foreground hover:bg-secondary/80">🏠 Kembali ke Beranda</button>
        </div>
      </div>
    </div>
  );

  if (showReplayBlocked) return (<div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="w-full max-w-md rounded-2xl border border-accent/30 bg-card p-8 text-center"><div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-accent/10"><span className="text-4xl">🎬</span></div><h2 className="mb-2 text-xl font-bold text-foreground">Show Telah Berakhir</h2><p className="text-sm text-muted-foreground mb-4">Show ini telah dijadikan replay. Akses streaming langsung tidak tersedia lagi.</p><p className="text-xs text-muted-foreground mb-6">Kamu bisa menonton replay dengan menukarkan koin di halaman utama.</p><button onClick={() => navigate("/")} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90">🏠 Ke Beranda</button></div></div>);

  if (error === "device_limit") return (<DeviceLimitScreen tokenCode={tokenCode} getFingerprint={getFingerprint} navigate={navigate} maxDevices={tokenData?.max_devices} />);

  if (error === "no_token") return (<div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center"><div className="mx-auto mb-4 h-16 w-16 rounded-full overflow-hidden animate-float"><img src={logo} alt="RT48" className="h-full w-full object-cover" /></div><h2 className="mb-2 text-xl font-bold text-foreground">Akses Streaming</h2><p className="mb-6 text-muted-foreground">{purchaseMessage || "Beli token untuk mengakses streaming."}</p>{whatsappNumber && <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--success))] px-6 py-3 font-semibold text-primary-foreground">💬 Hubungi WhatsApp</a>}<div className="mt-4"><a href="/" className="text-sm text-primary hover:underline">← Kembali</a></div></div></div>);

  if (error) return (<div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="rounded-xl border border-destructive/30 bg-card p-8 text-center"><h2 className="mb-2 text-xl font-bold text-destructive">Akses Ditolak</h2><p className="text-muted-foreground">{error}</p><div className="mt-4"><a href="/" className="text-sm text-primary hover:underline">← Kembali</a></div></div></div>);

  const isLive = stream?.is_live || false;

  if (showMismatch) {
    const defaultMismatch = { tokenShowTitle: "Show Lain", tokenShowDate: "", tokenShowTime: "", activeShowTitle: "Show Lain" };
    const mismatchInfo = safeJsonParse<typeof defaultMismatch>(mismatchShowTitle, defaultMismatch);
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-lg rounded-2xl border border-[hsl(var(--warning))]/40 bg-card p-6 sm:p-8 shadow-[0_0_40px_hsl(var(--warning)/0.15)]">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[hsl(var(--warning))]/15 ring-2 ring-[hsl(var(--warning))]/30">
              <AlertTriangle className="h-8 w-8 text-[hsl(var(--warning))]" />
            </div>
            <h2 className="mb-1.5 text-xl sm:text-2xl font-bold text-foreground">
              Token Tidak Sesuai Jadwal
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Token yang kamu pakai tidak berlaku untuk show yang sedang live saat ini.
            </p>
          </div>

          <div className="my-6 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-stretch gap-3">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-left">
              <p className="text-[10px] font-bold tracking-widest text-primary/80 uppercase mb-1.5">
                Show Token Kamu
              </p>
              <p className="text-base font-bold text-foreground leading-tight line-clamp-2">
                🎭 {mismatchInfo.tokenShowTitle}
              </p>
              {(mismatchInfo.tokenShowDate || mismatchInfo.tokenShowTime) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  📅 {mismatchInfo.tokenShowDate || "-"}
                  {mismatchInfo.tokenShowTime ? ` • 🕐 ${mismatchInfo.tokenShowTime}` : ""}
                </p>
              )}
            </div>

            <div className="flex items-center justify-center">
              <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="sm:hidden flex w-full items-center gap-2 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                vs
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>

            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-left">
              <p className="text-[10px] font-bold tracking-widest text-destructive/80 uppercase mb-1.5 flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
                Sedang Live
              </p>
              <p className="text-base font-bold text-foreground leading-tight line-clamp-2">
                🔴 {mismatchInfo.activeShowTitle}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Token kamu tidak berlaku di sini
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 border border-border p-3 mb-5">
            <p className="text-xs text-muted-foreground leading-relaxed">
              💡 Token streaming hanya berlaku untuk show sesuai jadwal yang kamu beli. Silakan kembali pada tanggal & jam show kamu, atau beli token baru untuk show yang sedang live.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button onClick={() => navigate("/schedule")} className="flex-1 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-transform">
              📅 Lihat Jadwal Show
            </button>
            <button onClick={() => navigate("/")} className="flex-1 rounded-full bg-secondary px-5 py-3 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80 active:scale-[0.97] transition-transform">
              🏠 Beranda
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background lg:flex-row">
      <SectionBoundary name="ConnectionStatus"><ConnectionStatus /></SectionBoundary>
      <SectionBoundary name="ViewerBroadcast"><ViewerBroadcast /></SectionBoundary>
      <SectionBoundary name="SecurityAlert"><SecurityAlert /></SectionBoundary>
      {playerAnimation !== "none" && <SectionBoundary name="PlayerAnimations"><Suspense fallback={null}><PlayerAnimations type={playerAnimation} backgroundOnly /></Suspense></SectionBoundary>}
      {showUsernameModal && <SectionBoundary name="UsernameModal"><Suspense fallback={null}><UsernameModal onSubmit={handleUsernameSet} /></Suspense></SectionBoundary>}
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
                {whatsappChannelEnabled && whatsappChannel && (
                  <a
                    href={whatsappChannel}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center gap-3 rounded-xl border border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/5 p-4 text-left transition hover:border-[hsl(var(--success))]/60 hover:bg-[hsl(var(--success))]/10"
                  >
                    <MessageCircle className="h-5 w-5 text-[hsl(var(--success))]" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Saluran WhatsApp</p>
                      <p className="text-xs text-muted-foreground">Tonton live lainnya di saluran kami</p>
                    </div>
                  </a>
                )}
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
          {/* Token duration badge overlay on player */}
          {(tokenData?.is_membership || tokenData?.is_bundle || tokenData?.is_custom) && tokenData?.expires_at && (() => {
            const expiresAt = new Date(tokenData.expires_at);
            const diffMs = expiresAt.getTime() - Date.now();
            const daysLeft = Math.max(0, Math.ceil(diffMs / 86400000));
            const hoursLeft = Math.max(0, Math.ceil(diffMs / 3600000));
            const label = tokenData.is_membership ? "👑 Member" : tokenData.is_bundle ? "📦 Bundle" : "🎫 Custom";
            const borderColor = tokenData.is_membership ? "border-yellow-500/40" : tokenData.is_custom ? "border-cyan-400/40" : "border-primary/40";
            const textColor = tokenData.is_membership ? "text-yellow-400" : tokenData.is_custom ? "text-cyan-400" : "text-primary";
            const isNearExpiry = daysLeft <= 3;
            return (
              <div className={`absolute top-2 left-2 z-30 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm border ${borderColor} px-2.5 py-1`}>
                <span className="text-[10px]">{label.split(" ")[0]}</span>
                <span className={`text-[10px] font-semibold ${isNearExpiry ? "text-destructive" : textColor}`}>
                  {daysLeft > 0 ? `${daysLeft}d` : `${hoursLeft}h`}
                </span>
              </div>
            );
          })()}
          {isLive && activePlaylist ? (
            <div className="relative">
              {effectiveStreamUrl ? (
                <SectionBoundary
                  name="VideoPlayer"
                  fallback={
                    <div className="flex aspect-video w-full items-center justify-center bg-card">
                      <p className="text-sm text-destructive">Player gagal dimuat. Coba refresh halaman.</p>
                    </div>
                  }
                >
                  <Suspense fallback={<div className="flex aspect-video w-full items-center justify-center bg-card"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
                    <VideoPlayer
                      ref={playerRef}
                      key={`${activePlaylist.id}-${activePlaylist.type}`}
                      playlist={{ url: effectiveStreamUrl, type: effectiveType, label: activePlaylist.title }}
                      autoPlay
                      tokenCode={tokenData?.code}
                      customHeadersRef={effectiveHeadersRef}
                    />
                  </Suspense>
                </SectionBoundary>
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
            <div className="relative aspect-video w-full overflow-hidden bg-card">
              {/* Background priority: admin override → active show image → gradient */}
              {(() => {
                const bgUrl = offlineBackgroundOverride || activeShowImage;
                return bgUrl ? (
                  <>
                    <img
                      src={bgUrl}
                      alt={activeShowTitle || "Show"}
                      className="absolute inset-0 h-full w-full object-cover scale-110 opacity-85"
                      style={{ filter: "blur(10px)" }}
                    />
                    {/* Lighter overlay so the show artwork colors stay visible */}
                    <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/15 to-background/55" />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-secondary/10" />
                );
              })()}
              {/* Foreground content */}
              <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 py-6">
                {countdown ? (
                  <>
                    <h3 className="text-center text-lg sm:text-xl md:text-2xl font-semibold text-foreground/90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                      Show Belum Dimulai
                    </h3>
                    {activeShowTitle && (
                      <p className="text-center text-xl sm:text-2xl md:text-3xl font-extrabold text-primary leading-tight drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] line-clamp-2 max-w-[92%]">
                        🎭 {activeShowTitle}
                      </p>
                    )}
                    {(activeShowDate || activeShowTime) && (() => {
                      const parsedTs = parseWIBDateTime(activeShowDate || "", activeShowTime || "00:00");
                      const outsideWIB = parsedTs != null && isUserOutsideWIB();
                      const userZoneLabel = getUserZoneLabel();
                      const dateLabel = parsedTs != null
                        ? (outsideWIB
                            ? formatLocal(parsedTs, { day: "numeric", month: "long", year: "numeric" })
                            : formatDateWIB(parsedTs))
                        : (activeShowDate || "");
                      const primaryTimeLabel = parsedTs != null
                        ? (outsideWIB
                            ? `${formatLocal(parsedTs, { hour: "2-digit", minute: "2-digit" })} ${userZoneLabel}`
                            : `${formatLocal(parsedTs, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" } as any)} WIB`)
                        : (activeShowTime ? `${activeShowTime.replace(/\./g, ":")} WIB` : "");
                      const wibHint = outsideWIB && parsedTs != null
                        ? formatLocal(parsedTs, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" } as any)
                        : "";
                      return (
                        <>
                          <p className="text-center text-xs sm:text-sm text-foreground/80 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                            📅 {dateLabel}
                            {dateLabel && primaryTimeLabel ? " • 🕐 " : ""}
                            {primaryTimeLabel}
                          </p>
                          {outsideWIB && wibHint && (
                            <p className="text-center text-[11px] sm:text-xs text-primary/90 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                              🌐 Jadwal asli: <span className="font-semibold">{wibHint} WIB</span>
                            </p>
                          )}
                        </>
                      );
                    })()}
                    {/* Countdown digital box */}
                    <div className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-black/55 backdrop-blur-md border border-primary/25 px-4 py-2.5 shadow-[0_0_30px_hsl(var(--primary)/0.18)]">
                      {[
                        { v: countdown.d, l: "HARI" },
                        { v: countdown.h, l: "JAM" },
                        { v: countdown.m, l: "MENIT" },
                        { v: countdown.s, l: "DETIK" },
                      ].map((seg, idx, arr) => (
                        <div key={seg.l} className="flex items-center gap-2">
                          <div className="flex flex-col items-center min-w-[44px]">
                            <span className="font-mono text-2xl sm:text-3xl font-extrabold text-primary tabular-nums leading-none drop-shadow-[0_0_8px_hsl(var(--primary)/0.55)]">
                              <FlipNumber value={seg.v} />
                            </span>
                            <span className="mt-1.5 text-[9px] sm:text-[10px] font-semibold tracking-widest text-muted-foreground">
                              {seg.l}
                            </span>
                          </div>
                          {idx < arr.length - 1 && (
                            <span className="text-primary/60 font-bold text-xl pb-3.5">:</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center text-center">
                    <div className="mb-4 h-16 w-16 rounded-full overflow-hidden opacity-30 ring-2 ring-border">
                      <img src={logo} alt="RT48" className="h-full w-full object-cover" />
                    </div>
                    <p className="font-mono text-xl sm:text-2xl font-bold text-destructive tracking-widest">
                      STREAMING OFFLINE
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">Tidak ada jadwal saat ini</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {isLive && (
          <div className="border-t border-border px-3 py-1.5 flex items-center gap-2 flex-wrap">
            {playlists.length > 1 && (
              <PlaylistSwitcher
                playlists={playlists}
                activePlaylistId={activePlaylist?.id ?? null}
                onSelect={handlePlaylistSwitch}
                className="flex-1 min-w-0"
              />
            )}
            <PipButton />
          </div>
        )}
        {activeShowTitle && isLive && (
          <div className="border-t border-border px-4 py-2">
            <p className="text-xs font-semibold text-primary">🔴 Sedang Live</p>
            <h2 className="text-sm font-bold text-foreground">{activeShowTitle}</h2>
          </div>
        )}
        <SectionBoundary name="LineupAvatars">
          <Suspense fallback={null}>
            <LineupAvatars team={activeShowTeam} />
          </Suspense>
        </SectionBoundary>
      </div>
      <div className="h-[50vh] border-t border-border lg:h-screen lg:sticky lg:top-0 lg:w-80 lg:border-l lg:border-t-0 xl:w-96 flex flex-col relative">
        <div className="absolute top-0 left-0 right-0 z-10">
          <SectionBoundary name="LivePoll">
            <Suspense fallback={null}>
              <LivePoll voterId={tokenData?.id || username || "anon"} />
            </Suspense>
          </SectionBoundary>
        </div>
        <SectionBoundary name="LiveQuizSlot">
          <Suspense fallback={null}>
            <LiveQuizSlot currentUserId={null} />
          </Suspense>
        </SectionBoundary>
        <div className="flex-1 min-h-0">
          <LiveChatBoundary>
            <Suspense fallback={<div className="flex h-full items-center justify-center"><p className="text-xs text-muted-foreground">Memuat chat...</p></div>}>
              <LiveChat username={username} tokenId={tokenData?.id} isLive={isLive} isAdmin={false} />
            </Suspense>
          </LiveChatBoundary>
        </div>
      </div>
    </div>
  );
};

export default LivePage;
