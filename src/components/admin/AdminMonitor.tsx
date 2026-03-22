import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Monitor, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ChatMsg {
  id: string;
  username: string;
  message: string;
  created_at: string;
  is_admin: boolean;
  is_pinned: boolean;
  token_id: string | null;
}

const AdminMonitor = () => {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [viewers, setViewers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("is_deleted", false)
        .order("created_at", { ascending: true })
        .limit(200);
      setMessages(data || []);
      setLoading(false);
    };
    fetchMessages();

    // Realtime subscription for chat
    const channel = supabase
      .channel("admin-monitor-chat")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const newMsg = payload.new as ChatMsg;
          if (!newMsg.is_deleted) {
            setMessages((prev) => [...prev.slice(-199), newMsg]);
          }
        } else if (payload.eventType === "UPDATE") {
          const updated = payload.new as ChatMsg;
          if (updated.is_deleted) {
            setMessages((prev) => prev.filter((m) => m.id !== updated.id));
          } else {
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          }
        } else if (payload.eventType === "DELETE") {
          const old = payload.old as { id: string };
          setMessages((prev) => prev.filter((m) => m.id !== old.id));
        }
      })
      .subscribe();

    // Presence for online viewers
    const presenceChannel = supabase.channel("online-users");
    presenceChannel
      .on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState();
        const names = Object.values(state)
          .flat()
          .map((p: any) => p.username)
          .filter(Boolean);
        setViewers([...new Set(names)]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(presenceChannel);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const resetChat = async () => {
    if (!confirm("Hapus semua pesan chat? Tindakan ini tidak bisa dibatalkan.")) return;
    const { error } = await supabase.from("chat_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      toast.error("Gagal reset chat: " + error.message);
    } else {
      setMessages([]);
      toast.success("Live chat berhasil direset");
    }
  };

  const formatTime = (d: string) => new Date(d).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Monitor className="h-5 w-5 text-primary" /> Monitor
        </h2>
        <Button variant="destructive" size="sm" onClick={resetChat} className="gap-2">
          <Trash2 className="h-4 w-4" /> Reset Live Chat
        </Button>
      </div>

      {/* Chat preview */}
      <div className="rounded-xl border border-border bg-black/80 h-[400px] overflow-y-auto p-3 space-y-1">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-12">Belum ada pesan</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="text-sm leading-relaxed">
              <span className="font-semibold text-primary">{msg.username}</span>
              {msg.is_admin && (
                <span className="ml-1 text-[10px] bg-destructive/20 text-destructive px-1 rounded">ADMIN</span>
              )}
              <span className="text-muted-foreground text-[10px] ml-1">{formatTime(msg.created_at)}</span>
              <span className="text-foreground ml-2">{msg.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Online viewers */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Users className="h-3 w-3" /> Online:
        </span>
        {viewers.length === 0 ? (
          <span className="text-xs text-muted-foreground">Tidak ada viewer online</span>
        ) : (
          viewers.map((v) => (
            <span key={v} className="rounded-full bg-primary/10 text-primary text-xs px-3 py-1 font-medium">
              {v}
            </span>
          ))
        )}
      </div>
    </div>
  );
};

export default AdminMonitor;
