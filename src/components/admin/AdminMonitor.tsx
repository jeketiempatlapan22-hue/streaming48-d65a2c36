import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import ErrorBoundary from "@/components/ErrorBoundary";
import LiveViewerCount from "@/components/viewer/LiveViewerCount";
import PlaylistSwitcher from "@/components/viewer/PlaylistSwitcher";
import { useAdminSignedStreamUrl } from "@/hooks/useAdminSignedStreamUrl";
import { useProxyStream } from "@/hooks/useProxyStream";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const VideoPlayer = lazy(() => import("@/components/VideoPlayer"));
const LiveChat = lazy(() => import("@/components/viewer/LiveChat"));
const ChatModeratorManager = lazy(() => import("@/components/admin/ChatModeratorManager"));
const MonitorPollSection = lazy(() => import("@/components/admin/MonitorPollSection"));
const MonitorQuizSection = lazy(() => import("@/components/admin/MonitorQuizSection"));

const SectionFallback = ({ label }: { label: string }) => (
  <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
    {label}…
  </div>
);

const SectionError = ({ label }: { label: string }) => (
  <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-xs text-destructive">
    Bagian "{label}" gagal dimuat. Coba refresh halaman.
  </div>
);

const AdminMonitor = () => {
  const [stream, setStream] = useState<any>(null);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<any>(null);
  const [resetting, setResetting] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [externalShowId, setExternalShowId] = useState<string | null>(null);

  // Stable random channel id per component lifetime to avoid duplicate subscriptions
  const channelIdRef = useRef<string>(Math.random().toString(36).slice(2, 10));
  const activePlaylistTypeRef = useRef<string | null>(null);

  const isProxyPlaylist = activePlaylist?.type === "proxy";
  const isDirectPlaylist = activePlaylist?.type === "direct";

  useEffect(() => {
    activePlaylistTypeRef.current = activePlaylist?.type ?? null;
  }, [activePlaylist?.type]);

  const { signedUrl, loading: previewLoading, error: previewError, proxyType } = useAdminSignedStreamUrl(
    activePlaylist && !isProxyPlaylist && !isDirectPlaylist
      ? { id: activePlaylist.id, type: activePlaylist.type, url: activePlaylist.url }
      : null,
    previewRefreshKey
  );

  const { playbackUrl: proxyUrl, customHeadersRef: proxyHeadersRef, loading: proxyLoading, error: proxyError } = useProxyStream(
    isProxyPlaylist,
    externalShowId,
    previewRefreshKey
  );

  const effectivePreviewUrl = isDirectPlaylist
    ? activePlaylist?.url
    : isProxyPlaylist ? proxyUrl : signedUrl;
  const effectivePreviewLoading = isDirectPlaylist ? false : (isProxyPlaylist ? proxyLoading : previewLoading);
  const effectivePreviewError = isDirectPlaylist ? null : (isProxyPlaylist ? proxyError : previewError);
  const effectivePreviewType = (isDirectPlaylist || isProxyPlaylist) ? "m3u8" : (proxyType || activePlaylist?.type || "m3u8");

  const syncPlaylists = useCallback((nextPlaylists: any[]) => {
    setPlaylists(nextPlaylists);
    setActivePlaylist((prev: any) => {
      if (!nextPlaylists.length) return null;
      if (!prev) return nextPlaylists[0];
      return nextPlaylists.find((item: any) => item.id === prev.id) || nextPlaylists[0];
    });
  }, []);

  const fetchMonitorData = useCallback(async () => {
    const [streamRes, playlistRes, settingsRes] = await Promise.all([
      supabase.from("streams").select("*").limit(1).maybeSingle(),
      supabase.from("playlists").select("*").order("sort_order"),
      supabase.from("site_settings").select("*").eq("key", "active_show_id").maybeSingle(),
    ]);

    setStream(streamRes.data || null);

    const activeShowId = settingsRes.data?.value;
    if (activeShowId) {
      const { data: showData } = await supabase
        .from("shows")
        .select("external_show_id")
        .eq("id", activeShowId)
        .maybeSingle();
      if (showData?.external_show_id) setExternalShowId(showData.external_show_id);
      else setExternalShowId(null);
    } else {
      setExternalShowId(null);
    }

    syncPlaylists(playlistRes.data || []);
  }, [syncPlaylists]);

  useEffect(() => {
    void fetchMonitorData();

    const channelName = `monitor-stream-rt-${channelIdRef.current}`;
    const ch = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "streams" }, () => {
        void fetchMonitorData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "playlists" }, () => {
        void fetchMonitorData();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "site_settings" }, (payload: any) => {
        if (payload.new?.key === "active_show_id") {
          void fetchMonitorData();
          setPreviewRefreshKey((value) => value + 1);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shows" }, () => {
        if (activePlaylistTypeRef.current === "proxy") {
          setPreviewRefreshKey((value) => value + 1);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // Intentionally only run once per mount to avoid resubscribing on playlist switches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResetChat = async () => {
    setResetting(true);
    const { error } = await supabase.from("chat_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setResetting(false);
    if (error) {
      toast.error("Gagal mereset chat");
    } else {
      toast.success("Live chat berhasil direset");
    }
  };

  const handleBlockUser = async (tokenId: string) => {
    await supabase.from("tokens").update({ status: "blocked" }).eq("id", tokenId);
    toast.success("User diblokir");
  };

  const handlePinMessage = async (id: string) => {
    const { data: msg } = await supabase.from("chat_messages").select("is_pinned").eq("id", id).single();
    if (msg) {
      await supabase.from("chat_messages").update({ is_pinned: !msg.is_pinned }).eq("id", id);
    }
  };

  const handleDeleteMessage = async (id: string) => {
    await supabase.from("chat_messages").delete().eq("id", id);
  };

  const handleToggleChatMod = async (uname: string, isMod: boolean) => {
    if (isMod) {
      await supabase.from("chat_moderators").delete().eq("username", uname);
      toast.success(`${uname} dihapus dari moderator`);
    } else {
      const { error } = await supabase.from("chat_moderators").insert({ username: uname });
      if (!error) toast.success(`${uname} dijadikan moderator`);
    }
  };

  const handleBanByUsername = async (chatUsername: string) => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", chatUsername)
      .single();

    if (!profile) {
      toast.error(`User "${chatUsername}" tidak ditemukan di database`);
      return;
    }

    const userId = profile.id;

    const { error: banError } = await supabase
      .from("user_bans")
      .upsert(
        { user_id: userId, is_active: true, reason: "Diblokir dari live chat oleh admin", banned_by: "admin" },
        { onConflict: "user_id" }
      );

    if (banError) {
      toast.error("Gagal memblokir user: " + banError.message);
      return;
    }

    await supabase.from("tokens").update({ status: "blocked" } as any).eq("user_id", userId).eq("status", "active");

    toast.success(`User "${chatUsername}" telah diblokir dan semua tokennya dicabut`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">📺 Monitor, Poll & Quiz</h2>
          <p className="text-sm text-muted-foreground">Preview player, chat, poll, dan quiz live secara realtime dalam satu halaman.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveViewerCount isLive={stream?.is_live || false} readOnly />
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${stream?.is_live ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
            {stream?.is_live ? "LIVE" : "OFFLINE"}
          </span>
        </div>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={resetting} className="gap-2">
            <Trash2 className="h-4 w-4" />
            {resetting ? "Mereset..." : "Reset Live Chat"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Live Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua pesan chat (termasuk yang di-pin) akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetChat}>Ya, Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <div className="min-w-0 space-y-3">
          <div className="rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-3 py-2 sm:px-4 sm:py-3">
              <p className="text-sm font-semibold text-foreground">Preview Player</p>
              <p className="text-xs text-muted-foreground">Semua tipe player termasuk Proxy Stream akan diputar dari sini.</p>
            </div>
            <div className="p-1.5 sm:p-2">
              <div className="rounded-xl border border-border overflow-hidden">
                <ErrorBoundary fallback={<SectionError label="Preview Player" />}>
                  {activePlaylist ? (
                    effectivePreviewUrl ? (
                      <Suspense fallback={<div className="flex aspect-video items-center justify-center bg-card"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
                        <VideoPlayer
                          key={`${activePlaylist.id}-${previewRefreshKey}-${effectivePreviewType}`}
                          playlist={{ url: effectivePreviewUrl, type: effectivePreviewType, label: activePlaylist.title }}
                          autoPlay
                          customHeadersRef={isProxyPlaylist ? proxyHeadersRef : undefined}
                        />
                      </Suspense>
                    ) : effectivePreviewLoading ? (
                      <div className="flex aspect-video items-center justify-center bg-card">
                        <div className="flex flex-col items-center gap-2">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          <p className="text-sm text-muted-foreground">Menyiapkan preview player...</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-card px-4 text-center">
                        <p className="text-sm text-destructive">{effectivePreviewError || "Preview player belum tersedia."}</p>
                      </div>
                    )
                  ) : (
                    <div className="flex aspect-video items-center justify-center bg-card px-4 text-center">
                      <p className="text-sm text-muted-foreground">Belum ada playlist untuk dipreview.</p>
                    </div>
                  )}
                </ErrorBoundary>
              </div>
            </div>
            <div className="border-t border-border px-2 py-2 sm:px-3 sm:py-3">
              <PlaylistSwitcher
                playlists={playlists}
                activePlaylistId={activePlaylist?.id ?? null}
                onSelect={(playlist) => {
                  setActivePlaylist(playlist);
                  if (playlist.type === "proxy") {
                    setPreviewRefreshKey((value) => value + 1);
                  }
                }}
              />
            </div>
          </div>
        </div>

        <div className="h-[500px] overflow-hidden rounded-2xl border border-border">
          <ErrorBoundary fallback={<SectionError label="Live Chat" />}>
            <Suspense fallback={<SectionFallback label="Memuat Live Chat" />}>
              <LiveChat
                username="Admin"
                isLive={stream?.is_live || false}
                isAdmin={true}
                onPinMessage={handlePinMessage}
                onDeleteMessage={handleDeleteMessage}
                onBlockUser={handleBlockUser}
                onToggleChatMod={handleToggleChatMod}
                onBanUser={handleBanByUsername}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>

      <ErrorBoundary fallback={<SectionError label="Poll" />}>
        <Suspense fallback={<SectionFallback label="Memuat Poll" />}>
          <MonitorPollSection />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<SectionError label="Quiz" />}>
        <Suspense fallback={<SectionFallback label="Memuat Quiz" />}>
          <MonitorQuizSection />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<SectionError label="Moderator Chat" />}>
        <Suspense fallback={<SectionFallback label="Memuat moderator" />}>
          <ChatModeratorManager />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
};

export default AdminMonitor;
