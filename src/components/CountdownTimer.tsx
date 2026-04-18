import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Timer } from "lucide-react";
import { parseWIBDateTime } from "@/lib/timeFormat";

interface CountdownTimerProps {
  dateStr: string;
  timeStr: string;
}

const parseDateTime = (dateStr: string, timeStr: string): Date | null => {
  const ts = parseWIBDateTime(dateStr, timeStr);
  if (ts != null) return new Date(ts);
  const d = new Date(`${dateStr} ${timeStr}`);
  if (!isNaN(d.getTime())) return d;
  return null;
};

const AnimatedDigit = ({ value, label }: { value: number; label: string }) => (
  <div className="flex flex-col items-center">
    <motion.div
      key={value}
      initial={{ rotateX: -90, opacity: 0 }}
      animate={{ rotateX: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 backdrop-blur-sm border border-primary/20"
    >
      <span className="font-mono text-sm font-bold text-primary tabular-nums">
        {value.toString().padStart(2, "0")}
      </span>
    </motion.div>
    <span className="mt-0.5 text-[8px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
  </div>
);

const CountdownTimer = ({ dateStr, timeStr }: CountdownTimerProps) => {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [isLive, setIsLive] = useState(false);
  const [isPast, setIsPast] = useState(false);

  useEffect(() => {
    const target = parseDateTime(dateStr, timeStr);
    if (!target) return;

    const update = () => {
      const now = new Date();
      const diff = target.getTime() - now.getTime();

      if (diff <= 0) {
        if (diff > -10800000) {
          setIsLive(true);
          setIsPast(false);
        } else {
          setIsLive(false);
          setIsPast(true);
        }
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      setIsLive(false);
      setIsPast(false);
      setTimeLeft({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [dateStr, timeStr]);

  if (isPast) {
    return (
      <span className="text-[10px] font-medium text-muted-foreground">Sudah berlalu</span>
    );
  }

  if (isLive) {
    return (
      <motion.div
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 shadow-lg shadow-destructive/30"
      >
        <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
        <span className="text-xs font-bold text-destructive-foreground">SEDANG LIVE</span>
      </motion.div>
    );
  }

  const { days, hours, minutes, seconds } = timeLeft;
  if (days === 0 && hours === 0 && minutes === 0 && seconds === 0) return null;

  return (
    <div className="inline-flex flex-col items-center rounded-xl bg-background/80 backdrop-blur-sm border border-primary/10 px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Timer className="h-3 w-3 text-primary animate-pulse" />
        <span className="text-[8px] uppercase tracking-widest text-muted-foreground font-semibold">Mulai dalam</span>
      </div>
      <div className="flex items-center gap-1">
        {days > 0 && (
          <>
            <AnimatedDigit value={days} label="Hari" />
            <span className="text-primary/40 font-bold text-xs pb-3">:</span>
          </>
        )}
        <AnimatedDigit value={hours} label="Jam" />
        <span className="text-primary/40 font-bold text-xs pb-3">:</span>
        <AnimatedDigit value={minutes} label="Min" />
        <span className="text-primary/40 font-bold text-xs pb-3">:</span>
        <AnimatedDigit value={seconds} label="Det" />
      </div>
    </div>
  );
};

export default CountdownTimer;
