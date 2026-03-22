import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import VideoPlayer from "@/components/VideoPlayer";
import { Shield, Radio, Film, MonitorPlay, MessageCircle, Send, Home } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

type StreamType = "m3u8" | "cloudflare" | "youtube";

const LivePage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tokenCode = searchParams.get("t") || "";
  const [tokenData, setTokenData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [stream, setStream] = useState<any>(null);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<any>(null);
  const [username, setUsername] = useState(() => localStorage.getItem("rt48_username") || "");
  const [showUsernameInput, setShowUsernameInput] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sendingChat, setSendingChat] = useState(false);

  const getFingerprint = () => {
    let fp = localStorage.getItem("rt48_fp");
    if (!fp) { fp = crypto.randomUUID(); localStorage.setItem("rt48_fp", fp); }
    return fp;
  };

  // Auto-detect username
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase.from("profiles").select("username").eq("id", session.user.id).maybeSingle();
        if (profile?.username) {
          setUsername(profile.username);
          localStorage.setItem("rt48_username", profile.username);
        }
      }
      if (!localStorage.getItem("rt48_username")) setShowUsernameInput(true);
    };
    checkAuth();
  }, []);

  // Validate token
  useEffect(() => {
    if (!tokenCode) { setError("no_token"); setLoading(false); return; }

    const validateToken = async () => {
      const { data: validation, error: valErr } = await supabase.rpc("validate_token", { _code: tokenCode });
      if (valErr) { setError("Terjadi kesalahan validasi."); setLoading(false); return; }

      const result = validation as any;
      if (!result.valid) { setError(result.error || "Token tidak valid."); setLoading(false); return; }

      const fingerprint = getFingerprint();
      const { data: sessionResult, error: sessErr } = await supabase.rpc("create_token_session", {
        _token_code: tokenCode, _fingerprint: fingerprint, _user_agent: navigator.userAgent,
      });
      if (sessErr) { setError("Gagal membuat session."); setLoading(false); return; }

      const sessData = sessionResult as any;
      if (!sessData.success) { setError("Batas perangkat tercapai. Tutup tab lain terlebih dahulu."); setLoading(false); return; }

      setTokenData(result);

      const [streamRes, playlistRes] = await Promise.all([
        supabase.from("streams").select("*").limit(1).single(),
        supabase.from("playlists").select("*").eq("is_active", true).order("sort_order"),
      ]);

      if (streamRes.data) setStream(streamRes.data);
      if (playlistRes.data?.length) {
        setPlaylists(playlistRes.data);
        setActivePlaylist(playlistRes.data[0]);
      }
      setLoading(false);
    };
    validateToken();
  }, [tokenCode]);

  // Release session on tab close
  useEffect(() => {
    if (!tokenCode) return;
    const fp = getFingerprint();
    const handleUnload = () => {
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/release_token_session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ _token_code: tokenCode, _fingerprint: fp }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [tokenCode]);

  // Realtime stream status
  useEffect(() => {
    const ch = supabase.channel("live-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "streams" }, (payload: any) => {
        if (payload.new) setStream(payload.new);
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Load chat messages
  useEffect(() => {
    const loadMessages = async () => {
      const { data } = await supabase.from("chat_messages").select("*").eq("is_deleted", false).order("created_at", { ascending: true }).limit(100);
      if (data) setMessages(data);
    };
    loadMessages();

    const ch = supabase.channel("live-chat")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload: any) => {
        if (payload.new && !payload.new.is_deleted) {
          setMessages(prev => [...prev.slice(-99), payload.new]);
        }
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleSendChat = async () => {
    if (!chatInput.trim() || sendingChat) return;
    setSendingChat(true);
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from("chat_messages").insert({
      username: username || "Anonymous",
      message: chatInput.trim(),
      user_id: session?.user?.id || null,
    });
    if (error) toast.error("Gagal mengirim pesan");
    else setChatInput("");
    setSendingChat(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/15 border-2 border-primary/50 flex items-center justify-center shadow-[0_0_16px_hsl(var(--primary)/0.4)] animate-float">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <p className="text-muted-foreground">Memvalidasi akses...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-2xl"
        >
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/15 border-2 border-primary/50 flex items-center justify-center">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-foreground">
            {error === "no_token" ? "Token Diperlukan" : "Akses Ditolak"}
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            {error === "no_token"
              ? "Anda memerlukan token untuk mengakses live streaming. Beli tiket di halaman utama."
              : error}
          </p>
          <a href="/" className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.97]">
            <Home className="h-4 w-4" /> Ke Beranda
          </a>
        </motion.div>
      </div>
    );
  }

  const isLive = stream?.is_live;
  const currentUrl = activePlaylist?.url || stream?.url || "";
  const currentType = (activePlaylist?.type || stream?.type || "m3u8") as StreamType;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <nav className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-bold">Real<span className="text-primary">Time48</span></span>
          </a>
          <div className="flex items-center gap-2">
            {isLive && (
              <span className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-xs font-bold text-destructive animate-pulse">
                <span className="h-2 w-2 rounded-full bg-destructive" /> LIVE
              </span>
            )}
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Player */}
          <div className="lg:col-span-2 space-y-4">
            <div className="relative">
              {isLive && currentUrl ? (
                <VideoPlayer url={currentUrl} type={currentType} />
              ) : (
                <div className="aspect-video rounded-2xl border border-border bg-card flex items-center justify-center">
                  <div className="text-center">
                    <Shield className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
                    <p className="text-muted-foreground font-medium">Streaming sedang offline</p>
                    <p className="text-xs text-muted-foreground mt-1">Tunggu sampai admin memulai live streaming</p>
                  </div>
                </div>
              )}
              {/* Watermark overlay */}
              {isLive && username && (
                <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden select-none">
                  <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-x-16 gap-y-10 -rotate-[25deg] scale-125 opacity-[0.06]">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <span key={i} className="whitespace-nowrap text-lg font-bold text-foreground">{username}</span>
                    ))}
                  </div>
                  <div className="absolute bottom-3 right-3 rounded-md bg-background/40 backdrop-blur-sm px-2 py-1">
                    <span className="text-[10px] font-medium text-foreground/30">{username}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Playlist selector */}
            {playlists.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                {playlists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => setActivePlaylist(pl)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all active:scale-[0.97] ${
                      activePlaylist?.id === pl.id
                        ? "bg-primary text-primary-foreground shadow-md"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    {pl.type === "m3u8" && <Radio className="h-3 w-3" />}
                    {pl.type === "cloudflare" && <Film className="h-3 w-3" />}
                    {pl.type === "youtube" && <MonitorPlay className="h-3 w-3" />}
                    {pl.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Live Chat */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-border bg-card flex flex-col h-[500px] lg:h-[calc(56.25vw*2/3)] lg:max-h-[600px]">
              <div className="border-b border-border px-4 py-3 flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Live Chat</h3>
                <span className="text-[10px] text-muted-foreground ml-auto">{messages.length} pesan</span>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
                {messages.map((msg) => (
                  <div key={msg.id} className="flex gap-2">
                    <span className="font-semibold text-primary text-xs shrink-0">{msg.username}</span>
                    <span className="text-foreground/80 text-xs break-all">{msg.message}</span>
                  </div>
                ))}
                {messages.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground py-8">Belum ada pesan. Mulai obrolan!</p>
                )}
              </div>

              {/* Username input */}
              {showUsernameInput && !username && (
                <div className="border-t border-border p-3">
                  <div className="flex gap-2">
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Masukkan username"
                      className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && username.trim()) {
                          localStorage.setItem("rt48_username", username.trim());
                          setShowUsernameInput(false);
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (username.trim()) {
                          localStorage.setItem("rt48_username", username.trim());
                          setShowUsernameInput(false);
                        }
                      }}
                      className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium active:scale-[0.95]"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}

              {/* Chat input */}
              {(username || !showUsernameInput) && (
                <div className="border-t border-border p-3">
                  <div className="flex gap-2">
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                      placeholder="Ketik pesan..."
                      className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                      maxLength={200}
                    />
                    <button
                      onClick={handleSendChat}
                      disabled={sendingChat || !chatInput.trim()}
                      className="p-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 active:scale-[0.95] transition-all"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LivePage;
