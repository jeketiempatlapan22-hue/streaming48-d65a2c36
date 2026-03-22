import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface LivePollProps {
  voterId: string;
}

const COLORS = [
  "bg-primary", "bg-[hsl(var(--success))]", "bg-[hsl(var(--warning))]", "bg-destructive",
  "bg-purple-500", "bg-cyan-500", "bg-pink-500", "bg-orange-500",
];

const LivePoll = ({ voterId }: LivePollProps) => {
  const [poll, setPoll] = useState<any>(null);
  const [votes, setVotes] = useState<Record<number, number>>({});
  const [myVote, setMyVote] = useState<number | null>(null);
  const [totalVotes, setTotalVotes] = useState(0);
  const [changing, setChanging] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processVotes = useCallback((voteList: any[]) => {
    const counts: Record<number, number> = {};
    let total = 0;
    let mine: number | null = null;
    voteList.forEach((v: any) => {
      counts[v.option_index] = (counts[v.option_index] || 0) + 1;
      total++;
      if (v.voter_id === voterId) mine = v.option_index;
    });
    setVotes(counts);
    setTotalVotes(total);
    setMyVote(mine);
  }, [voterId]);

  const fetchVotes = useCallback(async (pollId: string) => {
    const { data: voteData } = await supabase
      .from("poll_votes")
      .select("*")
      .eq("poll_id", pollId);
    if (voteData) processVotes(voteData);
  }, [processVotes]);

  const pollIdRef = useRef<string | null>(null);

  useEffect(() => {
    pollIdRef.current = poll?.id || null;
  }, [poll?.id]);

  useEffect(() => {
    const fetchPoll = async () => {
      const { data } = await supabase
        .from("live_polls")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setPoll(data);
        await fetchVotes(data.id);
      }
    };
    fetchPoll();

    const pollChannel = supabase
      .channel("live-poll-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_polls" }, (payload) => {
        if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
          const p = payload.new as any;
          if (p.is_active) {
            setPoll(p);
            setVotes({});
            setTotalVotes(0);
            setMyVote(null);
            fetchVotes(p.id);
          } else if (pollIdRef.current === p.id) {
            setPoll(null);
          }
        } else if (payload.eventType === "DELETE") {
          if (pollIdRef.current === payload.old?.id) setPoll(null);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "poll_votes" }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const currentPollId = pollIdRef.current;
          if (currentPollId) fetchVotes(currentPollId);
        }, 300);
      })
      .subscribe();

    return () => { supabase.removeChannel(pollChannel); };
  }, [voterId, processVotes, fetchVotes]);

  const handleVote = async (optionIndex: number) => {
    if (!poll || changing) return;
    const previousVote = myVote;
    setChanging(true);
    setMyVote(optionIndex);

    if (previousVote !== null) {
      setVotes(prev => {
        const updated = { ...prev };
        updated[previousVote] = Math.max((updated[previousVote] || 1) - 1, 0);
        updated[optionIndex] = (updated[optionIndex] || 0) + 1;
        return updated;
      });
    } else {
      setVotes(prev => ({ ...prev, [optionIndex]: (prev[optionIndex] || 0) + 1 }));
      setTotalVotes(prev => prev + 1);
    }

    try {
      if (previousVote !== null) {
        // Use secure RPC to change vote (no public DELETE policy)
        const { error } = await supabase.rpc("change_poll_vote" as any, {
          _poll_id: poll.id,
          _voter_id: voterId,
          _new_option_index: optionIndex,
        });
        if (error) {
          setMyVote(previousVote);
          await fetchVotes(poll.id);
        }
      } else {
        const { error } = await supabase.from("poll_votes").insert({
          poll_id: poll.id,
          voter_id: voterId,
          option_index: optionIndex,
        });
        if (error) {
          setMyVote(previousVote);
          await fetchVotes(poll.id);
        }
      }
    } catch {
      setMyVote(previousVote);
      await fetchVotes(poll.id);
    } finally {
      setChanging(false);
    }
  };

  if (!poll) return null;
  const options = (poll.options as any[]) || [];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20 }}
        className="mx-3 my-2 rounded-xl border border-primary/30 bg-card/95 p-3 backdrop-blur-sm shadow-lg"
      >
        <div className="mb-2 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold text-foreground">POLL</span>
          <span className="ml-auto text-[10px] text-muted-foreground">{totalVotes} vote</span>
        </div>
        <p className="mb-2 text-sm font-semibold text-foreground">{poll.question}</p>
        <div className="space-y-1.5">
          {options.map((opt: string, i: number) => {
            const count = votes[i] || 0;
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const isMyVote = myVote === i;
            return (
              <button
                key={i}
                onClick={() => handleVote(i)}
                disabled={changing}
                className={`relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-xs font-medium transition-all ${
                  isMyVote
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-primary/5"
                }`}
              >
                {myVote !== null && (
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className={`absolute inset-y-0 left-0 ${COLORS[i % COLORS.length]} opacity-15`}
                  />
                )}
                <div className="relative flex items-center justify-between">
                  <span>{opt} {isMyVote && "✓"}</span>
                  {myVote !== null && <span className="text-[10px]">{pct}%</span>}
                </div>
              </button>
            );
          })}
        </div>
        {myVote !== null && (
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Klik opsi lain untuk mengganti pilihan</p>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default LivePoll;
