import { useState, useEffect, useRef, useCallback, useTransition, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Pin, Trash2, ShieldBan, ShieldPlus, ShieldMinus, Users, Trophy, UserX } from "lucide-react";
import ChatLeaderboard from "@/components/viewer/ChatLeaderboard";


interface LiveChatProps {
  username: string;
  tokenId?: string;
  isLive: boolean;
  isAdmin: boolean;
  onPinMessage?: (id: string) => void;
  onDeleteMessage?: (id: string) => void;
  onBlockUser?: (tokenId: string) => void;
  onToggleChatMod?: (username: string, isMod: boolean) => void;
  onBanUser?: (username: string) => void;
}

interface ChatMessage {
  id: string;
  username: string;
  message: string;
  is_pinned: boolean;
  is_admin: boolean;
  token_id: string | null;
  created_at: string;
}

const AdminBadge = () => (
  <span className="inline-flex items-center gap-0.5 rounded-md bg-gradient-to-r from-yellow-500/20 via-amber-400/20 to-yellow-600/20 border border-yellow-500/40 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-yellow-400 shadow-[0_0_6px_hsl(45,100%,50%,0.2)]">
    <span className="text-[8px]">🚩</span>ADMIN
  </span>
);

const ModeratorBadge = () => (
  <span className="inline-flex items-center gap-0.5 rounded-md bg-gradient-to-r from-cyan-500/15 via-blue-500/15 to-purple-500/15 border border-cyan-400/30 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-cyan-400">
    <span className="text-[8px]">🛡️</span>MOD
  </span>
);

