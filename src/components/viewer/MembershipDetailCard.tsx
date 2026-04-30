import { motion } from "framer-motion";
import { Crown, Calendar, Clock, Film, ShieldCheck, PlayCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MembershipDetailCardProps {
  token: {
    id: string;
    code: string;
    status: string;
    created_at: string;
    expires_at: string | null;
  };
  showCount: number;
  /** Pre-formatted price string (e.g. "Rp 28.000" or "120 koin"). Null = sembunyikan kotak harga. */
  purchasePrice?: string | null;
  /** Saat true, tampilkan skeleton untuk Akses Show & Harga (data belum siap). */
  metaLoading?: boolean;
  onWatchLive: () => void;
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

const MembershipDetailCard = ({ token, showCount, purchasePrice, metaLoading = false, onWatchLive }: MembershipDetailCardProps) => {
  const startedAt = new Date(token.created_at);
  const expiresAt = token.expires_at ? new Date(token.expires_at) : null;
  const now = new Date();

  const totalMs = expiresAt ? Math.max(1, expiresAt.getTime() - startedAt.getTime()) : 0;
  const remainingMs = expiresAt ? Math.max(0, expiresAt.getTime() - now.getTime()) : 0;

  const totalDays = expiresAt ? Math.max(1, Math.round(totalMs / 86_400_000)) : 0;
  const daysLeft = expiresAt ? Math.max(0, Math.ceil(remainingMs / 86_400_000)) : 0;
  const progress = totalDays > 0 ? Math.min(100, Math.max(0, (daysLeft / totalDays) * 100)) : 0;

  const isExpired = expiresAt ? remainingMs <= 0 : false;
  const isActive = token.status === "active" && !isExpired;

  // Bar warna berdasarkan urgensi
  const barColor = isExpired
    ? "bg-muted-foreground/30"
    : daysLeft <= 3
    ? "bg-gradient-to-r from-destructive to-destructive/70"
    : daysLeft <= 7
    ? "bg-gradient-to-r from-orange-500 to-yellow-500"
    : "bg-gradient-to-r from-yellow-500 to-amber-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-yellow-500/30 bg-gradient-to-br from-yellow-500/10 via-amber-500/5 to-background p-4 sm:p-5 space-y-4 backdrop-blur-md"
    >
      {/* Glow accent */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-yellow-500/20 blur-3xl" />

      {/* Header */}
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-500/20 ring-1 ring-yellow-500/40">
            <Crown className="h-6 w-6 text-yellow-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-foreground leading-tight">Membership Aktif</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Nikmati akses premium ke semua show!</p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
            isActive
              ? "border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {isActive ? "AKTIF" : "BERAKHIR"}
        </span>
      </div>

      {/* Progress bar sisa waktu */}
      {expiresAt && (
        <div className="relative space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Sisa waktu</span>
            <span className={`font-bold ${daysLeft <= 3 && !isExpired ? "text-destructive" : "text-foreground"}`}>
              {daysLeft} / {totalDays} hari
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted/40">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className={`h-full rounded-full ${barColor}`}
            />
          </div>
        </div>
      )}

      {/* 4 Mini stats */}
      <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-2">
        {metaLoading ? (
          <>
            <StatTileSkeleton label="Durasi" />
            <StatTileSkeleton label="Sisa" />
            <StatTileSkeleton label="Akses Show" />
            <StatTileSkeleton label="Status" />
          </>
        ) : (
          <>
            <StatTile icon={<Calendar className="h-3.5 w-3.5" />} label="Durasi" value={`${totalDays} hari`} accent="text-foreground" />
            <StatTile
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Sisa"
              value={isExpired ? "0 hari" : `${daysLeft} hari`}
              accent={isExpired ? "text-destructive" : daysLeft <= 3 ? "text-destructive" : "text-yellow-400"}
            />
            <StatTile icon={<Film className="h-3.5 w-3.5" />} label="Akses Show" value={`${showCount} show`} accent="text-foreground" />
            <StatTile
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              label="Status"
              value={isActive ? "Premium" : "Habis"}
              accent={isActive ? "text-[hsl(var(--success))]" : "text-muted-foreground"}
            />
          </>
        )}
      </div>

      {/* 3 Detail tanggal & harga */}
      <div className={`relative grid gap-2 ${(purchasePrice || metaLoading) ? "grid-cols-3" : "grid-cols-2"}`}>
        {metaLoading ? (
          <>
            <DetailBoxSkeleton label="Mulai" />
            <DetailBoxSkeleton label="Berakhir" />
            <DetailBoxSkeleton label="Harga" />
          </>
        ) : (
          <>
            <DetailBox label="Mulai" value={fmtDate(startedAt)} />
            <DetailBox label="Berakhir" value={expiresAt ? fmtDate(expiresAt) : "Tanpa batas"} highlight={isActive && daysLeft <= 3} />
            {purchasePrice && <DetailBox label="Harga" value={purchasePrice} accent="text-yellow-400" />}
          </>
        )}
      </div>

      {/* Action */}
      {isActive && (
        <div className="relative">
          <Button onClick={onWatchLive} className="w-full gap-2 bg-gradient-to-r from-yellow-500 to-amber-500 text-black hover:opacity-90 font-bold">
            <PlayCircle className="h-4 w-4" />
            Tonton Live Sekarang
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground font-mono truncate">{token.code}</p>
        </div>
      )}
      {!isActive && (
        <div className="relative rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-center">
          <p className="text-[11px] font-medium text-destructive">⚠️ Membership ini sudah berakhir. Perpanjang untuk akses kembali.</p>
        </div>
      )}
    </motion.div>
  );
};

const StatTile = ({
  icon,
  label,
  value,
  accent = "text-foreground",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) => (
  <div className="rounded-xl border border-border/50 bg-background/40 px-2.5 py-2 text-center backdrop-blur-sm">
    <div className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-md bg-muted/40 text-muted-foreground">
      {icon}
    </div>
    <p className="text-[9px] uppercase tracking-wider text-muted-foreground/80 font-medium">{label}</p>
    <p className={`text-xs font-bold ${accent} leading-tight mt-0.5`}>{value}</p>
  </div>
);

const DetailBox = ({
  label,
  value,
  accent = "text-foreground",
  highlight = false,
}: {
  label: string;
  value: string;
  accent?: string;
  highlight?: boolean;
}) => (
  <div className={`rounded-lg border px-2.5 py-2 ${highlight ? "border-destructive/40 bg-destructive/5" : "border-border/50 bg-background/40"}`}>
    <p className="text-[9px] uppercase tracking-wider text-muted-foreground/80 font-medium">{label}</p>
    <p className={`text-[11px] font-bold leading-tight mt-0.5 ${highlight ? "text-destructive" : accent}`}>{value}</p>
  </div>
);


const StatTileSkeleton = ({ label }: { label: string }) => (
  <div className="rounded-xl border border-border/50 bg-background/40 px-2.5 py-2 text-center backdrop-blur-sm">
    <div className="mx-auto mb-1 h-6 w-6 rounded-md skeleton" />
    <p className="text-[9px] uppercase tracking-wider text-muted-foreground/80 font-medium">{label}</p>
    <div className="mx-auto mt-1 h-3 w-12 rounded skeleton" />
  </div>
);

const DetailBoxSkeleton = ({ label }: { label: string }) => (
  <div className="rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
    <p className="text-[9px] uppercase tracking-wider text-muted-foreground/80 font-medium">{label}</p>
    <div className="mt-1 h-3 w-16 rounded skeleton" />
  </div>
);

export default MembershipDetailCard;
