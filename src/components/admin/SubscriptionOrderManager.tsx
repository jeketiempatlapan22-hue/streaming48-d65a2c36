import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Clock, Trash2, Send, Image, SendHorizonal, Coins, Copy, Mail, Save, Search, UserPlus, Phone, Ticket } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Order {
  id: string;
  show_id: string;
  phone: string;
  email: string;
  payment_proof_url: string;
  payment_method: string;
  status: string;
  created_at: string;
  user_id: string | null;
}

interface ShowInfo {
  title: string;
  group_link: string;
  is_subscription: boolean;
  access_password: string;
  is_replay: boolean;
}

interface SubscriptionOrderManagerProps {
  mode?: "membership" | "regular";
}

const SubscriptionOrderManager = ({ mode = "membership" }: SubscriptionOrderManagerProps) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [shows, setShows] = useState<Record<string, ShowInfo>>({});
  const [filter, setFilter] = useState<"all" | "pending" | "confirmed" | "rejected">("pending");
  const [showFilter, setShowFilter] = useState<string>("all");
  const [waMessages, setWaMessages] = useState<Record<string, string>>({});
  const [editEmails, setEditEmails] = useState<Record<string, string>>({});
  const [editPhones, setEditPhones] = useState<Record<string, string>>({});
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  const [savingPhone, setSavingPhone] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [copiedField, setCopiedField] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newOrder, setNewOrder] = useState({ show_id: "", phone: "", email: "" });
  const [addingOrder, setAddingOrder] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchOrders = async () => {
    const { data: ordersData } = await (supabase as any).from("subscription_orders").select("*").order("created_at", { ascending: false });
    const { data: showsData } = await supabase.from("shows").select("id, title, group_link, is_subscription, access_password, is_replay");
    const showMap: Record<string, ShowInfo> = {};
    showsData?.forEach((s: any) => { showMap[s.id] = { title: s.title, group_link: s.group_link || "", is_subscription: s.is_subscription, access_password: s.access_password || "", is_replay: s.is_replay || false }; });
    setShows(showMap);
    setOrders((ordersData as Order[]) || []);
  };

  useEffect(() => { fetchOrders(); }, []);

  const updateStatus = async (id: string, status: string) => {
    if (status === "confirmed") {
      setConfirmingId(id);
      // Use the new RPC that auto-creates tokens for regular shows
      const { data, error } = await supabase.rpc("confirm_regular_order" as any, { _order_id: id });
      setConfirmingId(null);
      const result = data as any;
      if (error || !result?.success) {
        toast({ title: result?.error || error?.message || "Gagal mengkonfirmasi", variant: "destructive" });
        return;
      }
      if (result.token_code) {
        toast({ title: `Order dikonfirmasi! Token: ${result.token_code}` });
      } else {
        toast({ title: "Order dikonfirmasi" });
      }
    } else {
      await (supabase as any).from("subscription_orders").update({ status }).eq("id", id);
      toast({ title: `Order ${status === "rejected" ? "ditolak" : status}` });
    }
    await fetchOrders();
  };

  const deleteOrder = async (id: string) => {
    await (supabase as any).from("subscription_orders").delete().eq("id", id);
    await fetchOrders();
    toast({ title: "Order dihapus" });
  };

  const sendWhatsApp = async (phone: string, message: string) => {
    let cleanPhone = phone.replace(/[^0-9+]/g, "");
    if (cleanPhone.startsWith("+")) {
      cleanPhone = cleanPhone.substring(1);
    } else if (cleanPhone.startsWith("0")) {
      cleanPhone = "62" + cleanPhone.substring(1);
    }
    const isIndonesian = cleanPhone.startsWith("62");
    const target = isIndonesian ? cleanPhone : "+" + cleanPhone;
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: { target, message },
      });
      if (error || !data?.success) {
        toast({ title: "Gagal mengirim WA", variant: "destructive" });
      } else {
        toast({ title: "Pesan WA terkirim!" });
      }
    } catch {
      toast({ title: "Gagal mengirim WA", variant: "destructive" });
    }
  };

  const savePhone = async (id: string) => {
    const newPhone = editPhones[id]?.trim();
    if (!newPhone) return;
    setSavingPhone(id);
    await (supabase as any).from("subscription_orders").update({ phone: newPhone }).eq("id", id);
    await fetchOrders();
    setSavingPhone(null);
    setEditPhones((prev) => { const n = { ...prev }; delete n[id]; return n; });
    toast({ title: "Nomor HP berhasil diperbarui" });
  };

  const saveEmail = async (id: string) => {
    const newEmail = editEmails[id]?.trim();
    if (!newEmail) return;
    setSavingEmail(id);
    await (supabase as any).from("subscription_orders").update({ email: newEmail }).eq("id", id);
    await fetchOrders();
    setSavingEmail(null);
    setEditEmails((prev) => { const n = { ...prev }; delete n[id]; return n; });
    toast({ title: "Email berhasil diperbarui" });
  };

  const copyBulkData = (field: "phone" | "email") => {
    const data = filteredOrders.map((o) => field === "phone" ? o.phone : o.email).filter(Boolean).join("\n");
    navigator.clipboard.writeText(data);
    setCopiedField(field);
    setTimeout(() => setCopiedField(""), 2000);
    toast({ title: `${filteredOrders.length} ${field === "phone" ? "nomor HP" : "email"} disalin` });
  };

  const addManualOrder = async () => {
    if (!newOrder.show_id || !newOrder.phone.trim()) {
      toast({ title: "Show dan nomor HP wajib diisi", variant: "destructive" });
      return;
    }
    setAddingOrder(true);
    const { error } = await (supabase as any).from("subscription_orders").insert({
      show_id: newOrder.show_id,
      phone: newOrder.phone.trim(),
      email: newOrder.email.trim() || null,
      payment_method: "manual",
      status: "confirmed",
    });
    if (error) {
      toast({ title: "Gagal menambahkan order", variant: "destructive" });
    } else {
      toast({ title: "Order manual berhasil ditambahkan" });
      setNewOrder({ show_id: "", phone: "", email: "" });
      setShowAddDialog(false);
      await fetchOrders();
    }
    setAddingOrder(false);
  };

  // Filter orders by mode (membership vs regular)
  const modeOrders = orders.filter((o) => {
    const showInfo = shows[o.show_id];
    if (!showInfo) return false;
    return mode === "membership" ? showInfo.is_subscription : !showInfo.is_subscription;
  });

  // Get available shows for this mode
  const modeShows = Object.entries(shows).filter(([, s]) =>
    mode === "membership" ? s.is_subscription : !s.is_subscription
  );

  // Apply show filter
  const showFiltered = showFilter === "all" ? modeOrders : modeOrders.filter((o) => o.show_id === showFilter);

  // Apply status filter
  const statusFiltered = filter === "all" ? showFiltered : showFiltered.filter((o) => o.status === filter);

  // Apply search
  const filteredOrders = searchQuery.trim()
    ? statusFiltered.filter((o) => {
        const q = searchQuery.toLowerCase();
        return (o.email?.toLowerCase().includes(q)) || (o.phone?.toLowerCase().includes(q)) || (shows[o.show_id]?.title?.toLowerCase().includes(q));
      })
    : statusFiltered;

  const confirmedCount = showFiltered.filter((o) => o.status === "confirmed").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-foreground">
          {mode === "membership" ? "📋 Order Membership" : "🎫 Order Show"}
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)} className="gap-1.5">
            <UserPlus className="h-3.5 w-3.5" /> Tambah Manual
          </Button>
          {confirmedCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => setShowBulk(true)} className="gap-1.5">
              <SendHorizonal className="h-3.5 w-3.5" /> Kirim Massal ({confirmedCount})
            </Button>
          )}
        </div>
      </div>

      {/* Show filter for regular shows */}
      {mode === "regular" && modeShows.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowFilter("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${showFilter === "all" ? "bg-accent text-accent-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
          >
            Semua Show ({modeOrders.length})
          </button>
          {modeShows.map(([id, s]) => {
            const count = modeOrders.filter((o) => o.show_id === id).length;
            return (
              <button
                key={id}
                onClick={() => setShowFilter(id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${showFilter === id ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}
              >
                {s.title} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={mode === "membership" ? "Cari email, nomor HP, atau nama show..." : "Cari nomor HP atau nama show..."}
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(["pending", "confirmed", "rejected", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
            {f === "pending" ? "Menunggu" : f === "confirmed" ? "Dikonfirmasi" : f === "rejected" ? "Ditolak" : "Semua"}
            {f !== "all" && ` (${showFiltered.filter((o) => o.status === f).length})`}
          </button>
        ))}
      </div>

      {filteredOrders.length > 0 && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => copyBulkData("phone")} className="gap-1.5 text-xs">
            <Copy className="h-3 w-3" /> {copiedField === "phone" ? "✓ Disalin!" : `Salin Semua HP (${filteredOrders.length})`}
          </Button>
          {mode === "membership" && (
            <Button size="sm" variant="outline" onClick={() => copyBulkData("email")} className="gap-1.5 text-xs">
              <Copy className="h-3 w-3" /> {copiedField === "email" ? "✓ Disalin!" : `Salin Semua Email (${filteredOrders.length})`}
            </Button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {filteredOrders.map((order) => (
          <div key={order.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-foreground">{shows[order.show_id]?.title || "Unknown"}</p>
                  <span className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${
                    order.status === "pending" ? "bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]"
                    : order.status === "confirmed" ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
                    : "bg-destructive/20 text-destructive"}`}>
                    {order.status === "pending" ? <Clock className="h-2.5 w-2.5" />
                    : order.status === "confirmed" ? <CheckCircle className="h-2.5 w-2.5" />
                    : <XCircle className="h-2.5 w-2.5" />}
                    {order.status.toUpperCase()}
                  </span>
                  {order.payment_method === "coin" && (
                    <span className="flex items-center gap-1 rounded-sm bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                      <Coins className="h-2.5 w-2.5" /> KOIN
                    </span>
                  )}
                  {order.payment_method === "manual" && (
                    <span className="flex items-center gap-1 rounded-sm bg-accent/60 px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">
                      <UserPlus className="h-2.5 w-2.5" /> MANUAL
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                  {editPhones[order.id] !== undefined ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={editPhones[order.id]}
                        onChange={(e) => setEditPhones((prev) => ({ ...prev, [order.id]: e.target.value }))}
                        placeholder="+628xx / +60xx"
                        className="h-7 text-xs w-48"
                      />
                      <Button size="sm" variant="outline" className="h-7 px-2" disabled={savingPhone === order.id}
                        onClick={() => savePhone(order.id)}>
                        <Save className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                        onClick={() => setEditPhones((prev) => { const n = { ...prev }; delete n[order.id]; return n; })}>
                        Batal
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditPhones((prev) => ({ ...prev, [order.id]: order.phone || "" }))}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors">
                      {order.phone || <span className="italic text-muted-foreground/60">Belum ada HP — klik untuk isi</span>}
                    </button>
                  )}
                </div>
                {mode === "membership" && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                    {editEmails[order.id] !== undefined ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={editEmails[order.id]}
                          onChange={(e) => setEditEmails((prev) => ({ ...prev, [order.id]: e.target.value }))}
                          placeholder="Ketik email user..."
                          className="h-7 text-xs w-48"
                        />
                        <Button size="sm" variant="outline" className="h-7 px-2" disabled={savingEmail === order.id}
                          onClick={() => saveEmail(order.id)}>
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                          onClick={() => setEditEmails((prev) => { const n = { ...prev }; delete n[order.id]; return n; })}>
                          Batal
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditEmails((prev) => ({ ...prev, [order.id]: order.email || "" }))}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors">
                        {order.email || <span className="italic text-muted-foreground/60">Belum ada email — klik untuk isi</span>}
                      </button>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">{new Date(order.created_at).toLocaleString("id-ID")}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex gap-1">
                  {order.payment_method !== "coin" && order.payment_method !== "manual" && order.payment_proof_url && (
                    <button onClick={() => setPreviewImage(order.payment_proof_url)}
                      className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80">
                      <Image className="h-3 w-3" /> Lihat Bukti
                    </button>
                  )}
                  <button onClick={() => deleteOrder(order.id)}
                    className="flex items-center gap-1 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {order.status === "pending" && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="default" onClick={() => updateStatus(order.id, "confirmed")} disabled={confirmingId === order.id} className="h-7 text-xs">
                      <CheckCircle className="mr-1 h-3 w-3" /> {confirmingId === order.id ? "..." : "Konfirmasi"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => updateStatus(order.id, "rejected")} className="h-7 text-xs">
                      <XCircle className="mr-1 h-3 w-3" /> Tolak
                    </Button>
                  </div>
                )}
                {order.status === "confirmed" && (
                  <div className="w-full space-y-1">
                    <Textarea value={waMessages[order.id] || ""} onChange={(e) => setWaMessages((prev) => ({ ...prev, [order.id]: e.target.value }))}
                      placeholder="Tulis pesan untuk user ini..." className="h-16 bg-background text-xs" />
                    <Button size="sm" variant="outline" className="h-7 w-full gap-1 text-xs" disabled={!waMessages[order.id]?.trim()}
                      onClick={() => sendWhatsApp(order.phone, waMessages[order.id])}>
                      <Send className="h-3 w-3" /> Kirim via WA
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {filteredOrders.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{searchQuery ? "Tidak ditemukan hasil pencarian" : "Tidak ada order"}</p>}
      </div>

      {/* Preview bukti */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Bukti Pembayaran</DialogTitle><DialogDescription>Preview bukti transfer</DialogDescription></DialogHeader>
          {previewImage && <img src={previewImage} alt="Bukti" className="w-full rounded-lg" />}
        </DialogContent>
      </Dialog>

      {/* Kirim massal */}
      <Dialog open={showBulk} onOpenChange={setShowBulk}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Kirim Pesan Massal</DialogTitle><DialogDescription>Pesan akan dikirim ke {confirmedCount} user yang telah dikonfirmasi via WhatsApp.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Textarea value={bulkMessage} onChange={(e) => setBulkMessage(e.target.value)} placeholder="Tulis pesan..." className="bg-background" rows={4} />
            <Button onClick={() => { const confirmed = showFiltered.filter(o => o.status === "confirmed"); confirmed.forEach(o => { if (bulkMessage.trim()) sendWhatsApp(o.phone, bulkMessage); }); toast({ title: `Mengirim ke ${confirmed.length} user` }); setShowBulk(false); }} disabled={!bulkMessage.trim()} className="w-full gap-2">
              <SendHorizonal className="h-4 w-4" /> Kirim ke Semua ({confirmedCount})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tambah manual */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === "membership" ? "Tambah Member Manual" : "Tambah Order Manual"}</DialogTitle>
            <DialogDescription>{mode === "membership" ? "Tambahkan user baru ke daftar membership secara manual (langsung dikonfirmasi)." : "Tambahkan order show secara manual (langsung dikonfirmasi)."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Show *</label>
              <select
                value={newOrder.show_id}
                onChange={(e) => setNewOrder((p) => ({ ...p, show_id: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Pilih show...</option>
                {modeShows.map(([id, s]) => (
                  <option key={id} value={id}>{s.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                <Phone className="inline h-3 w-3 mr-1" />Nomor WhatsApp *
              </label>
              <Input
                value={newOrder.phone}
                onChange={(e) => setNewOrder((p) => ({ ...p, phone: e.target.value }))}
                placeholder="+628xxxxxxxxxx atau +60xxxxxxxxxx"
              />
            </div>
            {mode === "membership" && (
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">
                  <Mail className="inline h-3 w-3 mr-1" />Email (opsional)
                </label>
                <Input
                  value={newOrder.email}
                  onChange={(e) => setNewOrder((p) => ({ ...p, email: e.target.value }))}
                  placeholder="user@email.com"
                />
              </div>
            )}
            <Button onClick={addManualOrder} disabled={addingOrder || !newOrder.show_id || !newOrder.phone.trim()} className="w-full gap-2">
              <UserPlus className="h-4 w-4" /> {addingOrder ? "Menyimpan..." : mode === "membership" ? "Tambah Member" : "Tambah Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SubscriptionOrderManager;
