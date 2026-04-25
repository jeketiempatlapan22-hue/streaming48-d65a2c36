import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ActiveQuiz {
  id: string;
  question: string;
  answers: string[];
  max_winners: number;
  coin_reward: number;
  duration_seconds: number;
  started_at: string | null;
  ends_at: string | null;
  status: string;
}

export interface QuizWinnerRow {
  id: string;
  quiz_id: string;
  user_id: string;
  username: string;
  rank: number;
  coins_awarded: number;
  answered_at: string;
}

export const useLiveQuiz = () => {
  const [activeQuiz, setActiveQuiz] = useState<ActiveQuiz | null>(null);
  const [winners, setWinners] = useState<QuizWinnerRow[]>([]);

  const loadActive = async () => {
    const { data } = await supabase
      .from("live_quizzes")
      .select("id, question, answers, max_winners, coin_reward, duration_seconds, started_at, ends_at, status")
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && data.ends_at && new Date(data.ends_at).getTime() > Date.now()) {
      setActiveQuiz(data as ActiveQuiz);
      const { data: w } = await supabase
        .from("quiz_winners")
        .select("id, quiz_id, user_id, username, rank, coins_awarded, answered_at")
        .eq("quiz_id", data.id)
        .order("rank", { ascending: true });
      setWinners((w as QuizWinnerRow[]) || []);
    } else {
      setActiveQuiz(null);
      setWinners([]);
    }
  };

  useEffect(() => {
    loadActive();
    const ch = supabase
      .channel("live-quiz-public")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_quizzes" }, () => loadActive())
      .on("postgres_changes", { event: "*", schema: "public", table: "quiz_winners" }, () => loadActive())
      .subscribe();
    const t = window.setInterval(loadActive, 15000);
    return () => { supabase.removeChannel(ch); window.clearInterval(t); };
  }, []);

  return { activeQuiz, winners, refresh: loadActive };
};
