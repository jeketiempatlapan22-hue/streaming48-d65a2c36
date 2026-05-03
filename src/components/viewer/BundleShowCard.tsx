import { forwardRef } from "react";
import { motion } from "framer-motion";
import { Coins, CreditCard, Package, Play, Timer, Infinity as InfinityIcon, Radio } from "lucide-react";
import type { Show } from "@/types/show";
import bundleBg from "@/assets/bundle-bg.jpg";
import { optimizedImage, buildSrcSet, SIZES } from "@/lib/imageOptimization";

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
        {/* Image header */}
        <div className="relative h-44 overflow-hidden">
          <img
            src={show.background_image_url || bundleBg}
            alt={show.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />

          {/* Top-left bundle badge */}
          <div className="absolute top-3 left-3">
            <span className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[hsl(var(--warning))] to-[hsl(var(--warning))]/80 px-3 py-1 text-[10px] font-bold text-background backdrop-blur-sm shadow-lg">
              <Package className="h-3 w-3" /> PAKET BUNDLE
            </span>
          </div>

          {/* Top-right duration */}
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-[hsl(var(--warning))] backdrop-blur-sm border border-[hsl(var(--warning))]/30">
            <Timer className="h-3 w-3" />
            {durationDays} hari akses
          </div>

          {/* Title at bottom */}
          <div className="absolute bottom-3 left-4 right-4">
            <h3 className="text-lg font-bold text-foreground drop-shadow-lg">{show.title}</h3>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-3 p-4">
          {/* Universal access banner */}
          <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <InfinityIcon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-semibold text-primary mb-0.5">Akses Penuh Multi-Show</p>
              <p className="text-muted-foreground leading-relaxed">
                Satu link untuk menonton <span className="font-semibold text-foreground">semua live yang aktif</span> selama <span className="font-semibold text-[hsl(var(--warning))]">{durationDays} hari</span> ke depan.
              </p>
            </div>
          </div>

          {/* Bundle description (admin-defined paket isi) */}
          {show.bundle_description && (
            <div className="rounded-xl border border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/5 p-3">
              <p className="text-xs font-semibold text-[hsl(var(--warning))] mb-1">📋 Termasuk dalam paket:</p>
              <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">{show.bundle_description}</p>
            </div>
          )}

          {/* Bundle replay info */}
          {show.bundle_replay_info && (
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-3">
              <p className="text-xs font-semibold text-accent mb-1">🎬 Info Replay:</p>
              <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">{show.bundle_replay_info}</p>
            </div>
          )}

          {/* Price row */}
          {!redeemedToken && (
            <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
              {show.coin_price > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-[hsl(var(--warning))]">
                  <Coins className="h-4 w-4" />
                  <span className="font-bold">{show.coin_price} Koin</span>
                </div>
              )}
              {show.price && show.price !== "Gratis" && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CreditCard className="h-3.5 w-3.5" />
                  <span className="font-semibold">{show.price}</span>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          {redeemedToken ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 rounded-xl border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 p-2.5">
                <Radio className="h-4 w-4 text-[hsl(var(--success))] animate-pulse" />
                <p className="text-xs font-semibold text-[hsl(var(--success))]">Bundle aktif — akses semua live</p>
              </div>
              <a
                href={`/live?t=${redeemedToken}`}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/80 px-4 py-3 text-sm font-bold text-primary-foreground transition hover:opacity-90 active:scale-[0.97] shadow-lg shadow-primary/20"
              >
                <Play className="h-4 w-4" /> Buka Link Bundle
              </a>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/live?t=${redeemedToken}`);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-muted py-2 text-xs font-medium text-muted-foreground hover:bg-muted/80"
              >
                📋 Salin Link Akses
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {show.coin_price > 0 && (
                <button
                  onClick={() => onCoinBuy(show)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[hsl(var(--warning))] to-[hsl(var(--warning))]/80 px-4 py-2.5 text-xs font-bold text-background transition hover:opacity-90 active:scale-[0.97]"
                >
                  <Coins className="h-4 w-4" /> Beli Bundle dengan {show.coin_price} Koin
                </button>
              )}
              <button
                onClick={() => onBuy(show)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-[hsl(var(--warning))]/40 px-4 py-2.5 text-xs font-bold text-[hsl(var(--warning))] transition hover:bg-[hsl(var(--warning))]/10 active:scale-[0.97]"
              >
                <CreditCard className="h-4 w-4" /> Beli Bundle via QRIS
              </button>
            </div>
          )}
        </div>
      </motion.div>
    );
  }
);

BundleShowCard.displayName = "BundleShowCard";
export default BundleShowCard;
