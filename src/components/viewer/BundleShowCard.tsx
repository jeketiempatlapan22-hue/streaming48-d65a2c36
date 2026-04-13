import { forwardRef } from "react";
import { motion } from "framer-motion";
import { Calendar, Clock, Coins, CreditCard, Package, Play, Timer } from "lucide-react";
import type { Show } from "@/types/show";
import { SHOW_CATEGORIES } from "@/types/show";
import TeamBadge from "@/components/viewer/TeamBadge";

interface BundleShowCardProps {
  show: Show;
  index: number;
  onBuy: (show: Show) => void;
  onCoinBuy: (show: Show) => void;
  redeemedToken?: string;
  accessPassword?: string;
  replayPassword?: string;
}

const BundleShowCard = forwardRef<HTMLDivElement, BundleShowCardProps>(
  ({ show, index, onBuy, onCoinBuy, redeemedToken }, ref) => {
    const durationDays = show.bundle_duration_days || 30;

    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: index * 0.1 }}
        className="group relative overflow-hidden rounded-2xl border-2 border-[hsl(var(--warning))]/40 bg-gradient-to-br from-[hsl(var(--warning))]/5 via-card to-card transition-all hover:border-[hsl(var(--warning))]/60 hover:shadow-xl hover:shadow-[hsl(var(--warning))]/10"
      >
        {/* Image */}
        <div className="relative h-48 overflow-hidden">
          {show.background_image_url ? (
            <img
              src={show.background_image_url}
              alt={show.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-[hsl(var(--warning))]/20 to-primary/10">
              <Package className="h-16 w-16 text-[hsl(var(--warning))]/40" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/50 to-transparent" />
          
          {/* Badges */}
          <div className="absolute top-3 left-3 flex flex-col gap-1">
            <span className="rounded-full bg-gradient-to-r from-[hsl(var(--warning))] to-[hsl(var(--warning))]/80 px-3 py-1 text-[10px] font-bold text-background backdrop-blur-sm">
              📦 BUNDLE
            </span>
            {show.category && show.category !== "regular" && (() => {
              const cat = SHOW_CATEGORIES[show.category] || SHOW_CATEGORIES.regular;
              return <span className={`rounded-full px-3 py-1 text-[10px] font-bold backdrop-blur-sm w-fit ${cat.color}`}>{cat.label}</span>;
            })()}
            {show.team && <TeamBadge team={show.team} size="sm" />}
          </div>

          {/* Duration badge */}
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-[hsl(var(--warning))]/90 px-2.5 py-1 text-[10px] font-bold text-background backdrop-blur-sm">
            <Timer className="h-3 w-3" />
            {durationDays} hari
          </div>

          <div className="absolute bottom-3 left-4 right-4">
            <h3 className="text-lg font-bold text-foreground">{show.title}</h3>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-3 p-4">
          {/* Bundle description */}
          {show.bundle_description && (
            <div className="rounded-xl border border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/5 p-3">
              <p className="text-xs font-semibold text-[hsl(var(--warning))] mb-1">📋 Termasuk dalam paket:</p>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{show.bundle_description}</p>
            </div>
          )}

          {/* Bundle replay info */}
          {show.bundle_replay_info && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs font-semibold text-primary mb-1">🎬 Info Replay:</p>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{show.bundle_replay_info}</p>
            </div>
          )}

          {/* Schedule */}
          {show.schedule_date && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />
              {show.schedule_date}
              {show.schedule_time && (
                <>
                  <Clock className="ml-2 h-3.5 w-3.5 text-[hsl(var(--warning))]" />
                  {show.schedule_time}
                </>
              )}
            </div>
          )}

          {show.lineup && (
            <p className="text-xs text-muted-foreground line-clamp-2">👥 {show.lineup}</p>
          )}

          {/* Price */}
          <div className="flex items-center justify-between">
            {show.coin_price > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-[hsl(var(--warning))]">
                <Coins className="h-4 w-4" />
                <span className="font-semibold">{show.coin_price} Koin</span>
              </div>
            )}
            {show.price && show.price !== "Gratis" && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CreditCard className="h-3.5 w-3.5" />
                <span className="font-medium">{show.price}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          {redeemedToken ? (
            <div className="space-y-2">
              <div className="rounded-xl border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 p-3 text-center">
                <p className="text-xs font-semibold text-[hsl(var(--success))]">✅ Sudah dibeli</p>
              </div>
              <a
                href={`/live?t=${redeemedToken}`}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90"
              >
                <Play className="h-4 w-4" /> Tonton Sekarang
              </a>
            </div>
          ) : (
            <div className="flex gap-2">
              {show.coin_price > 0 && (
                <button
                  onClick={() => onCoinBuy(show)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[hsl(var(--warning))] to-[hsl(var(--warning))]/80 px-4 py-2.5 text-xs font-bold text-background transition hover:opacity-90 active:scale-[0.97]"
                >
                  <Coins className="h-4 w-4" /> Beli Koin
                </button>
              )}
              {show.qris_image_url && (
                <button
                  onClick={() => onBuy(show)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 border-[hsl(var(--warning))]/40 px-4 py-2.5 text-xs font-bold text-[hsl(var(--warning))] transition hover:bg-[hsl(var(--warning))]/10 active:scale-[0.97]"
                >
                  <CreditCard className="h-4 w-4" /> QRIS
                </button>
              )}
            </div>
          )}
        </div>
      </motion.div>
    );
  }
);

BundleShowCard.displayName = "BundleShowCard";
export default BundleShowCard;
