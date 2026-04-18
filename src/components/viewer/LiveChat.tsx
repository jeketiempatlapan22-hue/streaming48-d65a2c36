import { useState, useEffect, useRef, useCallback, useTransition, memo, useReducer } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, Pin, Trash2, ShieldBan, ShieldPlus, ShieldMinus, Trophy, UserX, Reply } from "lucide-react";
import ChatLeaderboard from "@/components/viewer/ChatLeaderboard";
import { formatTimeWIB, getUserZoneLabel, isUserOutsideWIB } from "@/lib/timeFormat";


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
  is_deleted: boolean;
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

const ChatMessageItem = memo(({ msg, isAdmin, isChatMod, chatModUsernames, currentUsername, onPin, onDelete, onBlock, onToggleMod, onBanUser, onReply, formatTime }: {
  msg: ChatMessage;
  isAdmin: boolean;
  isChatMod: boolean;
  chatModUsernames: Set<string>;
  currentUsername: string;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onBlock?: (tokenId: string) => void;
  onToggleMod?: (username: string, isMod: boolean) => void;
  onBanUser?: (username: string) => void;
  onReply: (username: string) => void;
  formatTime: (d: string) => string;
}) => {
  const canModerate = isAdmin || isChatMod;
  const isMsgFromMod = chatModUsernames.has(msg.username);
  const isOwnMessage = currentUsername && msg.username === currentUsername;

  // Parse @mention prefix at start of message for highlight
  const mentionMatch = msg.message.match(/^@(\S+)\s+([\s\S]*)$/);
  const mentionedUser = mentionMatch?.[1];
  const restMessage = mentionMatch ? mentionMatch[2] : msg.message;
  const isMentioningMe = mentionedUser && currentUsername && mentionedUser.toLowerCase() === currentUsername.toLowerCase();

  return (
    <div className={`group flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary/30 ${isMentioningMe ? "bg-primary/10 border-l-2 border-primary" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => !isOwnMessage && onReply(msg.username)}
            className={`text-xs font-bold transition-colors ${isOwnMessage ? "cursor-default" : "cursor-pointer hover:underline"} ${msg.is_admin ? "text-yellow-400" : isMsgFromMod ? "text-cyan-400" : "text-foreground/90"}`}
            title={isOwnMessage ? "" : `Balas ke ${msg.username}`}
          >
            {msg.username}
          </button>
          {msg.is_admin && <AdminBadge />}
          {!msg.is_admin && isMsgFromMod && <ModeratorBadge />}
          <span className="text-[10px] text-muted-foreground/60">{formatTime(msg.created_at)}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed break-words">
          {mentionedUser && (
            <span className={`font-semibold ${isMentioningMe ? "text-primary" : "text-cyan-400/80"}`}>@{mentionedUser}</span>
          )}
          {mentionedUser ? " " : ""}
          {restMessage}
        </p>
      </div>
      <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        {!isOwnMessage && (
          <button onClick={() => onReply(msg.username)} className="rounded p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary" title={`Balas ${msg.username}`}>
            <Reply className="h-3 w-3" />
          </button>
        )}
        {canModerate && (
          <>
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
          </>
        )}
      </div>
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
  
  const [chatModUsernames, setChatModUsernames] = useState<Set<string>>(new Set());
  const [chatEnabled, setChatEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const lastSentRef = useRef(0);
  const [reconnectKey, forceReconnect] = useReducer((x: number) => x + 1, 0);
  // Track IDs we've seen to prevent duplicates
  const seenIdsRef = useRef(new Set<string>());
  // Track optimistic messages for dedup
  const optimisticRef = useRef(new Map<string, string>()); // optimisticId -> message content key
  // Track whether user is scrolled to bottom (so we don't yank them down)
  const isAtBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const isChatMod = chatModUsernames.has(username);

  const scrollToBottom = useCallback((force = false) => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      if (force || isAtBottomRef.current) {
        el.scrollTop = el.scrollHeight;
        isAtBottomRef.current = true;
        setShowJumpToBottom(false);
      }
    });
  }, []);

  // Track scroll position so auto-scroll only kicks in when user is at the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom < 80; // 80px tolerance
      isAtBottomRef.current = atBottom;
      setShowJumpToBottom(!atBottom);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const syncMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error || !data) return;

    const sorted = (data as unknown as ChatMessage[]).reverse();
    // Update seen IDs
    const newSeenIds = new Set<string>();
    sorted.forEach((m) => newSeenIds.add(m.id));
    seenIdsRef.current = newSeenIds;
    // Clear any remaining optimistic messages since we have fresh data
    optimisticRef.current.clear();

    startTransition(() => {
      setMessages(sorted);
      setPinnedMessages(sorted.filter((m) => m.is_pinned));
    });
  }, [startTransition]);

  const syncChatModerators = useCallback(async () => {
    const { data } = await supabase.from("chat_moderators").select("username");
    if (data) {
      setChatModUsernames(new Set(data.map((m: any) => m.username)));
    }
  }, []);

  const syncChatEnabled = useCallback(async () => {
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "chat_enabled")
      .maybeSingle();

    if (data) {
      setChatEnabled(data.value !== "false");
    }
  }, []);

  // Get current user id
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id || null);
    });
  }, []);

  // Load initial data + realtime subscription (reconnects on error)
  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        await Promise.allSettled([
          syncChatEnabled(),
          syncChatModerators(),
          syncMessages(),
        ]);
      } catch (e) {
        console.warn("[LiveChat] init error:", e);
      }
    };
    init();

    // Realtime channel with auto-reconnect on error
    const channel = supabase
      .channel(`chat-main-${reconnectKey}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        if (!isMounted) return;
        const newMsg = payload.new as ChatMessage;
        if (newMsg.is_deleted) return;
        // Skip if already seen (from syncMessages)
        if (seenIdsRef.current.has(newMsg.id)) return;
        seenIdsRef.current.add(newMsg.id);

        startTransition(() => {
          setMessages((prev) => {
            // Check if this real message matches any optimistic message
            const contentKey = `${newMsg.username}::${newMsg.message}`;
            let filtered = prev;
            // Find and remove matching optimistic message
            for (const [optId, optKey] of optimisticRef.current.entries()) {
              if (optKey === contentKey) {
                filtered = prev.filter((m) => m.id !== optId);
                optimisticRef.current.delete(optId);
                break;
              }
            }
            // Don't add if already exists by ID
            if (filtered.some((m) => m.id === newMsg.id)) return filtered;
            const next = [...filtered, newMsg];
            return next.length > 20 ? next.slice(-20) : next;
          });
          if (newMsg.is_pinned) setPinnedMessages((prev) => [...prev, newMsg]);
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" }, (payload) => {
        if (!isMounted) return;
        startTransition(() => {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
          setPinnedMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, (payload) => {
        if (!isMounted) return;
        startTransition(() => {
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
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "site_settings", filter: "key=eq.chat_enabled" }, (payload: any) => {
        if (!isMounted) return;
        if (payload.new?.value !== undefined) {
          setChatEnabled(payload.new.value !== "false");
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && isMounted) {
          void syncMessages();
        }
        if (status === "CHANNEL_ERROR" && isMounted) {
          console.warn("[LiveChat] Realtime error, will reconnect in 5s...");
          setTimeout(() => {
            if (isMounted) forceReconnect();
          }, 5000);
        }
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [reconnectKey, syncChatEnabled, syncChatModerators, syncMessages, startTransition]);

  useEffect(() => {
    let intervalId: number;

    const startPolling = () => {
      if (intervalId) window.clearInterval(intervalId);
      const intervalMs = document.visibilityState === "visible" ? 6000 : 15000;
      intervalId = window.setInterval(() => {
        void syncMessages();
      }, intervalMs);
    };

    startPolling();
    document.addEventListener("visibilitychange", startPolling);

    return () => {
      if (intervalId) window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", startPolling);
    };
  }, [syncMessages]);

  useEffect(() => {
    void syncChatModerators();
    void syncChatEnabled();

    const intervalId = window.setInterval(() => {
      void syncChatModerators();
      void syncChatEnabled();
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [syncChatEnabled, syncChatModerators]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !username) return;
    const now = Date.now();
    if (now - lastSentRef.current < 3000) return; // 3s cooldown
    lastSentRef.current = now;
    const trimmed = newMessage.trim().slice(0, 200); // 200 char limit
    setSending(true);
    setNewMessage("");

    // Optimistic update - show message immediately
    const optimisticId = `opt-${now}`;
    const contentKey = `${username}::${trimmed}`;
    optimisticRef.current.set(optimisticId, contentKey);

    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      username,
      message: trimmed,
      is_pinned: false,
      is_admin: isAdmin,
      is_deleted: false,
      token_id: tokenId || null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => {
      const next = [...prev, optimisticMsg];
      return next.length > 20 ? next.slice(-20) : next;
    });
    // Force scroll to bottom when user sends a message
    isAtBottomRef.current = true;
    scrollToBottom(true);

    const insertData: any = { username, message: trimmed, token_id: tokenId || null };
    if (currentUserId) insertData.user_id = currentUserId;
    if (isAdmin) insertData.is_admin = true;
    const { error } = await supabase.from("chat_messages").insert(insertData);
    if (error) {
      console.error("[LiveChat] send error:", error);
      // Remove optimistic message on failure
      optimisticRef.current.delete(optimisticId);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    }
    // Don't call syncMessages here - realtime INSERT event will handle dedup
    setSending(false);
    inputRef.current?.focus();
  }, [newMessage, username, tokenId, isAdmin, currentUserId]);

  const handlePin = useCallback(async (id: string) => {
    if (onPinMessage) {
      await Promise.resolve(onPinMessage(id));
      await syncMessages();
      return;
    }
    const msg = messages.find((m) => m.id === id);
    if (msg) {
      await supabase.from("chat_messages").update({ is_pinned: !msg.is_pinned } as any).eq("id", id);
      await syncMessages();
    }
  }, [messages, onPinMessage, syncMessages]);

  const handleDelete = useCallback(async (id: string) => {
    if (onDeleteMessage) {
      await Promise.resolve(onDeleteMessage(id));
      await syncMessages();
      return;
    }
    await supabase.from("chat_messages").delete().eq("id", id);
    await syncMessages();
  }, [onDeleteMessage, syncMessages]);

  const formatTime = useCallback((dateStr: string) => formatTimeWIB(dateStr), []);

  const handleReply = useCallback((toUsername: string) => {
    if (!toUsername) return;
    setNewMessage((prev) => {
      const stripped = prev.replace(/^@\S+\s+/, "");
      return `@${toUsername} ${stripped}`;
    });
    inputRef.current?.focus();
  }, []);

  const zoneLabel = getUserZoneLabel();
  const showZoneHint = isUserOutsideWIB();

  return (
    <div className="relative flex h-full flex-col bg-card/50">
      <ChatLeaderboard isOpen={showLeaderboard} onClose={() => setShowLeaderboard(false)} />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <span className="text-sm">💬</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Live Chat</h3>
            {!isLive && <p className="text-[10px] text-yellow-500">Stream offline · chat tetap aktif</p>}
            {showZoneHint && <p className="text-[9px] text-muted-foreground/70">Waktu: WIB · zona Anda {zoneLabel}</p>}
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
        </div>
      </div>

      {/* Pinned */}
      {pinnedMessages.length > 0 && (
        <div className="border-b border-primary/20 bg-primary/5 px-4 py-2 space-y-1 shrink-0">
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

      {/* Messages - scrollable area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 space-y-0.5"
        style={{ minHeight: 0 }}
      >
        {messages.map((msg) => (
          <ChatMessageItem key={msg.id} msg={msg} isAdmin={isAdmin} isChatMod={isChatMod} chatModUsernames={chatModUsernames} currentUsername={username} onPin={handlePin} onDelete={handleDelete} onBlock={onBlockUser} onToggleMod={onToggleChatMod} onBanUser={onBanUser} onReply={handleReply} formatTime={formatTime} />
        ))}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-3xl">💬</span>
            <p className="mt-2 text-xs text-muted-foreground">Belum ada pesan. Mulai percakapan!</p>
          </div>
        )}
      </div>


      {/* Chat disabled banner for non-admin */}
      {!chatEnabled && !isAdmin && (
        <div className="border-t border-border bg-destructive/5 px-4 py-3 text-center shrink-0">
          <p className="text-xs font-medium text-destructive">🔇 Chat sedang dinonaktifkan oleh admin</p>
        </div>
      )}

      {/* Input - hidden for non-admin when chat disabled */}
      {(chatEnabled || isAdmin) && (
        <form onSubmit={sendMessage} className="flex items-center gap-2 border-t border-border bg-card p-3 shrink-0">
          <Input ref={inputRef} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder={!chatEnabled && isAdmin ? "Chat nonaktif — hanya admin yang bisa kirim" : username ? "Ketik pesan..." : "Masukkan username dulu"} disabled={!username || sending} className="flex-1 border-secondary bg-secondary/50 text-sm placeholder:text-muted-foreground/50 focus:bg-background" />
          <Button type="submit" size="icon" disabled={!username || sending || !newMessage.trim()} className="h-10 w-10 shrink-0 rounded-lg">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  );
};

export default LiveChat;
