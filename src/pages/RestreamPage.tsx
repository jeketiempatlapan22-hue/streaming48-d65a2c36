import { lazy, Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRestreamSignedStreamUrl } from "@/hooks/useRestreamSignedStreamUrl";
import PlaylistSwitcher from "@/components/viewer/PlaylistSwitcher";
import { Tv2, AlertCircle, Loader2, Maximize2, Minimize2 } from "lucide-react";

const VideoPlayer = lazy(() => import("@/components/VideoPlayer"));

interface Playlist {
  id: string;
  title: string;
  type: string;
  url: string;
  sort_order: number;
}

const STORAGE_KEY = "rt48_restream_code_v1";

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

      // Load playlists for this code
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

  // Initial validation if code already present
  useEffect(() => {
    if (code) validateAndLoad(code);
    else setValidated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmitCode = (e: React.FormEvent) => {
    e.preventDefault();
    const c = inputCode.trim();
    if (!c) return;
    setCode(c);
    setParams({ code: c }, { replace: true });
    validateAndLoad(c);
  };

  // ── Player URL (only for validated state) ──
  const isProxy = activePlaylist?.type === "proxy";
  const isDirect = activePlaylist?.type === "direct";
  const { signedUrl, loading: urlLoading, error: urlError, proxyType } =
    useRestreamSignedStreamUrl(
      validated && activePlaylist && !isDirect ? activePlaylist : null,
      code
    );

  const effectiveUrl = isDirect ? activePlaylist?.url : signedUrl;
  const effectiveType = isDirect ? "m3u8" : (proxyType || activePlaylist?.type || "m3u8");

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

  // ── UI: validated — clean fullscreen player ──
  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Player area */}
      <div className="flex-1 relative bg-black">
        {loadingPlaylists ? (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : playlists.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm px-6 text-center">
            Belum ada playlist yang diaktifkan untuk halaman restream. Hubungi admin.
          </div>
        ) : urlLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : urlError ? (
          <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm px-6 text-center">
            <div>
              <AlertCircle className="h-6 w-6 mx-auto mb-2 text-destructive" />
              <p>{urlError}</p>
            </div>
          </div>
        ) : effectiveUrl && activePlaylist ? (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center text-white/70"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
            <VideoPlayer
              playlist={{ type: effectiveType, url: effectiveUrl, label: activePlaylist.title }}
              autoPlay
            />
          </Suspense>
        ) : null}
      </div>

      {/* Switcher only when more than one playlist */}
      {playlists.length > 1 && (
        <div className="bg-black/80 backdrop-blur-sm border-t border-white/10 px-3 py-2">
          <PlaylistSwitcher
            playlists={playlists.map((p) => ({ id: p.id, title: p.title, type: p.type }))}
            activePlaylistId={activePlaylist?.id}
            onSelect={(p) => {
              const full = playlists.find((x) => x.id === p.id);
              if (full) setActivePlaylist(full);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default RestreamPage;
