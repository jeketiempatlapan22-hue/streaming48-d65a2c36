import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import VideoPlayer, { VideoPlayerHandle } from "@/components/VideoPlayer";
import logo from "@/assets/logo.png";
import ConnectionStatus from "@/components/viewer/ConnectionStatus";
import PipButton from "@/components/viewer/PipButton";
import SecurityAlert from "@/components/viewer/SecurityAlert";
import PlayerAnimations, { AnimationType } from "@/components/viewer/PlayerAnimations";
import ViewerBroadcast from "@/components/viewer/ViewerBroadcast";

import { useSignedStreamUrl } from "@/hooks/useSignedStreamUrl";

const LiveChat = lazy(() => import("@/components/viewer/LiveChat"));
const UsernameModal = lazy(() => import("@/components/viewer/UsernameModal"));
const LivePoll = lazy(() => import("@/components/viewer/LivePoll"));

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
  const playerRef = useRef<VideoPlayerHandle>(null);

  const getFingerprint = useCallback(() => {
    let fp = localStorage.getItem("rt48_fp");
    if (!fp) { fp = crypto.randomUUID(); localStorage.setItem("rt48_fp", fp); }
    return fp;
  }, []);

  const fp = getFingerprint();

  // IMPORTANT: All hooks must be called before any conditional returns
  const { signedUrl, loading: signedLoading, proxyType } = useSignedStreamUrl(
    activePlaylist ? { id: activePlaylist.id, type: activePlaylist.type, url: activePlaylist.url } : null,
    tokenCode,
    fp
  );

  const effectiveType = proxyType === "youtube_proxy" ? "youtube" : (activePlaylist?.type || "m3u8");

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase.from("profiles").select("username").eq("id", session.user.id).maybeSingle();
        if (profile?.username) { setUsername(profile.username); localStorage.setItem("rt48_username", profile.username); return; }
        setShowUsernameModal(true); return;
      }
      const stored = localStorage.getItem("rt48_username");
      if (!stored) setShowUsernameModal(true);
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (!tokenCode) {
      supabase.from("site_settings").select("*").then(({ data }) => {
        if (data) data.forEach((s: any) => {
          if (s.key === "purchase_message") setPurchaseMessage(s.value);
          if (s.key === "whatsapp_number") setWhatsappNumber(s.value);
        });
      });
      setError("no_token"); setLoading(false); return;
    }
    const validate = async () => {
      const { data: validation } = await supabase.rpc("validate_token", { _code: tokenCode });
      const result = validation as any;
      if (!result?.valid) { setError(result?.error || "Token tidak valid."); setLoading(false); return; }
      const fp = getFingerprint();
      const { data: sess } = await supabase.rpc("create_token_session", { _token_code: tokenCode, _fingerprint: fp, _user_agent: navigator.userAgent });
      const sd = sess as any;
      if (!sd?.success) { setError("device_limit"); setLoading(false); return; }
      setTokenData({ id: result.id, code: result.code, show_id: result.show_id });
      const [streamRes, playlistRes, settingsRes] = await Promise.all([
        supabase.from("streams").select("*").limit(1).single(),
        supabase.from("playlists").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("site_settings").select("*"),
      ]);
      if (streamRes.data) setStream(streamRes.data);
      if (playlistRes.data?.length) { setPlaylists(playlistRes.data); setActivePlaylist(playlistRes.data[0]); }
      
      let activeShowId = "";
      if (settingsRes.data) settingsRes.data.forEach((s: any) => {
        if (s.key === "next_show_time") setNextShowTime(s.value);
        if (s.key === "whatsapp_number") setWhatsappNumber(s.value);
        if (s.key === "player_animation") setPlayerAnimation((s.value || "none") as AnimationType);
        if (s.key === "active_show_id") activeShowId = s.value;
      });

      if (result.show_id && activeShowId && result.show_id !== activeShowId) {
        const { data: tokenShow } = await supabase.from("shows").select("title").eq("id", result.show_id).maybeSingle();
        const { data: activeShow } = await supabase.from("shows").select("title").eq("id", activeShowId).maybeSingle();
        setShowMismatch(true);
        setMismatchShowTitle(
          `Token kamu untuk show "${tokenShow?.title || "lain"}", sedangkan yang sedang live adalah "${activeShow?.title || "show lain"}".`
        );
      }

      setLoading(false);
    };
    validate();
  }, [tokenCode, getFingerprint]);

  useEffect(() => {
    if (!tokenCode) return;
    const fp = getFingerprint();
    const releaseSession = () => {
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/release_token_session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ _token_code: tokenCode, _fingerprint: fp }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("beforeunload", releaseSession);
    window.addEventListener("pagehide", releaseSession);
    return () => {
      window.removeEventListener("beforeunload", releaseSession);
      window.removeEventListener("pagehide", releaseSession);
    };
  }, [tokenCode, getFingerprint]);

  useEffect(() => {
    if (!tokenCode || !tokenData?.id) return;
    const fp = getFingerprint();
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          await supabase.rpc("create_token_session", {
            _token_code: tokenCode,
            _fingerprint: fp,
            _user_agent: navigator.userAgent,
          });
        } catch {
          // no-op heartbeat failure
        }
      })();
    }, 45000);
    return () => window.clearInterval(interval);
  }, [tokenCode, tokenData?.id, getFingerprint]);

  useEffect(() => {
    const ch = supabase.channel("stream-rt").on("postgres_changes", { event: "*", schema: "public", table: "streams" }, (p: any) => { if (p.new) setStream(p.new); }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Realtime animation sync from admin panel
  useEffect(() => {
    const ch = supabase.channel("animation-rt")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "site_settings" }, (p: any) => {
        if (p.new?.key === "player_animation") {
          setPlayerAnimation((p.new.value || "none") as AnimationType);
        }
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Realtime: block access when show becomes replay
  useEffect(() => {
    if (!tokenData?.show_id) return;
    const ch = supabase.channel("show-replay-block")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shows", filter: `id=eq.${tokenData.show_id}` }, (p: any) => {
        if (p.new?.is_replay === true) setShowReplayBlocked(true);
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tokenData?.show_id]);

  useEffect(() => {
    if (!tokenData?.id) return;
    const ch = supabase.channel("token-block").on("postgres_changes", { event: "UPDATE", schema: "public", table: "tokens", filter: `id=eq.${tokenData.id}` }, (p: any) => { if (p.new.status === "blocked") setBlocked(true); }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tokenData?.id]);

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

  if (blocked) return (<div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="w-full max-w-md rounded-2xl border-2 border-destructive bg-card p-8 text-center"><div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10 animate-pulse"><span className="text-4xl">🚫</span></div><h2 className="mb-2 text-2xl font-black text-destructive uppercase">DIBLOKIR</h2><p className="text-lg font-bold text-destructive mb-2">DILARANG RESTREAM YA DECK!!!</p><p className="text-sm text-muted-foreground mb-4">Token Anda telah diblokir karena pelanggaran.</p><button onClick={() => navigate("/")} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90">🏠 Ke Beranda</button></div></div>);

  if (showReplayBlocked) return (<div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="w-full max-w-md rounded-2xl border border-accent/30 bg-card p-8 text-center"><div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-accent/10"><span className="text-4xl">🎬</span></div><h2 className="mb-2 text-xl font-bold text-foreground">Show Telah Berakhir</h2><p className="text-sm text-muted-foreground mb-4">Show ini telah dijadikan replay. Akses streaming langsung tidak tersedia lagi.</p><p className="text-xs text-muted-foreground mb-6">Kamu bisa menonton replay dengan menukarkan koin di halaman utama.</p><button onClick={() => navigate("/")} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90">🏠 Ke Beranda</button></div></div>);

  if (error === "device_limit") return (<DeviceLimitScreen tokenCode={tokenCode} getFingerprint={getFingerprint} navigate={navigate} />);

  if (error === "no_token") return (<div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center"><div className="mx-auto mb-4 h-16 w-16 rounded-full overflow-hidden animate-float"><img src={logo} alt="RT48" className="h-full w-full object-cover" /></div><h2 className="mb-2 text-xl font-bold text-foreground">Akses Streaming</h2><p className="mb-6 text-muted-foreground">{purchaseMessage || "Beli token untuk mengakses streaming."}</p>{whatsappNumber && <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--success))] px-6 py-3 font-semibold text-primary-foreground">💬 Hubungi WhatsApp</a>}<div className="mt-4"><a href="/" className="text-sm text-primary hover:underline">← Kembali</a></div></div></div>);

  if (error) return (<div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="rounded-xl border border-destructive/30 bg-card p-8 text-center"><h2 className="mb-2 text-xl font-bold text-destructive">Akses Ditolak</h2><p className="text-muted-foreground">{error}</p><div className="mt-4"><a href="/" className="text-sm text-primary hover:underline">← Kembali</a></div></div></div>);

  const isLive = stream?.is_live || false;

  if (showMismatch) return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--warning))]/30 bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[hsl(var(--warning))]/10">
          <span className="text-4xl">🎭</span>
        </div>
        <h2 className="mb-2 text-xl font-bold text-foreground">Show Berbeda</h2>
        <p className="text-sm text-muted-foreground mb-4">{mismatchShowTitle}</p>
        <p className="text-xs text-muted-foreground mb-6">Kamu perlu membeli token untuk show yang sedang live agar bisa menonton.</p>
        <div className="flex flex-col gap-3">
          <button onClick={() => navigate("/")} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:bg-primary/90">🏠 Beli Token Show Ini</button>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">← Kembali ke Beranda</a>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative flex min-h-screen flex-col bg-background lg:flex-row">
      <ConnectionStatus />
      <ViewerBroadcast />
      <SecurityAlert />
      {playerAnimation !== "none" && <PlayerAnimations type={playerAnimation} backgroundOnly />}
      {showUsernameModal && <Suspense fallback={null}><UsernameModal onSubmit={handleUsernameSet} /></Suspense>}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <img src={logo} alt="RT48" className="h-8 w-8 rounded-full object-cover" />
          <div className="flex-1 min-w-0"><h1 className="text-sm font-bold text-foreground lg:text-base truncate">{stream?.title || "RealTime48"}</h1></div>
          
          <PipButton />
          {isLive ? <span className="flex items-center gap-1.5 rounded-full bg-destructive/20 px-3 py-1 text-xs font-semibold text-destructive"><span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />LIVE</span> : <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">OFFLINE</span>}
        </header>
        <div className="player-area relative z-10">
          {isLive && activePlaylist ? (
            <div className="relative">
              {signedUrl ? (
                <VideoPlayer
                  ref={playerRef}
                  key={activePlaylist.id}
                  playlist={{ url: signedUrl, type: effectiveType, label: activePlaylist.title }}
                  autoPlay
                  tokenCode={tokenData?.code}
                />
              ) : signedLoading ? (
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
          <div className="flex gap-2 overflow-x-auto border-t border-border px-4 py-2">
            {playlists.map((p: any) => <button key={p.id} onClick={() => handlePlaylistSwitch(p)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-medium transition-all ${activePlaylist?.id === p.id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>{p.title}</button>)}
          </div>
        )}
        <div className="border-t border-border px-4 py-3"><h2 className="text-sm font-bold text-foreground">{stream?.title || "RealTime48"}</h2></div>
      </div>
      <div className="h-[50vh] border-t border-border lg:h-screen lg:sticky lg:top-0 lg:w-80 lg:border-l lg:border-t-0 xl:w-96 flex flex-col">
        <Suspense fallback={null}>
          <LivePoll voterId={tokenData?.id || username || "anon"} />
        </Suspense>
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
