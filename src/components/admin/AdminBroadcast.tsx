import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, Megaphone, Trash2, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { formatWIBWithLocal } from "@/lib/timeFormat";

interface BroadcastItem {
  id: string;
  title: string;
  message: string;
  created_at: string;
}

const AdminBroadcast = () => {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const loadBroadcasts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_notifications")
      .select("id, title, message, created_at")
      .eq("type", "broadcast")
      .order("created_at", { ascending: false })
      .limit(50);
    setLoading(false);
    if (error) {
      toast.error("Gagal memuat broadcast");
      return;
    }
    setItems((data || []) as BroadcastItem[]);
  }, []);

  useEffect(() => { loadBroadcasts(); }, [loadBroadcasts]);

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) return;
    setSending(true);
    const { error } = await supabase.from("admin_notifications").insert({
      title: title.trim(),
      message: message.trim(),
      type: "broadcast",
    });
    setSending(false);
    if (error) {
      toast.error("Gagal mengirim broadcast");
    } else {
      toast.success("Broadcast berhasil dikirim!");
      setTitle("");
      setMessage("");
      loadBroadcasts();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus broadcast ini? Pengumuman tidak akan tampil lagi di website.")) return;
    setDeletingId(id);
    const { error } = await supabase.from("admin_notifications").delete().eq("id", id);
    setDeletingId(null);
    if (error) {
      toast.error("Gagal menghapus broadcast");
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
    toast.success("Broadcast dihapus");
  };

  const handleClearAll = async () => {
    if (items.length === 0) return;
    if (!confirm(`Hapus SEMUA ${items.length} broadcast? Tindakan ini tidak bisa dibatalkan.`)) return;
    setClearing(true);
    const { error } = await supabase
      .from("admin_notifications")
      .delete()
      .eq("type", "broadcast");
    setClearing(false);
    if (error) {
      toast.error("Gagal menghapus semua broadcast");
      return;
    }
    setItems([]);
    toast.success("Semua broadcast dihapus");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Broadcast Pengumuman</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Judul</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Judul pengumuman" className="bg-background" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Pesan</label>
            <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Isi pesan broadcast..." rows={3} className="bg-background resize-none" />
          </div>
          <Button onClick={handleSend} disabled={sending || !title.trim() || !message.trim()} className="gap-2">
            <Send className="h-4 w-4" /> {sending ? "Mengirim..." : "Kirim Broadcast"}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Broadcast Aktif ({items.length})</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={loadBroadcasts}
              disabled={loading}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Muat ulang
            </Button>
            {items.length > 0 && (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleClearAll}
                disabled={clearing}
                className="gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" /> {clearing ? "Menghapus..." : "Hapus Semua"}
              </Button>
            )}
          </div>
        </div>

        {loading && items.length === 0 ? (
          <p className="text-xs text-muted-foreground">Memuat...</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada broadcast. Pesan yang dikirim akan tampil di sini dan dapat dihapus kapan saja.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{it.title}</p>
                  <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{it.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    {formatWIBWithLocal(it.created_at)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(it.id)}
                  disabled={deletingId === it.id}
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingId === it.id ? "Menghapus..." : "Hapus"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AdminBroadcast;
