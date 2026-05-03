import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeLiveBus } from "@/lib/liveRealtimeBus";
import { toast } from "sonner";

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
  const activeIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const announcedWinRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      currentUserIdRef.current = data.user?.id || null;
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      currentUserIdRef.current = session?.user?.id || null;
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadWinners = async (quizId: string) => {
    try {
      const { data: w } = await supabase
        .from("quiz_winners")
        .select("id, quiz_id, user_id, username, rank, coins_awarded, answered_at")
        .eq("quiz_id", quizId)
        .order("rank", { ascending: true });
      const list = (w as QuizWinnerRow[]) || [];
      setWinners(list);

      // Announce win for current user (only once per win)
      const uid = currentUserIdRef.current;
      if (uid) {
        const myWin = list.find((x) => x.user_id === uid);
        if (myWin && !announcedWinRef.current.has(myWin.id)) {
          announcedWinRef.current.add(myWin.id);
          try {
            toast.success(`Selamat! Kamu menang 🏆 (peringkat #${myWin.rank})`, {
              description: `+${myWin.coins_awarded} koin sudah masuk ke saldo kamu.`,
            });
          } catch { /* toast not ready yet */ }
        }
      }
    } catch (e) {
      // Network/RPC blip — keep previous winners list, don't crash polling loop
      console.warn("[useLiveQuiz] loadWinners failed:", e);
    }
  };

  const loadActive = async () => {
    try {
      // Cek cache singleton dulu (sangat cepat) untuk early-exit
      const { data: state } = await supabase
        .from("live_quiz_state")
        .select("active_quiz_id, ends_at")
        .eq("id", 1)
        .maybeSingle();

      if (!state?.active_quiz_id || !state.ends_at || new Date(state.ends_at).getTime() <= Date.now()) {
        setActiveQuiz(null);
        setWinners([]);
        activeIdRef.current = null;
        return;
      }

      const { data } = await supabase
        .from("live_quizzes")
        .select("id, question, answers, max_winners, coin_reward, duration_seconds, started_at, ends_at, status")
        .eq("id", state.active_quiz_id)
        .maybeSingle();

      if (data && data.status === "active" && data.ends_at && new Date(data.ends_at).getTime() > Date.now()) {
        setActiveQuiz(data as ActiveQuiz);
        activeIdRef.current = data.id;
        await loadWinners(data.id);
      } else {
        setActiveQuiz(null);
        setWinners([]);
        activeIdRef.current = null;
      }
    } catch (e) {
      console.warn("[useLiveQuiz] loadActive failed:", e);
    }
  };

  useEffect(() => {
    loadActive();

    // Use consolidated realtime bus instead of dedicated channel
    const offQuiz = subscribeLiveBus("live_quizzes", () => loadActive());
    const offWinners = subscribeLiveBus("quiz_winners", (payload: any) => {
      const qid = activeIdRef.current;
      if (qid && payload.new?.quiz_id === qid) {
        loadWinners(qid);
      }
    });

    // Polling cepat (2s) winners hanya saat ada quiz aktif untuk responsivitas tinggi
    const fastPoll = window.setInterval(() => {
      const qid = activeIdRef.current;
      if (qid) loadWinners(qid);
    }, 2000);

    // Polling lambat untuk re-cek state aktif (15s)
    const slowPoll = window.setInterval(loadActive, 15000);

    return () => {
      try { offQuiz(); offWinners(); } catch (e) {
        console.warn("[useLiveQuiz] unsubscribe failed:", e);
      }
      window.clearInterval(fastPoll);
      window.clearInterval(slowPoll);
    };
  }, []);

  const checkAttemptStatus = async (quizId: string) => {
    const { data, error } = await supabase.rpc("get_quiz_attempt_status", { _quiz_id: quizId } as any);
    if (error) return null;
    return data as {
      can_submit: boolean;
      reason?: string;
      reset_at?: string;
      reset_in_ms?: number;
      recent_attempts?: number;
      cooldown_max?: number;
      total_attempts?: number;
      hard_limit?: number;
      winner_count?: number;
      max_winners?: number;
      remaining_total?: number;
      remaining_window?: number;
    } | null;
  };

  return { activeQuiz, winners, refresh: loadActive, checkAttemptStatus };
};

// Helper normalisasi sama seperti di DB (lower + strip non-alphanum)
export const normalizeAnswer = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Cek apakah pesan terlihat seperti jawaban quiz aktif
export const isLikelyQuizAnswer = (message: string, quiz: ActiveQuiz | null) => {
  if (!quiz) return false;
  const norm = normalizeAnswer(message);
  if (!norm || norm.length > 60) return false;
  return quiz.answers.some((a) => normalizeAnswer(a) === norm);
};
