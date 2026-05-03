import { lazy, Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRestreamSignedStreamUrl } from "@/hooks/useRestreamSignedStreamUrl";
import { useProxyStream } from "@/hooks/useProxyStream";
import PlaylistSwitcher from "@/components/viewer/PlaylistSwitcher";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Tv2, AlertCircle, Loader2, Maximize2, Minimize2, LogOut, RefreshCw } from "lucide-react";

const VideoPlayer = lazy(() => import("@/components/VideoPlayer"));

interface Playlist {
  id: string;
  title: string;
  type: string;
  url: string;
  sort_order: number;
}

const STORAGE_KEY = "rt48_restream_code_v1";

const PlayerError = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="flex aspect-video items-center justify-center bg-card px-6 text-center">
    <div className="space-y-3">
      <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Coba lagi
        </Button>
      )}
    </div>
  </div>
);

const PlayerLoading = ({ label = "Menyiapkan player..." }: { label?: string }) => (
  <div className="flex aspect-video items-center justify-center bg-card">
    <div className="flex flex-col items-center gap-2">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  </div>
);

const RestreamPage = () => {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState<string>(() => {
    const fromUrl = params.get("code");
    if (fromUrl) return fromUrl.trim();
    try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
  });
  const [inputCode, setInputCode] = useState("");
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState<boolean | null>(null);
  const [validationError, setValidationError] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [externalShowId, setExternalShowId] = useState<string | null>(null);
  const [proxyShowError, setProxyShowError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const isProxy = activePlaylist?.type === "proxy";
  const isDirect = activePlaylist?.type === "direct";

  const validateAndLoad = useCallback(async (codeToCheck: string) => {
    if (!codeToCheck) { setValidated(false); return; }
    setValidating(true);
    setValidationError("");
    try {
      const { data, error } = await (supabase as any).rpc("validate_restream_code", { _code: codeToCheck });
      if (error || !(data as any)?.valid) {
        setValidated(false);
        setValidationError("Kode tidak valid atau telah dinonaktifkan.");
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        setValidating(false);
        return;
      }
      setValidated(true);
      try { localStorage.setItem(STORAGE_KEY, codeToCheck); } catch {}

      setLoadingPlaylists(true);
      const { data: pls, error: plErr } = await (supabase as any).rpc("get_restream_playlists", { _code: codeToCheck });
      setLoadingPlaylists(false);
      if (plErr) {
        setValidationError("Gagal memuat daftar player.");
        return;
      }
      const list = (pls || []) as Playlist[];
      setPlaylists(list);
      setActivePlaylist((prev) => {
        if (!list.length) return null;
        if (!prev) return list[0];
        return list.find((p) => p.id === prev.id) || list[0];
      });
    } catch {
      setValidated(false);
      setValidationError("Terjadi kesalahan, coba lagi.");
    } finally {
      setValidating(false);
    }
  }, []);

  useEffect(() => {
    if (code) validateAndLoad(code);
    else setValidated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch active show external_show_id when proxy playlist is selected
  useEffect(() => {
    if (!isProxy) {
      setProxyShowError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase as any).rpc("get_active_show_external_id");
        if (cancelled) return;
        if (error) {
          setProxyShowError("Gagal mengambil informasi show aktif.");
          setExternalShowId(null);
          return;
        }
        if (!data) {
          setProxyShowError("Belum ada show aktif yang dipilih admin. Player IDN tidak bisa diputar saat ini.");
          setExternalShowId(null);
        } else {
          setProxyShowError(null);
          setExternalShowId(String(data));
        }
      } catch {
        if (!cancelled) {
          setProxyShowError("Tidak bisa terhubung ke server.");
          setExternalShowId(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isProxy, refreshKey]);

  // Server-side signed URL for m3u8 / youtube / cloudflare (NOT for proxy/direct)
  const { signedUrl, loading: urlLoading, error: urlError, proxyType } =
    useRestreamSignedStreamUrl(
      validated && activePlaylist && !isDirect && !isProxy ? activePlaylist : null,
      code,
      refreshKey
    );

  // Client-side proxy header injection (Hanabira / IDN)
  const {
    playbackUrl: proxyUrl,
    customHeadersRef: proxyHeadersRef,
    loading: proxyLoading,
    error: proxyError,
  } = useProxyStream(isProxy, externalShowId, refreshKey, undefined, code || null);

  const effectiveUrl = isDirect
    ? activePlaylist?.url
    : isProxy
      ? proxyUrl
      : signedUrl;
  const effectiveLoading = isDirect
    ? false
    : isProxy
      ? proxyLoading
      : urlLoading;
  const effectiveError = isDirect
    ? null
    : isProxy
      ? (proxyShowError || proxyError)
      : urlError;
  const effectiveType = (isDirect || isProxy) ? "m3u8" : (proxyType || activePlaylist?.type || "m3u8");

  // Fullscreen handling
  const playerWrapRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        const el = playerWrapRef.current;
        if (el?.requestFullscreen) await el.requestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
      }
    } catch { /* ignore */ }
  }, []);

  const handleSubmitCode = (e: React.FormEvent) => {
    e.preventDefault();
    const c = inputCode.trim();
    if (!c) return;
    setCode(c);
    setParams({ code: c }, { replace: true });
    validateAndLoad(c);
  };

  const handleLogoutCode = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setCode("");
    setValidated(false);
    setPlaylists([]);
    setActivePlaylist(null);
    setExternalShowId(null);
    setParams({}, { replace: true });
  };

  const handleRetry = () => setRefreshKey((k) => k + 1);

  // ── UI: code gate ──
  if (validated !== true) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Tv2 className="h-5 w-5 text-primary" />
            <h1 className="text-base font-bold text-foreground">Halaman Restream</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Masukkan kode akses yang diberikan admin untuk masuk.
          </p>
          <form onSubmit={handleSubmitCode} className="space-y-3">
            <Input
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
              placeholder="Kode akses"
              className="bg-background font-mono uppercase tracking-wider text-center"
              autoFocus
              maxLength={50}
            />
            {validationError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{validationError}</span>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={validating || !inputCode.trim()}>
              {validating ? "Memeriksa..." : "Masuk"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ── UI: validated — Monitor-style card layout ──
  return (
    <div className="min-h-screen bg-background p-3 md:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Tv2 className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-xl font-bold text-foreground">Halaman Restream</h1>
              <p className="text-xs text-muted-foreground">Player bersih untuk partner — tanpa chat, poll, atau quiz.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleRetry} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={handleLogoutCode} className="gap-1.5 text-muted-foreground hover:text-destructive">
              <LogOut className="h-3.5 w-3.5" /> Keluar
            </Button>
          </div>
        </div>

        {/* Player card */}
        <div className="rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-3 py-2 sm:px-4 sm:py-3">
            <p className="text-sm font-semibold text-foreground">Preview Player</p>
            <p className="text-xs text-muted-foreground">
              Pilih server/resolusi di bawah. Mendukung IDN (Hanabira), Resolusi A & B.
            </p>
          </div>

          <div className="p-1.5 sm:p-2">
            <div ref={playerWrapRef} className="relative rounded-xl border border-border overflow-hidden bg-black group">
              <ErrorBoundary fallback={<PlayerError message="Player gagal dimuat." onRetry={handleRetry} />}>
                {loadingPlaylists ? (
                  <PlayerLoading label="Memuat daftar player..." />
                ) : playlists.length === 0 ? (
                  <PlayerError message="Belum ada playlist yang diaktifkan untuk halaman restream. Hubungi admin." />
                ) : !activePlaylist ? (
                  <PlayerError message="Tidak ada playlist aktif." />
                ) : effectiveError ? (
                  <PlayerError message={effectiveError} onRetry={handleRetry} />
                ) : effectiveUrl ? (
                  <Suspense fallback={<PlayerLoading />}>
                    <VideoPlayer
                      key={`${activePlaylist.id}-${activePlaylist.type}-${refreshKey}`}
                      playlist={{ type: effectiveType, url: effectiveUrl, label: activePlaylist.title }}
                      autoPlay
                      customHeadersRef={isProxy ? proxyHeadersRef : undefined}
                    />
                  </Suspense>
                ) : effectiveLoading ? (
                  <PlayerLoading />
                ) : (
                  <PlayerError message="Player belum tersedia." onRetry={handleRetry} />
                )}

                {/* Fullscreen toggle */}
                {playlists.length > 0 && effectiveUrl && (
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    aria-label={isFullscreen ? "Keluar layar penuh" : "Layar penuh"}
                    className="absolute top-3 right-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 hover:bg-black/75 text-white backdrop-blur-sm border border-white/15 opacity-80 hover:opacity-100 transition"
                  >
                    {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                  </button>
                )}
              </ErrorBoundary>
            </div>
          </div>

          {/* Switcher */}
          {playlists.length > 0 && (
            <div className="border-t border-border px-2 py-2 sm:px-3 sm:py-3">
              <PlaylistSwitcher
                playlists={playlists.map((p) => ({ id: p.id, title: p.title, type: p.type }))}
                activePlaylistId={activePlaylist?.id ?? null}
                onSelect={(p) => {
                  const full = playlists.find((x) => x.id === p.id);
                  if (full) {
                    setActivePlaylist(full);
                    if (full.type === "proxy") setRefreshKey((k) => k + 1);
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RestreamPage;
