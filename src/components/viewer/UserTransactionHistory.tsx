import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { History, Coins, Ticket, ShoppingBag, ArrowDown, ArrowUp, Filter, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Tx {
  id: string;
  kind: "coin_in" | "coin_out" | "order_show" | "membership";
  amount?: number;
  title: string;
  subtitle?: string;
  status?: string;
  paymentMethod?: string;
  created_at: string;
}

const kindMeta: Record<Tx["kind"], { icon: any; color: string; bg: string; label: string }> = {
  coin_in: { icon: ArrowDown, color: "text-[hsl(var(--success))]", bg: "bg-[hsl(var(--success))]/10", label: "Koin Masuk" },
  coin_out: { icon: ArrowUp, color: "text-[hsl(var(--warning))]", bg: "bg-[hsl(var(--warning))]/10", label: "Koin Pakai" },
  order_show: { icon: ShoppingBag, color: "text-primary", bg: "bg-primary/10", label: "Order Show" },
  membership: { icon: Ticket, color: "text-accent", bg: "bg-accent/10", label: "Membership" },
};

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "coin_in", label: "Koin Masuk" },
  { value: "coin_out", label: "Koin Pakai" },
  { value: "order_show", label: "Order" },
  { value: "membership", label: "Membership" },
];

const formatWIB = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) + " WIB";

const prettyPaymentMethod = (m?: string) => {
  if (!m) return undefined;
  const lower = m.toLowerCase();
  if (lower === "qris") return "QRIS";
  if (lower === "coin" || lower === "coins") return "Koin";
  if (lower === "manual") return "Manual";
  return m.charAt(0).toUpperCase() + m.slice(1);
};

interface Props {
  userId: string;
  /** When true, query as admin (RLS allows full access). */
  isAdmin?: boolean;
}

const UserTransactionHistory = ({ userId, isAdmin = false }: Props) => {
  const [items, setItems] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const [coinTxRes, ordersRes, coinOrdersRes] = await Promise.allSettled([
          supabase
            .from("coin_transactions")
            .select("id, amount, type, description, created_at, reference_id")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(100),
          supabase
            .from("subscription_orders")
            .select("id, status, payment_method, created_at, show_id, payment_status")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(100),
          supabase
            .from("coin_orders")
            .select("id, status, coin_amount, price, created_at, package_id")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(100),
        ]);

        const coinTx = coinTxRes.status === "fulfilled" ? coinTxRes.value.data || [] : [];
        const orders = ordersRes.status === "fulfilled" ? ordersRes.value.data || [] : [];
        const coinOrders = coinOrdersRes.status === "fulfilled" ? coinOrdersRes.value.data || [] : [];

        // Resolve show titles via the public RPC (RLS on shows is admin-only).
        const showIds = Array.from(new Set(orders.map((o: any) => o.show_id).filter(Boolean)));
        let showMap: Record<string, { title: string; is_subscription: boolean }> = {};
        if (showIds.length) {
          try {
            const { data: showsData } = await (supabase as any).rpc("get_public_shows");
            (showsData || []).forEach((s: any) => {
              if (s?.id && showIds.includes(s.id)) {
                showMap[s.id] = { title: s.title, is_subscription: !!s.is_subscription };
              }
            });
          } catch { /* leave empty */ }
        }

        const merged: Tx[] = [
          ...coinTx.map((t: any): Tx => {
            const isIn = t.amount > 0;
            // Better default labels
            let title = t.description || (isIn ? "Penambahan koin" : "Penggunaan koin");
            return {
              id: `c-${t.id}`,
              kind: isIn ? "coin_in" : "coin_out",
              amount: t.amount,
              title,
              subtitle: `${Math.abs(t.amount).toLocaleString("id-ID")} koin`,
              created_at: t.created_at,
            };
          }),
          ...orders.map((o: any): Tx => {
            const sh = showMap[o.show_id];
            const isMembership = sh?.is_subscription;
            return {
              id: `o-${o.id}`,
              kind: isMembership ? "membership" : "order_show",
              title: sh?.title || "Show",
              subtitle: isMembership ? "Akses Membership" : "Tiket Live",
              status: o.status,
              paymentMethod: prettyPaymentMethod(o.payment_method),
              created_at: o.created_at,
            };
          }),
          ...coinOrders.map((o: any): Tx => ({
            id: `co-${o.id}`,
            kind: "coin_in",
            amount: o.coin_amount,
            title: `Pembelian ${o.coin_amount?.toLocaleString("id-ID") || 0} Koin`,
            subtitle: o.price ? `Total: ${o.price}` : undefined,
            status: o.status,
            paymentMethod: "QRIS",
            created_at: o.created_at,
          })),
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        // Defensive dedup: hide legacy duplicate rows that may exist in DB
        // (e.g. caused by an old trigger that double-logged token redeems).
        // Key combines kind+amount+title+created_at (truncated to second).
        const seen = new Set<string>();
        const deduped = merged.filter((tx) => {
          const key = `${tx.kind}|${tx.amount ?? ""}|${tx.title}|${new Date(tx.created_at).toISOString().slice(0, 19)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        if (mounted) setItems(deduped);
      } catch {
        if (mounted) setItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [userId, isAdmin]);

  const filtered = filter === "all" ? items : items.filter(i => i.kind === filter);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-14 skeleton rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {FILTERS.map(f => (
          <Button
            key={f.value}
            variant={filter === f.value ? "default" : "outline"}
            size="sm"
            className="h-7 text-[10px] px-2.5 shrink-0"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center">
          <History className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-xs text-muted-foreground">Belum ada transaksi</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
          {filtered.map((tx, i) => {
            const meta = kindMeta[tx.kind];
            const Icon = meta.icon;
            return (
              <motion.div
                key={tx.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.3) }}
                className="glass rounded-lg p-3 flex items-start gap-3"
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.bg}`}>
                  <Icon className={`h-4 w-4 ${meta.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{tx.title}</p>
                  {tx.subtitle && (
                    <p className="text-[10px] text-muted-foreground truncate">{tx.subtitle}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                    <p className="text-[10px] text-muted-foreground">{formatWIB(tx.created_at)}</p>
                    {tx.paymentMethod && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <CreditCard className="h-2.5 w-2.5" /> {tx.paymentMethod}
                      </span>
                    )}
                    {tx.status && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        tx.status === "confirmed" ? "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]" :
                        tx.status === "pending" ? "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]" :
                        "bg-destructive/15 text-destructive"
                      }`}>
                        {tx.status === "confirmed" ? "Dikonfirmasi" : tx.status === "pending" ? "Menunggu" : tx.status}
                      </span>
                    )}
                  </div>
                </div>
                {tx.amount !== undefined && (
                  <div className={`flex items-center gap-1 text-xs font-bold whitespace-nowrap ${meta.color}`}>
                    <Coins className="h-3 w-3" />
                    {tx.amount > 0 ? "+" : ""}{tx.amount.toLocaleString("id-ID")}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UserTransactionHistory;
