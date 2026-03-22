import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Trophy } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface LeaderboardEntry { username: string; count: number; }

const MEDALS = ["🥇", "🥈", "🥉"];

const ChatLeaderboard = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    const fetchData = async () => {
      const { data } = await supabase.from("chat_messages").select("username");
      if (data) {
        const counts: Record<string, number> = {};
        data.forEach((m: any) => { counts[m.username] = (counts[m.username] || 0) + 1; });
        const sorted = Object.entries(counts).map(([username, count]) => ({ username, count })).sort((a, b) => b.count - a.count).slice(0, 10);
        setLeaders(sorted);
      }
      setLoading(false);
    };
    fetchData();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="absolute inset-x-0 top-12 z-30 mx-3 rounded-xl border border-primary/30 bg-card/95 p-3 shadow-xl backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-500" />
            <span className="text-xs font-bold text-foreground">Chat Leaderboard</span>
          </div>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
        </div>
        {loading ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Memuat...</p>
        ) : leaders.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Belum ada data</p>
        ) : (
          <div className="space-y-1">
            {leaders.map((entry, i) => (
              <div key={entry.username} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${i < 3 ? "bg-yellow-500/5" : ""}`}>
                <span className="w-5 text-center text-xs font-bold">{i < 3 ? MEDALS[i] : `${i + 1}`}</span>
                <span className={`flex-1 truncate text-xs font-medium ${i === 0 ? "text-yellow-500" : "text-foreground"}`}>{entry.username}</span>
                <span className="text-[10px] text-muted-foreground">{entry.count} pesan</span>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default ChatLeaderboard;
