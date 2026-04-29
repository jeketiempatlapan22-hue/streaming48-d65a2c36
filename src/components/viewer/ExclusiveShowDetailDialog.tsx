import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Lock, Coins, MessageCircle, ShieldAlert, Check, X } from "lucide-react";
import type { Show } from "@/types/show";

interface Props {
  show: Show | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBuy: (show: Show) => void;
  onCoinBuy: (show: Show) => void;
  isReplayMode?: boolean;
  isUniversalAccess?: boolean;
}

const ExclusiveShowDetailDialog = ({
  show, open, onOpenChange, onBuy, onCoinBuy, isReplayMode = false, isUniversalAccess = false,
}: Props) => {
  if (!show) return null;

  const coinPrice = isReplayMode ? show.replay_coin_price : show.coin_price;
  const hasCoin = coinPrice > 0;
  const replayQrisPrice = show.replay_qris_price || 0;
  const hasReplayPrice = isReplayMode && replayQrisPrice > 0;
  const displayPrice = hasReplayPrice
    ? `Rp ${replayQrisPrice.toLocaleString("id-ID")}`
    : show.price;
  const isFreeQris = displayPrice === "Gratis";
  const hasQris = !isFreeQris;

  const handleQrisBuy = () => { onBuy(show); onOpenChange(false); };
  const handleCoinPurchase = () => { onCoinBuy(show); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto glass border-fuchsia-500/40">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-fuchsia-500/20 border border-fuchsia-500/40">
              <Lock className="h-4 w-4 text-fuchsia-300" />
            </div>
            <DialogTitle className="text-fuchsia-300 uppercase tracking-wide text-sm">
              Show Eksklusif
            </DialogTitle>
          </div>
          <DialogDescription className="text-foreground font-semibold text-base leading-snug">
            {show.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Penjelasan utama */}
          <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 space-y-2">
            <p className="text-xs font-bold text-fuchsia-200 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5" /> Apa itu "Show Eksklusif"?
            </p>
            <p className="text-xs leading-relaxed text-foreground/85">
              Show Eksklusif adalah tayangan spesial yang <strong>tidak termasuk</strong> dalam paket
              berlangganan apa pun. Setiap orang — termasuk pemegang Membership — wajib
              membeli akses ke show ini secara <strong>terpisah</strong>.
            </p>
          </div>

          {/* Apa yang TIDAK berlaku */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Token yang TIDAK berlaku di sini:
            </p>
            <ul className="space-y-1 text-xs">
              {[
                { code: "MBR-", label: "Membership (MBR)" },
                { code: "MRD-", label: "Mader (MRD)" },
                { code: "BDL-", label: "Bundle (BDL)" },
                { code: "RT48-", label: "RT48" },
              ].map((t) => (
                <li key={t.code} className="flex items-center gap-2 text-muted-foreground">
                  <X className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  <span>{t.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {isUniversalAccess && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-xs font-semibold text-amber-200 leading-relaxed">
                ⚠️ Token membership/bundle Anda yang aktif <u>tidak akan bisa membuka show ini</u>.
                Silakan beli akses tambahan menggunakan opsi di bawah.
              </p>
            </div>
          )}

          {/* Opsi pembelian */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Opsi pembelian tersedia:
            </p>

            {hasCoin && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                      <Coins className="h-3.5 w-3.5" /> Bayar dengan Koin
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Akses instan tanpa konfirmasi admin.
                    </p>
                  </div>
                  <span className="text-base font-bold text-amber-300 whitespace-nowrap">
                    {coinPrice} 🪙
                  </span>
                </div>
                <Button
                  onClick={handleCoinPurchase}
                  className="w-full bg-[hsl(var(--warning))] hover:bg-[hsl(var(--warning))]/90 text-primary-foreground"
                  size="sm"
                >
                  <Coins className="h-3.5 w-3.5 mr-1.5" /> Beli {coinPrice} Koin
                </Button>
              </div>
            )}

            {hasQris && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-primary flex items-center gap-1.5">
                      <MessageCircle className="h-3.5 w-3.5" /> Bayar via QRIS
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Transfer & konfirmasi via WhatsApp.
                    </p>
                  </div>
                  <span className="text-base font-bold text-primary whitespace-nowrap">
                    {displayPrice}
                  </span>
                </div>
                <Button
                  onClick={handleQrisBuy}
                  className="w-full bg-primary hover:bg-primary/90"
                  size="sm"
                >
                  <MessageCircle className="h-3.5 w-3.5 mr-1.5" /> Beli via QRIS
                </Button>
              </div>
            )}

            {!hasCoin && !hasQris && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <p className="text-xs text-muted-foreground">
                  Belum ada opsi pembelian aktif. Silakan hubungi admin.
                </p>
              </div>
            )}
          </div>

          {/* Apa yang DIDAPAT */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Yang Anda dapat setelah membeli:
            </p>
            <ul className="space-y-1 text-xs">
              {[
                show.is_replay ? "Akses replay show ini" : "Akses live streaming show ini",
                "Token khusus untuk show ini",
                show.access_password ? "Sandi akses (jika tersedia)" : null,
              ].filter(Boolean).map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-foreground/85">
                  <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ExclusiveShowDetailDialog;
