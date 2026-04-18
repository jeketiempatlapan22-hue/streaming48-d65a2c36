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
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
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
    setSelectedIds(new Set());
  };

  useEffect(() => { fetchOrders(); }, []);

  const confirmOrder = async (id: string) => {
    try {
      setConfirmingId(id);
      const { data, error } = await supabase.rpc("confirm_coin_order", { _order_id: id });
      const result = (typeof data === "string" ? JSON.parse(data) : data) as any;
      if (error || !result?.success) {
        toast({ title: "Gagal konfirmasi", description: result?.error || error?.message || "Terjadi kesalahan", variant: "destructive" });
        return;
      }
      await fetchOrders();
      toast({ title: `Dikonfirmasi! Saldo baru: ${result.new_balance} koin` });
    } catch (err) {
      toast({ title: "Gagal konfirmasi", description: err instanceof Error ? err.message : "Terjadi kesalahan", variant: "destructive" });
    } finally {
      setConfirmingId(null);
    }
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

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (filtered.every(o => selectedIds.has(o.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(o => o.id)));
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Yakin hapus ${count} order yang dipilih?`)) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      // Delete in batches of 50
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        await supabase.from("coin_orders").delete().in("id", batch);
      }
      await fetchOrders();
      toast({ title: `${count} order berhasil dihapus` });
    } catch {
      toast({ title: "Gagal menghapus", variant: "destructive" });
    } finally {
      setBulkDeleting(false);
    }
  };

  const filtered = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-foreground">🪙 Order Koin</h2>
      <div className="flex gap-2 flex-wrap">
        {(["pending", "confirmed", "rejected", "all"] as const).map((f) => (
          <button key={f} onClick={() => { setFilter(f); setSelectedIds(new Set()); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
            {f === "pending" ? "Menunggu" : f === "confirmed" ? "Dikonfirmasi" : f === "rejected" ? "Ditolak" : "Semua"}
            {f !== "all" && ` (${orders.filter((o) => o.status === f).length})`}
          </button>
        ))}
      </div>

      {/* Bulk actions bar */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground">
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every(o => selectedIds.has(o.id))}
              onChange={toggleSelectAll}
              className="rounded border-input"
            />
            Pilih Semua ({filtered.length})
          </label>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-muted-foreground">{selectedIds.size} dipilih</span>
              <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={bulkDeleting} className="h-7 text-xs gap-1">
                <Trash2 className="h-3 w-3" /> {bulkDeleting ? "Menghapus..." : `Hapus (${selectedIds.size})`}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((order) => (
          <div key={order.id} className={`rounded-xl border bg-card p-3 sm:p-4 ${selectedIds.has(order.id) ? "border-primary bg-primary/5" : "border-border"}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={selectedIds.has(order.id)}
                  onChange={() => toggleSelect(order.id)}
                  className="mt-1 rounded border-input cursor-pointer shrink-0"
                />
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
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
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:flex-nowrap">
                {order.payment_proof_url && (
                  <button onClick={() => setPreviewImage(order.payment_proof_url)} className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80">
                    <Image className="h-3 w-3" /> Bukti
                  </button>
                )}
                {order.status === "pending" && (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={() => confirmOrder(order.id)} disabled={confirmingId === order.id} className="h-7 text-xs"><CheckCircle className="mr-1 h-3 w-3" /> {confirmingId === order.id ? "Memproses..." : "Konfirmasi"}</Button>
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
        <DialogContent className="max-w-lg w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bukti Pembayaran</DialogTitle>
            <DialogDescription>Preview bukti transfer</DialogDescription>
          </DialogHeader>
          {previewImage && <img src={previewImage} alt="Bukti" className="w-full rounded-lg" />}
          <Button variant="outline" onClick={() => setPreviewImage(null)} className="w-full mt-2">
            Tutup
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CoinOrderManager;
