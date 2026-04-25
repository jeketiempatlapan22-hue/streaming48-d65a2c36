import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Pencil, Check, X, ArrowUp, ArrowDown } from "lucide-react";
import { encryptEmbedId, decryptEmbedId } from "@/lib/embedCrypto";

const PlaylistManager = () => {
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("youtube");
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editType, setEditType] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const { toast } = useToast();

  const fetchPlaylists = async () => {
    const { data } = await supabase.from("playlists").select("*").order("sort_order");
    setPlaylists(data || []);
  };

  useEffect(() => { fetchPlaylists(); }, []);

  const addPlaylist = async () => {
    if (!newTitle) return;
    if (newType !== "proxy" && !newUrl) return;
    setLoading(true);
    const urlToSave = newType === "youtube" ? encryptEmbedId(newUrl) : (newType === "proxy" ? "proxy" : newUrl);
    const { error } = await supabase.from("playlists").insert({ title: newTitle, type: newType, url: urlToSave, sort_order: playlists.length });
    if (error) {
      toast({ title: "Gagal menambah playlist: " + error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    setNewTitle(""); setNewUrl("");
    await fetchPlaylists();
    toast({ title: "Playlist ditambahkan!" });
    setLoading(false);
  };

  const movePlaylist = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= playlists.length) return;
    const current = playlists[index];
    const target = playlists[targetIndex];
    await Promise.all([
      supabase.from("playlists").update({ sort_order: target.sort_order }).eq("id", current.id),
      supabase.from("playlists").update({ sort_order: current.sort_order }).eq("id", target.id),
    ]);
    await fetchPlaylists();
  };

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setEditTitle(p.title);
    setEditType(p.type);
    setEditUrl(p.type === "youtube" ? decryptEmbedId(p.url) : p.url);
  };
  const cancelEdit = () => { setEditingId(null); };

  const saveEdit = async () => {
    if (!editingId || !editTitle || (editType !== "proxy" && !editUrl)) return;
    const urlToSave = editType === "youtube" ? encryptEmbedId(editUrl) : (editType === "proxy" ? "proxy" : editUrl);
    const { error } = await supabase.from("playlists").update({ title: editTitle, type: editType, url: urlToSave }).eq("id", editingId);
    if (!error) { toast({ title: "Playlist diperbarui!" }); setEditingId(null); await fetchPlaylists(); }
    else toast({ title: "Gagal memperbarui", variant: "destructive" });
  };

  const deletePlaylist = async (id: string) => {
    await supabase.from("playlists").delete().eq("id", id);
    await fetchPlaylists();
    toast({ title: "Playlist dihapus" });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-foreground">📋 Playlist Manager</h2>
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold text-foreground">Tambah Sumber Video</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Label (e.g. Server 1)" className="bg-background" />
          <Select value={newType} onValueChange={setNewType}>
            <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="youtube">YouTube</SelectItem>
              <SelectItem value="m3u8">M3U8 (Signed)</SelectItem>
              <SelectItem value="direct">Direct M3U8</SelectItem>
              <SelectItem value="cloudflare">Cloudflare Stream</SelectItem>
              <SelectItem value="proxy">Proxy Stream (Hanabira48)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {newType !== "proxy" && <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="URL atau ID video" className="bg-background" />}
        {newType === "proxy" && <p className="text-xs text-muted-foreground rounded-lg bg-secondary/50 p-2">⚡ Proxy Stream menggunakan API Hanabira48 — header otomatis dirotasi</p>}
        {newType === "direct" && <p className="text-xs text-muted-foreground rounded-lg bg-secondary/50 p-2">🔗 Direct M3U8 memutar link HLS langsung tanpa proxy atau signed URL</p>}
        <Button onClick={addPlaylist} disabled={loading || !newTitle || (newType !== "proxy" && !newUrl)}><Plus className="mr-1 h-4 w-4" /> Tambah</Button>
      </div>

      <div className="space-y-2">
        {playlists.map((p, index) => (
          <div key={p.id} className={`rounded-lg border p-4 transition-colors ${p.is_active ? "border-border bg-card" : "border-border/50 bg-muted/30 opacity-60"}`}>
            {editingId === p.id ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Label" className="bg-background" />
                  <Select value={editType} onValueChange={setEditType}>
                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="youtube">YouTube</SelectItem>
                      <SelectItem value="m3u8">M3U8 (Signed)</SelectItem>
                      <SelectItem value="direct">Direct M3U8</SelectItem>
                      <SelectItem value="cloudflare">Cloudflare Stream</SelectItem>
                      <SelectItem value="proxy">Proxy Stream (Hanabira48)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editType !== "proxy" && <Input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="URL" className="bg-background font-mono text-xs" />}
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEdit} disabled={!editTitle || (editType !== "proxy" && !editUrl)} className="gap-1"><Check className="h-3.5 w-3.5" /> Simpan</Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit} className="gap-1"><X className="h-3.5 w-3.5" /> Batal</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon" className="h-6 w-6" disabled={index === 0} onClick={() => movePlaylist(index, -1)}>
                    <ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" disabled={index === playlists.length - 1} onClick={() => movePlaylist(index, 1)}>
                    <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{p.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase ${p.type === "proxy" ? "bg-primary/20 text-primary" : p.type === "direct" ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]" : "bg-secondary"}`}>{p.type}</span> {p.type === "proxy" ? "Hanabira48 API" : p.url}
                  </p>
                  {/* Proxy toggle for m3u8/direct types */}
                  {(p.type === "m3u8" || p.type === "direct") && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <Switch
                        checked={p.type === "m3u8"}
                        onCheckedChange={async (checked) => {
                          const newType = checked ? "m3u8" : "direct";
                          await supabase.from("playlists").update({ type: newType }).eq("id", p.id);
                          await fetchPlaylists();
                          toast({ title: checked ? `🔒 Proxy ON (Signed)` : `🔗 Proxy OFF (Direct)` });
                        }}
                      />
                      <span className="text-[10px] text-muted-foreground">{p.type === "m3u8" ? "Proxy ON" : "Proxy OFF"}</span>
                    </div>
                  )}
                </div>
                <Switch
                  checked={p.is_active}
                  onCheckedChange={async (checked) => {
                    await supabase.from("playlists").update({ is_active: checked }).eq("id", p.id);
                    await fetchPlaylists();
                    toast({ title: checked ? `✅ ${p.title} diaktifkan` : `⏸️ ${p.title} dinonaktifkan` });
                  }}
                />
                <div className="flex flex-col items-center gap-0.5">
                  <Switch
                    checked={!!p.is_restream}
                    onCheckedChange={async (checked) => {
                      await supabase.from("playlists").update({ is_restream: checked }).eq("id", p.id);
                      await fetchPlaylists();
                      toast({ title: checked ? `📺 ${p.title} masuk halaman restream` : `🚫 ${p.title} keluar dari restream` });
                    }}
                  />
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Restream</span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => startEdit(p)}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                <Button variant="ghost" size="icon" onClick={() => deletePlaylist(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            )}
          </div>
        ))}
        {playlists.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">Belum ada playlist</p>}
      </div>
    </div>
  );
};

export default PlaylistManager;
