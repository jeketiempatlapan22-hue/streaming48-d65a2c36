import { useState, useEffect, forwardRef } from "react";
import { motion } from "framer-motion";
import {
  Calendar, Clock, Users, Ticket, Coins, Copy, Radio, Film, Timer, MessageCircle, Bell, BellOff,
} from "lucide-react";
import type { Show } from "@/types/show";
import { SHOW_CATEGORIES } from "@/types/show";
import TeamBadge from "@/components/viewer/TeamBadge";
import { toast } from "sonner";
import {
  requestNotificationPermission, addShowReminder, removeShowReminder, hasReminder,
} from "@/lib/notifications";

interface ShowCardProps {
  show: Show;
  index: number;
  isReplayMode: boolean;
  redeemedToken?: string;
  accessPassword?: string;
  replayPassword?: string;
  onBuy: (show: Show) => void;
  onCoinBuy: (show: Show) => void;
  showCountdown?: boolean;
}

const INDONESIAN_MONTHS: Record<string, number> = {
  januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
  juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
};

function parseShowDateTime(dateStr: string, timeStr: string): number | null {
  if (!dateStr || !timeStr) return null;
  const cleanTime = timeStr.replace(/\s*WIB\s*/i, "").trim().replace(/\./g, ":");
  const [hour, minute] = cleanTime.split(":").map(Number);
  let d = new Date(`${dateStr}T${cleanTime.padStart(5, "0")}:00`);
  if (!isNaN(d.getTime())) return d.getTime();
  const parts = dateStr.toLowerCase().trim().split(/\s+/);
  if (parts.length === 3) {
    const day = parseInt(parts[0]);
    const month = INDONESIAN_MONTHS[parts[1]];
    const year = parseInt(parts[2]);
    if (!isNaN(day) && month !== undefined && !isNaN(year)) {
      return new Date(year, month, day, hour || 0, minute || 0).getTime();
    }
  }
  return null;
}

