import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Clock, Trash2, Image, Coins } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface CoinOrder {
  id: string; user_id: string; package_id: string; coin_amount: number;
  payment_proof_url: string; status: string; created_at: string;
}

const CoinOrderManager = () => {
  const [orders, setOrders] = useState<CoinOrder[]>([]);
  const [packages, setPackages] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"pending" | "confirmed" | "rejected" | "all">("pending");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchOrders = async () => {
    const [ordersRes, pkgRes] = await Promise.all([
      supabase.from("coin_orders").select("*").order("created_at", { ascending: false }),
      supabase.from("coin_packages").select("id, name"),
    ]);
    const pkgMap: Record<string, string> = {};
    pkgRes.data?.forEach((p: any) => { pkgMap[p.id] = p.name; });
    setPackages(pkgMap);
    setOrders((ordersRes.data || []) as CoinOrder[]);
  };

  useEffect(() => { fetchOrders(); }, []);

  const confirmOrder = async (id: string) => {
    const { data, error } = await (supabase.rpc as any)("confirm_coin_order", { _order_id: id });
    const result = data as any;
    if (error || !result?.success) {
      toast({ title: "Gagal konfirmasi", description: result?.error || error?.message, variant: "destructive" });
      return;
    }
    await fetchOrders();
    toast({ title: `Dikonfirmasi! Saldo baru: ${result.new_balance} koin` });
  };

  const rejectOrder = async (id: string) => {
    await supabase.from("coin_orders").update({ status: "rejected" }).eq("id", id);
    await fetchOrders();
    toast({ title: "Order ditolak" });
  };

  const deleteOrder = async (id: string) => {
    await supabase.from("coin_orders").delete().eq("id", id);
    await fetchOrders();
    toast({ title: "Order dihapus" });
  };

  const filtered = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-foreground">🪙 Order Koin</h2>
      <div className="flex gap-2 flex-wrap">
        {(["pending", "confirmed", "rejected", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
            {f === "pending" ? "Menunggu" : f === "confirmed" ? "Dikonfirmasi" : f === "rejected" ? "Ditolak" : "Semua"}
            {f !== "all" && ` (${orders.filter((o) => o.status === f).length})`}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.map((order) => (
          <div key={order.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-[hsl(var(--warning))]" />
                  <p className="font-semibold text-foreground">{order.coin_amount} Koin</p>
                  <span className="text-xs text-muted-foreground">— {packages[order.package_id] || "Paket"}</span>
                  <span className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${
                    order.status === "pending" ? "bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]"
                    : order.status === "confirmed" ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
                    : "bg-destructive/20 text-destructive"
                  }`}>
                    {order.status === "pending" ? <Clock className="h-2.5 w-2.5" /> : order.status === "confirmed" ? <CheckCircle className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                    {order.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">{new Date(order.created_at).toLocaleString("id-ID")}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {order.payment_proof_url && (
                  <button onClick={() => setPreviewImage(order.payment_proof_url)} className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80">
                    <Image className="h-3 w-3" /> Bukti
                  </button>
                )}
                {order.status === "pending" && (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => confirmOrder(order.id)} className="h-7 text-xs"><CheckCircle className="mr-1 h-3 w-3" /> Konfirmasi</Button>
                    <Button size="sm" variant="destructive" onClick={() => rejectOrder(order.id)} className="h-7 text-xs"><XCircle className="mr-1 h-3 w-3" /> Tolak</Button>
                  </div>
                )}
                <button onClick={() => deleteOrder(order.id)} className="flex items-center gap-1 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada order</p>}
      </div>
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Bukti Pembayaran</DialogTitle><DialogDescription>Preview bukti transfer</DialogDescription></DialogHeader>
          {previewImage && <img src={previewImage} alt="Bukti" className="w-full rounded-lg" />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CoinOrderManager;
