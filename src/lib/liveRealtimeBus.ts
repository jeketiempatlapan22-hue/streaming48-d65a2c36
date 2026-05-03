/**
 * Consolidated realtime bus for the viewer-side LivePage.
 *
 * Goal: collapse separate channels (chat, polls, poll_votes, quizzes,
 * quiz_winners, site_settings.chat_enabled) into ONE Supabase realtime
 * channel per browser tab. This drops per-user WS subscriptions from
 * ~4 → 1, dramatically reducing connection pressure during live shows.
 *
 * Usage:
 *   const off = subscribeLiveBus("chat_messages", (evt) => { ... });
 *   return off; // unsubscribe + ref-count cleanup
 *
 * The underlying channel is lazily created on first subscriber and
 * removed once the last subscriber unsubscribes.
 */
import { supabase } from "@/integrations/supabase/client";

type Topic =
  | "chat_messages"
  | "live_polls"
  | "poll_votes"
  | "live_quizzes"
  | "quiz_winners"
  | "site_settings:chat_enabled";

type Handler = (payload: any) => void;

const handlers = new Map<Topic, Set<Handler>>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let refCount = 0;

const TOPIC_BINDINGS: { topic: Topic; table: string; event: "INSERT" | "UPDATE" | "DELETE" | "*"; filter?: string }[] = [
  { topic: "chat_messages", table: "chat_messages", event: "INSERT" },
  { topic: "chat_messages", table: "chat_messages", event: "UPDATE" },
  { topic: "chat_messages", table: "chat_messages", event: "DELETE" },
  { topic: "live_polls", table: "live_polls", event: "*" },
  { topic: "poll_votes", table: "poll_votes", event: "*" },
  { topic: "live_quizzes", table: "live_quizzes", event: "*" },
  { topic: "quiz_winners", table: "quiz_winners", event: "INSERT" },
  { topic: "site_settings:chat_enabled", table: "site_settings", event: "*", filter: "key=eq.chat_enabled" },
];

function emit(topic: Topic, payload: any) {
  const set = handlers.get(topic);
  if (!set) return;
  set.forEach((h) => {
    try { h(payload); } catch (e) { console.warn("[liveRealtimeBus] handler error", e); }
  });
}

function ensureChannel() {
  if (channel) return channel;
  let ch = supabase.channel("live-viewer-bus");
  for (const b of TOPIC_BINDINGS) {
    const cfg: any = { event: b.event, schema: "public", table: b.table };
    if (b.filter) cfg.filter = b.filter;
    ch = ch.on("postgres_changes", cfg, (payload: any) => emit(b.topic, payload));
  }
  ch.subscribe((status) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.warn("[liveRealtimeBus] status:", status);
    }
  });
  channel = ch;
  return ch;
}

export function subscribeLiveBus(topic: Topic, handler: Handler): () => void {
  let set = handlers.get(topic);
  if (!set) {
    set = new Set();
    handlers.set(topic, set);
  }
  set.add(handler);
  refCount++;
  ensureChannel();

  return () => {
    const s = handlers.get(topic);
    if (s) {
      s.delete(handler);
      if (s.size === 0) handlers.delete(topic);
    }
    refCount--;
    if (refCount <= 0) {
      refCount = 0;
      if (channel) {
        try { supabase.removeChannel(channel); } catch {}
        channel = null;
      }
    }
  };
}
