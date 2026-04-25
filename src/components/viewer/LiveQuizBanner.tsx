import { useEffect, useState } from "react";
import { Trophy, Coins, Clock, Sparkles } from "lucide-react";
import { ActiveQuiz, QuizWinnerRow } from "@/hooks/useLiveQuiz";

interface LiveQuizBannerProps {
  quiz: ActiveQuiz;
  winners: QuizWinnerRow[];
  currentUserId?: string | null;
}

const LiveQuizBanner = ({ quiz, winners, currentUserId }: LiveQuizBannerProps) => {
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  useEffect(() => {
    const tick = () => {
      if (!quiz.ends_at) return;
      const ms = new Date(quiz.ends_at).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const t = window.setInterval(tick, 500);
    return () => window.clearInterval(t);
  }, [quiz.ends_at]);

  const myWin = currentUserId ? winners.find((w) => w.user_id === currentUserId) : null;
  const slotsLeft = Math.max(0, quiz.max_winners - winners.length);
  const pct = quiz.duration_seconds > 0
    ? Math.max(0, Math.min(100, (secondsLeft / quiz.duration_seconds) * 100))
    : 0;

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 via-secondary/30 to-accent/15 p-3 shadow-[0_0_20px_hsl(var(--primary)/0.25)]">
      <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(circle_at_30%_30%,hsl(var(--primary)/0.4),transparent_60%)]" />
      <div className="relative space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" /> Live Quiz
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2 py-0.5 text-yellow-400 font-bold">
              <Coins className="h-3 w-3" /> {quiz.coin_reward}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-cyan-400 font-bold">
              <Trophy className="h-3 w-3" /> {winners.length}/{quiz.max_winners}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-magenta-400/40 bg-pink-500/10 px-2 py-0.5 text-pink-400 font-bold">
              <Clock className="h-3 w-3" /> {secondsLeft}s
            </span>
          </div>
        </div>

        <p className="text-sm font-bold text-foreground leading-snug">{quiz.question}</p>

        <div className="text-[10px] text-muted-foreground">
          Ketik jawabanmu di chat. {slotsLeft > 0 ? `${slotsLeft} slot tersisa.` : "Slot pemenang penuh!"}
        </div>

        <div className="h-1 w-full overflow-hidden rounded-full bg-secondary/50">
          <div className="h-full bg-gradient-to-r from-primary via-pink-500 to-yellow-400 transition-all" style={{ width: `${pct}%` }} />
        </div>

        {winners.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {winners.slice(0, 5).map((w) => (
              <span
                key={w.id}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                  currentUserId && w.user_id === currentUserId
                    ? "border-yellow-400 bg-yellow-400/20 text-yellow-300"
                    : "border-primary/30 bg-primary/10 text-primary"
                }`}
              >
                #{w.rank} {w.username}
              </span>
            ))}
            {winners.length > 5 && (
              <span className="text-[10px] text-muted-foreground">+{winners.length - 5} lagi</span>
            )}
          </div>
        )}

        {myWin && (
          <div className="rounded-md border border-yellow-400/50 bg-yellow-400/10 px-2 py-1 text-[11px] font-bold text-yellow-300">
            🎉 Selamat! Kamu menang #{myWin.rank} dan dapat {myWin.coins_awarded} koin!
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveQuizBanner;
