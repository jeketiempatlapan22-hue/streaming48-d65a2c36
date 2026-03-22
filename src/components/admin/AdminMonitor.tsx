import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import VideoPlayer from "@/components/VideoPlayer";
import LiveChat from "@/components/viewer/LiveChat";
import ChatModeratorManager from "@/components/admin/ChatModeratorManager";
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

const AdminMonitor = () => {
  const [stream, setStream] = useState<any>(null);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<any>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const { data: streamData } = await supabase.from("streams").select("*").limit(1).single();
      setStream(streamData);

      const { data: playlistData } = await supabase.from("playlists").select("*").order("sort_order");
      const priority: Record<string, number> = { m3u8: 0, cloudflare: 1, youtube: 2 };
      const sorted = (playlistData || []).sort((a: any, b: any) => {
        const pa = priority[a.type] ?? 1;
        const pb = priority[b.type] ?? 1;
        if (pa !== pb) return pa - pb;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      });
      setPlaylists(sorted);
      if (sorted.length > 0) setActivePlaylist(sorted[0]);
    };
    fetchData();

    // Realtime stream updates
    const ch = supabase.channel("monitor-stream-rt").on("postgres_changes", { event: "*", schema: "public", table: "streams" }, (p: any) => {
      if (p.new) setStream(p.new);
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
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

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-foreground">📺 Monitor</h2>

      {/* Reset Chat */}
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

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Player */}
        <div className="space-y-2">
          <div className="rounded-xl border border-border overflow-hidden">
            {activePlaylist ? (
              <VideoPlayer url={activePlaylist.url} type={activePlaylist.type} />
            ) : (
              <div className="flex aspect-video items-center justify-center bg-card">
                <p className="text-sm text-muted-foreground">Tidak ada sumber video</p>
              </div>
            )}
          </div>
          {playlists.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {playlists.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActivePlaylist(p)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    activePlaylist?.id === p.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  {p.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Chat */}
        <div className="h-[500px] rounded-xl border border-border overflow-hidden">
          <LiveChat
            username="Admin"
            isLive={stream?.is_live || false}
            isAdmin={true}
            onPinMessage={handlePinMessage}
            onDeleteMessage={handleDeleteMessage}
            onBlockUser={handleBlockUser}
            onToggleChatMod={handleToggleChatMod}
          />
        </div>
      </div>

      {/* Chat Moderator */}
      <ChatModeratorManager />
    </div>
  );
};

export default AdminMonitor;