const ChatMessageItem = memo(({ msg, isAdmin, isChatMod, chatModUsernames, onPin, onDelete, onBlock, onToggleMod, onBanUser, formatTime }: {
  msg: ChatMessage;
  isAdmin: boolean;
  isChatMod: boolean;
  chatModUsernames: Set<string>;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onBlock?: (tokenId: string) => void;
  onToggleMod?: (username: string, isMod: boolean) => void;
  onBanUser?: (username: string) => void;
  formatTime: (d: string) => string;
}) => {
  const canModerate = isAdmin || isChatMod;
  const isMsgFromMod = chatModUsernames.has(msg.username);

  return (
    <div className="group flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary/30">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-xs font-bold ${msg.is_admin ? "text-yellow-400" : isMsgFromMod ? "text-cyan-400" : "text-foreground/90"}`}>
            {msg.username}
          </span>
          {msg.is_admin && <AdminBadge />}
          {!msg.is_admin && isMsgFromMod && <ModeratorBadge />}
          <span className="text-[10px] text-muted-foreground/60">{formatTime(msg.created_at)}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed break-words">{msg.message}</p>
      </div>
      {canModerate && (
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {isAdmin && (
            <button onClick={() => onPin(msg.id)} className="rounded p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Pin">
              <Pin className="h-3 w-3" />
            </button>
          )}
          <button onClick={() => onDelete(msg.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Hapus">
            <Trash2 className="h-3 w-3" />
          </button>
          {msg.token_id && onBlock && (
            <button onClick={() => onBlock(msg.token_id!)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Blokir">
              <ShieldBan className="h-3 w-3" />
            </button>
          )}
          {isAdmin && !msg.is_admin && onToggleMod && (
            <button
              onClick={() => onToggleMod(msg.username, isMsgFromMod)}
              className={`rounded p-1 text-muted-foreground ${isMsgFromMod ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-cyan-500/10 hover:text-cyan-400"}`}
              title={isMsgFromMod ? "Hapus Moderator" : "Jadikan Moderator"}
            >
              {isMsgFromMod ? <ShieldMinus className="h-3 w-3" /> : <ShieldPlus className="h-3 w-3" />}
            </button>
          )}
          {isAdmin && !msg.is_admin && onBanUser && (
            <button
              onClick={() => {
                if (confirm(`Ban user "${msg.username}"? User akan langsung dikeluarkan dan tidak bisa akses lagi.`)) {
                  onBanUser(msg.username);
                }
              }}
              className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
              title="Ban User"
            >
              <UserX className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});
ChatMessageItem.displayName = "ChatMessageItem";

const LiveChat = ({ username, tokenId, isLive, isAdmin, onPinMessage, onDeleteMessage, onBlockUser, onToggleChatMod, onBanUser }: LiveChatProps) => {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [chatModUsernames, setChatModUsernames] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const lastSentRef = useRef(0);

  const isChatMod = chatModUsernames.has(username);

  // Get current user id
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id || null);
    });
  }, []);

  // Load chat moderators
  useEffect(() => {
    const fetchMods = async () => {
      const { data } = await supabase.from("chat_moderators").select("username");
      if (data) setChatModUsernames(new Set(data.map((m: any) => m.username)));
    };
    fetchMods();
    const channel = supabase.channel("chat-mods-realtime").on("postgres_changes", { event: "*", schema: "public", table: "chat_moderators" }, () => fetchMods()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Poll viewer count from DB (replaces heavy presence channel)
  useEffect(() => {
    const fetchCount = async () => {
      const { data } = await supabase.rpc("get_viewer_count");
      if (typeof data === "number") startTransition(() => setOnlineCount(data));
    };
    fetchCount();
    const interval = setInterval(fetchCount, 20_000);
    return () => clearInterval(interval);
  }, []);

  // Load messages + realtime
  useEffect(() => {
    const fetchMessages = async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) {
        const sorted = (data as unknown as ChatMessage[]).reverse();
        startTransition(() => {
          setMessages(sorted);
          setPinnedMessages(sorted.filter((m) => m.is_pinned));
        });
      }
    };
    fetchMessages();

    const channel = supabase
      .channel("chat-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, (payload) => {
        startTransition(() => {
          if (payload.eventType === "INSERT") {
            const newMsg = payload.new as ChatMessage;
            if (newMsg.is_deleted) return;
            setMessages((prev) => {
              const next = [...prev, newMsg];
              // Keep only latest 20 messages
              return next.length > 20 ? next.slice(-20) : next;
            });
            if (newMsg.is_pinned) setPinnedMessages((prev) => [...prev, newMsg]);
          } else if (payload.eventType === "DELETE") {
            setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
            setPinnedMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as ChatMessage;
            if (updated.is_deleted) {
              setMessages((prev) => prev.filter((m) => m.id !== updated.id));
              setPinnedMessages((prev) => prev.filter((m) => m.id !== updated.id));
              return;
            }
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
            if (updated.is_pinned) {
              setPinnedMessages((prev) => {
                const exists = prev.find((m) => m.id === updated.id);
                return exists ? prev.map((m) => (m.id === updated.id ? updated : m)) : [...prev, updated];
              });
            } else {
              setPinnedMessages((prev) => prev.filter((m) => m.id !== updated.id));
            }
          }
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !username) return;
    const now = Date.now();
    if (now - lastSentRef.current < 3000) return; // 3s cooldown
    lastSentRef.current = now;
    const trimmed = newMessage.trim().slice(0, 200); // 200 char limit
    lastSentRef.current = now;
    setSending(true);
    const insertData: any = { username, message: trimmed, token_id: tokenId || null };
    if (currentUserId) insertData.user_id = currentUserId;
    if (isAdmin) insertData.is_admin = true;
    await supabase.from("chat_messages").insert(insertData);
    setNewMessage("");
    setSending(false);
    inputRef.current?.focus();
  }, [newMessage, username, tokenId, isAdmin, currentUserId]);

  const handlePin = useCallback(async (id: string) => {
    if (onPinMessage) { onPinMessage(id); return; }
    const msg = messages.find((m) => m.id === id);
    if (msg) await supabase.from("chat_messages").update({ is_pinned: !msg.is_pinned } as any).eq("id", id);
  }, [messages, onPinMessage]);

  const handleDelete = useCallback(async (id: string) => {
    if (onDeleteMessage) { onDeleteMessage(id); return; }
    await supabase.from("chat_messages").delete().eq("id", id);
  }, [onDeleteMessage]);

  const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="relative flex h-full flex-col bg-card/50">
      <ChatLeaderboard isOpen={showLeaderboard} onClose={() => setShowLeaderboard(false)} />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <span className="text-sm">💬</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Live Chat</h3>
            {!isLive && <p className="text-[10px] text-yellow-500">Stream offline · chat tetap aktif</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            className={`flex items-center justify-center rounded-full p-1.5 transition ${showLeaderboard ? "bg-yellow-500/20 text-yellow-500" : "text-muted-foreground hover:text-yellow-500 hover:bg-yellow-500/10"}`}
            title="Leaderboard"
          >
            <Trophy className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-1.5 rounded-full bg-[hsl(var(--success))]/10 px-2.5 py-1">
            <Users className="h-3 w-3 text-[hsl(var(--success))]" />
            <span className="text-xs font-bold text-[hsl(var(--success))]">{onlineCount}</span>
          </div>
        </div>
      </div>

      {/* Pinned */}
      {pinnedMessages.length > 0 && (
        <div className="border-b border-primary/20 bg-primary/5 px-4 py-2 space-y-1">
          {pinnedMessages.map((m) => (
            <div key={m.id} className="flex items-start gap-2 text-xs">
              <Pin className="mt-0.5 h-3 w-3 text-primary shrink-0" />
              <div>
                <span className="font-bold text-primary">{m.username}</span>
                <span className="ml-1 text-foreground/80">{m.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5">
        {messages.map((msg) => (
          <ChatMessageItem key={msg.id} msg={msg} isAdmin={isAdmin} isChatMod={isChatMod} chatModUsernames={chatModUsernames} onPin={handlePin} onDelete={handleDelete} onBlock={onBlockUser} onToggleMod={onToggleChatMod} onBanUser={onBanUser} formatTime={formatTime} />
        ))}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-3xl">💬</span>
            <p className="mt-2 text-xs text-muted-foreground">Belum ada pesan. Mulai percakapan!</p>
          </div>
        )}
      </div>


      {/* Input */}
      <form onSubmit={sendMessage} className="flex items-center gap-2 border-t border-border bg-card p-3">
        <Input ref={inputRef} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder={username ? "Ketik pesan..." : "Masukkan username dulu"} disabled={!username || sending} className="flex-1 border-secondary bg-secondary/50 text-sm placeholder:text-muted-foreground/50 focus:bg-background" />
        <Button type="submit" size="icon" disabled={!username || sending || !newMessage.trim()} className="h-10 w-10 shrink-0 rounded-lg">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
};

export default LiveChat;
