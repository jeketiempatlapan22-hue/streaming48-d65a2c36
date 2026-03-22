import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Plus, Pencil, Trash2, LogOut, Shield, Radio, Film, MonitorPlay, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Stream = Tables<"streams">;
type StreamType = "m3u8" | "cloudflare" | "youtube";

const typeIcons: Record<StreamType, React.ReactNode> = {
  m3u8: <Radio className="w-4 h-4" />,
  cloudflare: <Film className="w-4 h-4" />,
  youtube: <MonitorPlay className="w-4 h-4" />,
};

const Admin = () => {
  const { user, isAdmin, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<StreamType>("m3u8");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      navigate("/login");
    }
  }, [user, isAdmin, loading, navigate]);

  const fetchStreams = async () => {
    const { data, error } = await supabase
      .from("streams")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Gagal memuat streams");
    } else {
      setStreams(data || []);
    }
    setLoadingStreams(false);
  };

  useEffect(() => {
    if (isAdmin) fetchStreams();
  }, [isAdmin]);

  const resetForm = () => {
    setTitle("");
    setUrl("");
    setType("m3u8");
    setIsActive(true);
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (stream: Stream) => {
    setTitle(stream.title);
    setUrl(stream.url);
    setType(stream.type as StreamType);
    setIsActive(stream.is_active);
    setEditingId(stream.id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;
    setSubmitting(true);

    if (editingId) {
      const { error } = await supabase
        .from("streams")
        .update({ title: title.trim(), url: url.trim(), type, is_active: isActive })
        .eq("id", editingId);
      if (error) toast.error("Gagal mengupdate stream");
      else toast.success("Stream berhasil diupdate");
    } else {
      const { error } = await supabase
        .from("streams")
        .insert({ title: title.trim(), url: url.trim(), type, is_active: isActive, created_by: user?.id });
      if (error) toast.error("Gagal menambahkan stream");
      else toast.success("Stream berhasil ditambahkan");
    }

    resetForm();
    setSubmitting(false);
    fetchStreams();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Yakin ingin menghapus stream ini?")) return;
    const { error } = await supabase.from("streams").delete().eq("id", id);
    if (error) toast.error("Gagal menghapus stream");
    else {
      toast.success("Stream dihapus");
      fetchStreams();
    }
  };

  const handleToggleActive = async (stream: Stream) => {
    const { error } = await supabase
      .from("streams")
      .update({ is_active: !stream.is_active })
      .eq("id", stream.id);
    if (error) toast.error("Gagal mengubah status");
    else fetchStreams();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Play className="w-4 h-4 text-primary fill-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Admin Panel</h1>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Beranda
            </a>
            <button
              onClick={() => { signOut(); navigate("/login"); }}
              className="px-3 py-2 text-sm text-destructive hover:text-destructive/80 transition-colors flex items-center gap-1.5 active:scale-[0.97]"
            >
              <LogOut className="w-3.5 h-3.5" />
              Keluar
            </button>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Add button */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Kelola Stream</h2>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:brightness-110 active:scale-[0.97] transition-all flex items-center gap-2 shadow-lg shadow-primary/20"
          >
            <Plus className="w-4 h-4" />
            Tambah Stream
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-4 shadow-xl shadow-black/20 opacity-0 animate-fade-in-up">
            <h3 className="font-semibold text-sm">{editingId ? "Edit Stream" : "Tambah Stream Baru"}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Judul</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Nama stream"
                    className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Tipe</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as StreamType)}
                    className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                  >
                    <option value="m3u8">M3U8 / HLS</option>
                    <option value="cloudflare">Cloudflare Stream</option>
                    <option value="youtube">YouTube</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">URL / ID</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="URL stream atau video ID"
                  className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-border"
                />
                <label htmlFor="is_active" className="text-sm text-muted-foreground">Aktif (tampil di beranda)</label>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:brightness-110 active:scale-[0.97] transition-all disabled:opacity-40"
                >
                  {submitting ? "Menyimpan..." : editingId ? "Update" : "Simpan"}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-5 py-2.5 bg-secondary text-secondary-foreground rounded-lg text-sm hover:bg-secondary/80 active:scale-[0.97] transition-all"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Stream list */}
        {loadingStreams ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : streams.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">Belum ada stream. Tambahkan yang pertama!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {streams.map((stream) => (
              <div
                key={stream.id}
                className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 hover:border-primary/30 transition-colors group"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${stream.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {typeIcons[stream.type as StreamType] || <Radio className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-sm truncate">{stream.title}</h4>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wider ${stream.is_active ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"}`}>
                      {stream.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{stream.url}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleToggleActive(stream)}
                    className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground active:scale-[0.95]"
                    title={stream.is_active ? "Nonaktifkan" : "Aktifkan"}
                  >
                    {stream.is_active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleEdit(stream)}
                    className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground active:scale-[0.95]"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(stream.id)}
                    className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive active:scale-[0.95]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Admin;
