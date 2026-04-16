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
  /** Whether the stream is currently live */
  isLive?: boolean;
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

const ShowCard = forwardRef<HTMLDivElement, ShowCardProps>(({
  show, index, isReplayMode, redeemedToken, accessPassword, replayPassword,
  onBuy, onCoinBuy, showCountdown = true, isLive = false,
}, ref) => {
  const countdown = useCountdown(show.schedule_date, show.schedule_time);
  const pw = accessPassword || replayPassword;
  const hasPw = pw && pw !== "__purchased__";
  const [reminded, setReminded] = useState(() => hasReminder(show.id));
  const cat = show.category ? (SHOW_CATEGORIES[show.category] || SHOW_CATEGORIES.regular) : null;
  const coinPrice = isReplayMode ? show.replay_coin_price : show.coin_price;
  const hasCoin = coinPrice > 0;

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
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.08 }}
      className="group relative overflow-hidden rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
    >
      {/* Compact image area */}
      <div className="relative h-36 overflow-hidden">
        {show.background_image_url ? (
          <img src={show.background_image_url} alt={show.title} loading="lazy" decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/10 to-accent/5">
            <Ticket className="h-12 w-12 text-primary/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent" />

        {/* Top row: category + live/reminder */}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between">
          <div className="flex items-center gap-1.5">
            {cat && (
              <span className="rounded-full bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[9px] font-bold text-white border border-white/10">
                {cat.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {showCountdown && countdown?.live && !show.is_replay && (
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 shadow-lg shadow-destructive/30"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                <span className="text-[9px] font-bold text-destructive-foreground">LIVE</span>
              </motion.div>
            )}
            {!show.is_replay && show.schedule_date && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleReminder(); }}
                className={`flex h-6 w-6 items-center justify-center rounded-full backdrop-blur-sm transition-all ${reminded ? "bg-primary/80 text-white" : "bg-black/40 text-white/70 hover:bg-black/60"}`}
                title={reminded ? "Hapus pengingat" : "Ingatkan saya"}
              >
                {reminded ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
              </button>
            )}
          </div>
        </div>

        {/* Countdown - bottom of image */}
        {showCountdown && countdown && !countdown.live && !show.is_replay && (
          <div className="absolute bottom-1.5 left-2">
            <div className="flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-2.5 py-1">
              <Timer className="h-2.5 w-2.5 text-primary animate-pulse shrink-0" />
              <span className="font-mono text-[10px] font-bold text-white tabular-nums">
                {countdown.d > 0 && `${countdown.d}h `}
                {countdown.h.toString().padStart(2, "0")}:{countdown.m.toString().padStart(2, "0")}:{countdown.s.toString().padStart(2, "0")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Content - compact */}
      <div className="space-y-2 p-3">
        {/* Title */}
        <h3 className="text-sm font-bold text-foreground leading-snug line-clamp-2">{show.title}</h3>

        {/* Category member */}
        {show.category && show.category !== "regular" && show.category_member && (
          <p className="text-[11px] font-medium text-muted-foreground">{show.category_member}</p>
        )}

        {/* Meta row: date + time + price in one compact area */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {show.schedule_date && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3 text-primary/70" />{show.schedule_date}
            </span>
          )}
          {show.schedule_time && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-primary/70" />{show.schedule_time}
            </span>
          )}
        </div>

        {/* Price row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {show.price && show.price !== "Gratis" && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{show.price}</span>
          )}
          {show.price && show.price !== "Gratis" && hasCoin && (
            <span className="text-[10px] text-muted-foreground/50">/</span>
          )}
          {hasCoin && (
            <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              isReplayMode
                ? "bg-accent/15 text-accent"
                : "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]"
            }`}>
              {isReplayMode ? <Film className="h-2.5 w-2.5" /> : <Coins className="h-2.5 w-2.5" />} {coinPrice} Koin
            </span>
          )}
          {show.price === "Gratis" && (
            <span className="rounded-full bg-[hsl(var(--success))]/15 px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--success))]">Gratis</span>
          )}
        </div>

        {/* Lineup - full display */}
        {show.lineup && (
          <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Users className="h-3 w-3 text-primary/70 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{show.lineup}</span>
          </div>
        )}

        {/* Team badge - full width below lineup */}
        {show.team && <TeamBadge team={show.team} size="md" />}

        {/* Action buttons - slimmer */}
        <div className="flex flex-col gap-1.5 pt-1">
          {redeemedToken ? (
            isReplayMode ? (
              <div className="space-y-1.5">
                {hasPw && (
                  <div className="rounded-lg border border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/5 px-3 py-2 text-center">
                    <p className="text-[9px] text-muted-foreground mb-0.5">🔐 Sandi Replay</p>
                    <p className="font-mono text-base font-bold text-[hsl(var(--warning))]">{pw}</p>
                  </div>
                )}
                <button
                  onClick={() => { if (hasPw) { navigator.clipboard.writeText(pw!); toast.success("Sandi disalin!"); } }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-foreground transition-all hover:bg-accent/90"
                >
                  <Copy className="h-3.5 w-3.5" /> {hasPw ? "Salin Sandi" : "Tonton Replay"}
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/live?t=${redeemedToken}`); toast.success("Link disalin!"); }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-muted py-2 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                >
                  <Copy className="h-3 w-3" /> Salin Link
                </button>
              </div>
            ) : (
              <>
                {(() => {
                  // If stream is currently live, always show "Tonton Live" — skip countdown
                  if (isLive) {
                    return (
                      <>
                        <a
                          href={`/live?t=${redeemedToken}`}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[hsl(var(--success))] py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-[hsl(var(--success))]/90 animate-pulse"
                        >
                          <Radio className="h-3.5 w-3.5" /> 🔴 Tonton Live
                        </a>
                        <button
                          onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/live?t=${redeemedToken}`); toast.success("Link disalin!"); }}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-muted py-2 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                        >
                          <Copy className="h-3 w-3" /> Salin Link
                        </button>
                      </>
                    );
                  }

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
                      <div className="rounded-lg border border-muted bg-muted/30 p-3 text-center space-y-1.5">
                        <p className="text-[10px] text-muted-foreground">⏳ Menunggu Live</p>
                        <p className="font-mono text-xl font-bold text-primary">{countdownText}</p>
                        <p className="text-[9px] text-muted-foreground">{show.schedule_date} • {show.schedule_time}</p>
                      </div>
                    );
                  }

                  return (
                    <>
                      <a
                        href={`/live?t=${redeemedToken}`}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[hsl(var(--success))] py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-[hsl(var(--success))]/90"
                      >
                        <Radio className="h-3.5 w-3.5" /> Tonton Live
                      </a>
                      <button
                        onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/live?t=${redeemedToken}`); toast.success("Link disalin!"); }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-muted py-2 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                      >
                        <Copy className="h-3 w-3" /> Salin Link
                      </button>
                    </>
                  );
                })()}
              </>
            )
          ) : (
            <>
              {hasCoin && (
                <button
                  onClick={() => onCoinBuy(show)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[hsl(var(--warning))] py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-[hsl(var(--warning))]/90"
                >
                  <Coins className="h-3.5 w-3.5" /> Beli {coinPrice} Koin
                </button>
              )}
              <button
                onClick={() => onBuy(show)}
                className={`flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                  hasCoin
                    ? "bg-muted text-muted-foreground hover:bg-muted/80"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                <MessageCircle className="h-3.5 w-3.5" /> {hasCoin ? "Beli via QRIS" : "Beli Tiket"}
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