function useCountdown(dateStr: string, timeStr: string) {
  const [parts, setParts] = useState<{ d: number; h: number; m: number; s: number; live: boolean } | null>(null);

  useEffect(() => {
    const target = parseShowDateTime(dateStr, timeStr);
    if (!target) return;
    const update = () => {
      const diff = target - Date.now();
      if (diff <= 0) { setParts({ d: 0, h: 0, m: 0, s: 0, live: true }); return; }
      setParts({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
        live: false,
      });
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [dateStr, timeStr]);

  return parts;
}

const CountdownDigit = forwardRef<HTMLDivElement, { value: number; label: string }>(({ value, label }, ref) => {
  const formatted = value.toString().padStart(2, "0");
  return (
    <div ref={ref} className="flex items-center gap-0.5">
      <span className="font-mono text-xs font-bold text-white tabular-nums">
        {formatted}
      </span>
      <span className="text-[7px] uppercase text-white/60 font-medium">{label}</span>
    </div>
  );
});
CountdownDigit.displayName = "CountdownDigit";

const ShowCard = forwardRef<HTMLDivElement, ShowCardProps>(({
  show, index, isReplayMode, redeemedToken, accessPassword, replayPassword,
  onBuy, onCoinBuy, showCountdown = true,
}, ref) => {
  const countdown = useCountdown(show.schedule_date, show.schedule_time);
  const pw = accessPassword || replayPassword;
  const hasPw = pw && pw !== "__purchased__";
  const [reminded, setReminded] = useState(() => hasReminder(show.id));

  const handleReminder = async () => {
    if (reminded) {
      removeShowReminder(show.id);
      setReminded(false);
      toast.success("Pengingat dihapus");
      return;
    }
    const granted = await requestNotificationPermission();
    if (!granted) {
      toast.error("Izinkan notifikasi di browser untuk mengaktifkan pengingat");
      return;
    }
    const target = parseShowDateTime(show.schedule_date, show.schedule_time);
    if (!target) { toast.error("Jadwal show tidak tersedia"); return; }
    addShowReminder(show.id, show.title, target);
    setReminded(true);
    toast.success("🔔 Pengingat diaktifkan! Kamu akan dinotifikasi 30 menit sebelum show.");
  };

  return (
    <motion.div ref={ref}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="group relative overflow-hidden rounded-2xl glass-neon transition-all duration-500 hover:border-[hsl(var(--neon-cyan)/0.5)] hover:shadow-[0_0_25px_hsl(var(--neon-cyan)/0.12),0_0_50px_hsl(var(--neon-cyan)/0.05)]"
    >
      {/* Image */}
      <div className="relative h-44 overflow-hidden">
        {show.background_image_url ? (
          <img src={show.background_image_url} alt={show.title} loading="lazy" decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/20 to-accent/10">
            <Ticket className="h-16 w-16 text-primary/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card/60 to-transparent" />

        {/* Category badge - top left */}
        <div className="absolute top-2.5 left-2.5 flex flex-col gap-1">
          {show.category && (() => {
            const cat = SHOW_CATEGORIES[show.category] || SHOW_CATEGORIES.regular;
            return (
              <div className="rounded-full bg-black/50 backdrop-blur-sm px-2.5 py-1 border border-white/10 w-fit">
                <span className="text-[10px] font-bold text-white">{cat.label}</span>
              </div>
            );
          })()}
        </div>

        {/* LIVE badge - top right */}
        {showCountdown && countdown?.live && !show.is_replay && (
          <div className="absolute top-2.5 right-2.5">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-1 shadow-lg shadow-destructive/30"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              <span className="text-[10px] font-bold text-destructive-foreground">LIVE!</span>
            </motion.div>
          </div>
        )}

        {/* Countdown strip at bottom of image */}
        {showCountdown && countdown && !countdown.live && !show.is_replay && (
          <div className="absolute bottom-2 left-3 right-3">
            <div className="flex items-center gap-2 rounded-full bg-black/60 backdrop-blur-sm px-3 py-1.5 w-fit">
              <Timer className="h-3 w-3 text-primary animate-pulse shrink-0" />
              <div className="flex items-center gap-1.5">
                {countdown.d > 0 && (
                  <>
                    <CountdownDigit value={countdown.d} label="h" />
                    <span className="text-white/30 text-[10px]">:</span>
                  </>
                )}
                <CountdownDigit value={countdown.h} label="j" />
                <span className="text-white/30 text-[10px]">:</span>
                <CountdownDigit value={countdown.m} label="m" />
                <span className="text-white/30 text-[10px]">:</span>
                <CountdownDigit value={countdown.s} label="s" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="space-y-2.5 p-4">
        {/* Title + reminder */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-bold text-foreground leading-tight flex-1">{show.title}</h3>
          {!show.is_replay && show.schedule_date && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleReminder(); }}
              className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full transition-all ${reminded ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
              title={reminded ? "Hapus pengingat" : "Ingatkan saya"}
            >
              {reminded ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        {/* Team badge - prominent */}
        {show.team && <TeamBadge team={show.team} size="md" />}

        {/* Category member info */}
        {show.category && show.category !== "regular" && show.category_member && (
          <div className={`rounded-lg px-3 py-1.5 ${(SHOW_CATEGORIES[show.category] || SHOW_CATEGORIES.regular).color}`}>
            <p className="text-xs font-semibold">{show.category_member}</p>
          </div>
        )}

        {/* Price & Coin combined in one line with / separator */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {show.price && show.price !== "Gratis" && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">{show.price}</span>
          )}
          {show.price && show.price !== "Gratis" && ((isReplayMode && show.replay_coin_price > 0) || (!isReplayMode && show.coin_price > 0)) && (
            <span className="text-xs text-muted-foreground">/</span>
          )}
          {isReplayMode && show.replay_coin_price > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">
              <Film className="h-3 w-3" /> {show.replay_coin_price} Koin
            </span>
          ) : show.coin_price > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--warning))]/15 px-2.5 py-0.5 text-xs font-bold text-[hsl(var(--warning))]">
              <Coins className="h-3 w-3" /> {show.coin_price} Koin
            </span>
          ) : null}
          {show.price === "Gratis" && (
            <span className="rounded-full bg-[hsl(var(--success))]/15 px-2.5 py-0.5 text-xs font-bold text-[hsl(var(--success))]">Gratis</span>
          )}
        </div>

        {show.schedule_date && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4 text-primary" />{show.schedule_date}
          </div>
        )}
        {show.schedule_time && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 text-primary" />{show.schedule_time}
          </div>
        )}
        {show.lineup && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Users className="mt-0.5 h-4 w-4 text-primary" />
            <span className="line-clamp-2">{show.lineup}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-2 flex flex-col gap-2">
          {/* Sandi akses digabung ke sandi replay di bawah */}

          {redeemedToken ? (
            isReplayMode ? (
              <div className="space-y-2">
                {hasPw && (
                  <div className="rounded-xl border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 p-3 text-center">
                    <p className="text-[10px] font-medium text-muted-foreground mb-1">🔐 Sandi Replay</p>
                    <p className="font-mono text-lg font-bold text-[hsl(var(--warning))]">{pw}</p>
                  </div>
                )}
                <button
                  onClick={() => {
                    if (hasPw) {
                      navigator.clipboard.writeText(pw!);
                      toast.success("Sandi disalin!");
                    }
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-accent-foreground transition-all hover:bg-accent/90"
                >
                  <Copy className="h-4 w-4" /> {hasPw ? "Salin Sandi Replay" : "Tonton Replay"}
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/live?t=${redeemedToken}`); toast.success("Link disalin!"); }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-muted py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-muted/80"
                >
                  <Copy className="h-3.5 w-3.5" /> Salin Link Nonton
                </button>
              </div>
            ) : (
              <>
                {(() => {
                  const showStart = parseShowDateTime(show.schedule_date, show.schedule_time);
                  const accessOpens = showStart ? showStart - 2 * 60 * 60 * 1000 : null;
                  const isTooEarly = accessOpens ? Date.now() < accessOpens : false;

                  if (isTooEarly && showStart) {
                    const countdownText = countdown
                      ? countdown.d > 0
                        ? `${countdown.d}h ${countdown.h}j ${countdown.m}m`
                        : `${countdown.h.toString().padStart(2,"0")}:${countdown.m.toString().padStart(2,"0")}:${countdown.s.toString().padStart(2,"0")}`
                      : "";
                    return (
                      <div className="rounded-xl border border-muted bg-muted/50 p-4 text-center space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">⏳ Menunggu Live Streaming</p>
                        <p className="font-mono text-2xl font-bold text-primary">{countdownText}</p>
                        <p className="text-[10px] text-muted-foreground">{show.schedule_date} • {show.schedule_time}</p>
                        <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-muted py-3 text-sm font-semibold text-muted-foreground/50 cursor-not-allowed">
                          <Radio className="h-4 w-4" /> Menunggu Live...
                        </div>
                      </div>
                    );
                  }

                  return (
                    <>
                      <a
                        href={`/live?t=${redeemedToken}`}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--success))] py-3 font-semibold text-primary-foreground transition-all hover:bg-[hsl(var(--success))]/90 hover:shadow-lg hover:shadow-[hsl(var(--success))]/25"
                      >
                        <Radio className="h-4 w-4" /> Tonton Live
                      </a>
                      <button
                        onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/live?t=${redeemedToken}`); toast.success("Link disalin!"); }}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-muted py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-muted/80"
                      >
                        <Copy className="h-3.5 w-3.5" /> Salin Link Nonton
                      </button>
                    </>
                  );
                })()}
              </>
            )
          ) : (
            <>
              {((isReplayMode && show.replay_coin_price > 0) || (!isReplayMode && show.coin_price > 0)) && (
                <button
                  onClick={() => onCoinBuy(show)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--warning))] py-3 font-semibold text-primary-foreground transition-all hover:bg-[hsl(var(--warning))]/90 hover:shadow-lg hover:shadow-[hsl(var(--warning))]/25"
                >
                  <Coins className="h-4 w-4" /> Beli dengan {isReplayMode ? show.replay_coin_price : show.coin_price} Koin
                </button>
              )}
              <button
                onClick={() => onBuy(show)}
                className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 font-semibold transition-all ${
                  (isReplayMode ? show.replay_coin_price : show.coin_price) > 0
                    ? "bg-muted text-muted-foreground hover:bg-muted/80"
                    : "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25"
                }`}
              >
                <MessageCircle className="h-4 w-4" /> {(isReplayMode ? show.replay_coin_price : show.coin_price) > 0 ? "Beli via QRIS" : "Beli Tiket"}
              </button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
});
ShowCard.displayName = "ShowCard";

export default ShowCard;
