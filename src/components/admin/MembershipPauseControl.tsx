import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pause, Play, AlertTriangle } from "lucide-react";

interface Props {
  /** Jumlah token membership aktif (untuk info "X token terdampak") */
  affectedCount?: number;
}

const MembershipPauseControl = ({ affectedCount = 0 }: Props) => {
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { toast } = useToast();

  // Fetch initial state + realtime sync
  useEffect(() => {
    let mounted = true;
    const fetchState = async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "membership_paused")
        .maybeSingle();
      if (mounted) {
        setPaused(data?.value === "true");
        setLoading(false);
      }
    };
    fetchState();

    const ch = supabase
      .channel("membership-pause-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_settings", filter: "key=eq.membership_paused" },
        (payload: any) => {
          const v = payload.new?.value ?? "false";
          setPaused(v === "true");
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);

  const applyPause = async (next: boolean) => {
    setSubmitting(true);
    try {
      const { data, error } = await (supabase.rpc as any)("set_membership_pause", { _paused: next });
      if (error || !(data as any)?.success) {
        toast({
          title: "Gagal",
          description: (data as any)?.error || error?.message || "Tidak dapat mengubah status.",
          variant: "destructive",
        });
        return;
      }

      // Broadcast ke semua perangkat live & landing/schedule
      try {
        const ch = supabase.channel("membership-control");
        await ch.subscribe();
        await ch.send({
          type: "broadcast",
          event: next ? "membership_paused" : "membership_resumed",
          payload: { at: Date.now() },
        });
        setTimeout(() => supabase.removeChannel(ch), 1500);
      } catch {}

      setPaused(next);
      toast({
        title: next ? "Membership dijeda" : "Membership diaktifkan",
        description: next
          ? `Akses live dihentikan. ${(data as any)?.affected_sessions ?? 0} sesi diputus.`
          : "Holder membership bisa mengakses live kembali.",
      });
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  const handleToggle = (next: boolean) => {
    if (next) {
      setConfirmOpen(true); // konfirmasi saat menjeda
    } else {
      applyPause(false); // langsung saat mengaktifkan
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
        <div className="h-16 animate-pulse rounded-xl bg-muted/30" />
      </div>
    );
  }

  return (
    <>
      <div
        className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 transition-all ${
          paused
            ? "border-destructive/40 bg-gradient-to-br from-destructive/15 via-destructive/5 to-transparent"
            : "border-[hsl(var(--success))]/30 bg-gradient-to-br from-[hsl(var(--success))]/10 via-card/50 to-transparent"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                paused ? "bg-destructive/20 text-destructive" : "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
              }`}
            >
              {paused ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold sm:text-base">
                  {paused ? "Membership Dijeda" : "Membership Aktif"}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    paused
                      ? "bg-destructive/20 text-destructive"
                      : "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
                  }`}
                >
                  {paused ? "OFF" : "ON"}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                {paused
                  ? "Holder MBR-/MRD- tidak dapat masuk live. Kartu show tampil sebagai berbayar."
                  : "Holder MBR-/MRD- dapat menonton live & semua kartu show terbuka."}
              </p>
              {affectedCount > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Terdampak: <span className="font-semibold text-foreground">{affectedCount}</span> token membership aktif
                </p>
              )}
            </div>
          </div>
          <Switch
            checked={paused}
            disabled={submitting}
            onCheckedChange={handleToggle}
            aria-label="Jeda membership"
          />
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Jeda Akses Membership?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Semua holder token <strong>MBR-</strong> / <strong>MRD-</strong> yang sedang menonton akan
                <strong> langsung dikeluarkan</strong> dari halaman live.
              </span>
              <span className="block">
                Di landing page & jadwal, kartu show akan kembali tampil sebagai <strong>show berbayar</strong>{" "}
                untuk semua holder membership.
              </span>
              <span className="block">
                Token tidak diubah — saat kamu aktifkan kembali, semuanya otomatis berfungsi normal.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => applyPause(true)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Ya, Jeda Sekarang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default MembershipPauseControl;
