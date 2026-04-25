import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, Megaphone, Trash2, RefreshCw, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { formatWIBWithLocal } from "@/lib/timeFormat";

interface BroadcastItem {
  id: string;
  title: string;
  message: string;
  created_at: string;
  expires_at: string | null;
}

const PRESETS: { label: string; minutes: number }[] = [
  { label: "1 jam", minutes: 60 },
  { label: "6 jam", minutes: 60 * 6 },
  { label: "1 hari", minutes: 60 * 24 },
  { label: "3 hari", minutes: 60 * 24 * 3 },
  { label: "7 hari", minutes: 60 * 24 * 7 },
];

// Convert ISO -> value usable by <input type="datetime-local"> (local time)
const isoToLocalInput = (iso: string) => {
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
};

const AdminBroadcast = () => {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [expiresAtLocal, setExpiresAtLocal] = useState<string>(""); // datetime-local string
  const [sending, setSending] = useState(false);
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [now, setNow] = useState(Date.now());

  // tick every 30s so "expired" labels refresh without reload
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const loadBroadcasts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_notifications")
      .select("id, title, message, created_at, expires_at")
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

  const applyPreset = (minutes: number) => {
    const d = new Date(Date.now() + minutes * 60_000);
    setExpiresAtLocal(isoToLocalInput(d.toISOString()));
  };

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) return;
    let expiresAtIso: string | null = null;
    if (expiresAtLocal) {
      const d = new Date(expiresAtLocal);
      if (isNaN(d.getTime())) {
        toast.error("Format waktu kedaluwarsa tidak valid");
        return;
      }
      if (d.getTime() <= Date.now()) {
        toast.error("Waktu kedaluwarsa harus di masa depan");
        return;
      }
      expiresAtIso = d.toISOString();
    }
    setSending(true);
    const { error } = await supabase.from("admin_notifications").insert({
      title: title.trim(),
      message: message.trim(),
      type: "broadcast",
      expires_at: expiresAtIso,
    });
    setSending(false);
    if (error) {
      toast.error("Gagal mengirim broadcast");
    } else {
      toast.success(expiresAtIso ? "Broadcast terkirim — akan hilang otomatis pada waktunya" : "Broadcast berhasil dikirim!");
      setTitle("");
      setMessage("");
      setExpiresAtLocal("");
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

  const handleClearExpired = async () => {
    const expired = items.filter((it) => it.expires_at && new Date(it.expires_at).getTime() <= now);
    if (expired.length === 0) {
      toast.info("Tidak ada broadcast yang sudah kedaluwarsa");
      return;
    }
    if (!confirm(`Hapus ${expired.length} broadcast kedaluwarsa?`)) return;
    const ids = expired.map((it) => it.id);
    const { error } = await supabase.from("admin_notifications").delete().in("id", ids);
    if (error) {
      toast.error("Gagal menghapus broadcast kedaluwarsa");
      return;
    }
    setItems((prev) => prev.filter((it) => !ids.includes(it.id)));
    toast.success(`${expired.length} broadcast kedaluwarsa dihapus`);
  };

  const formatRemaining = (iso: string) => {
    const ms = new Date(iso).getTime() - now;
    if (ms <= 0) return "kedaluwarsa";
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `sisa ${mins} mnt`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `sisa ${hours} jam`;
    const days = Math.floor(hours / 24);
    return `sisa ${days} hari`;
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
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Kedaluwarsa (opsional) — broadcast otomatis hilang setelah waktu ini
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="datetime-local"
                value={expiresAtLocal}
                onChange={(e) => setExpiresAtLocal(e.target.value)}
                className="bg-background w-auto flex-1 min-w-[180px]"
              />
              {expiresAtLocal && (
                <Button size="sm" variant="ghost" onClick={() => setExpiresAtLocal("")} className="text-xs">
                  Bersihkan
                </Button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  size="sm"
                  variant="outline"
                  onClick={() => applyPreset(p.minutes)}
                  className="h-7 text-[10px] px-2.5"
                >
                  +{p.label}
                </Button>
              ))}
            </div>
            {!expiresAtLocal && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">Kosongkan untuk broadcast tanpa batas waktu (harus dihapus manual).</p>
            )}
          </div>
          <Button onClick={handleSend} disabled={sending || !title.trim() || !message.trim()} className="gap-2">
            <Send className="h-4 w-4" /> {sending ? "Mengirim..." : "Kirim Broadcast"}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Broadcast Aktif ({items.length})</h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={loadBroadcasts}
              disabled={loading}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Muat ulang
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleClearExpired}
              className="gap-1.5"
            >
              <Clock className="h-3.5 w-3.5" /> Hapus Kedaluwarsa
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
            {items.map((it) => {
              const isExpired = !!it.expires_at && new Date(it.expires_at).getTime() <= now;
              return (
                <li
                  key={it.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${isExpired ? "border-border/40 bg-muted/30 opacity-70" : "border-border/60 bg-background/40"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{it.title}</p>
                      {it.expires_at && (
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          isExpired
                            ? "bg-destructive/15 text-destructive"
                            : "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]"
                        }`}>
                          <Clock className="h-2.5 w-2.5" />
                          {isExpired ? "Kedaluwarsa" : formatRemaining(it.expires_at)}
                        </span>
                      )}
                      {!it.expires_at && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Tanpa batas</span>
                      )}
                    </div>
                    <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{it.message}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground/70">
                      Dibuat: {formatWIBWithLocal(it.created_at)}
                    </p>
                    {it.expires_at && (
                      <p className="text-[10px] text-muted-foreground/70">
                        Berakhir: {formatWIBWithLocal(it.expires_at)}
                      </p>
                    )}
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
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AdminBroadcast;
