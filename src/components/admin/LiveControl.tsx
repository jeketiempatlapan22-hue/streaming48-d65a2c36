import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, GripVertical, Pencil, Check, X, Sparkles } from "lucide-react";
import { ANIMATION_OPTIONS, type AnimationType } from "@/components/viewer/PlayerAnimations";
import { encryptEmbedId, decryptEmbedId } from "@/lib/embedCrypto";

const LiveControl = () => {
  const [stream, setStream] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isLive, setIsLive] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [nextShowTime, setNextShowTime] = useState("");
  const [playerAnimation, setPlayerAnimation] = useState<AnimationType>("none");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Auto-schedule live state
  const [autoLiveEnabled, setAutoLiveEnabled] = useState(false);
  const [autoLiveOnTime, setAutoLiveOnTime] = useState("");
  const [autoLiveOffTime, setAutoLiveOffTime] = useState("");
  const [autoSaving, setAutoSaving] = useState(false);

  const [playlists, setPlaylists] = useState<any[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState("youtube");
  const [newUrl, setNewUrl] = useState("");
  const [plLoading, setPlLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editType, setEditType] = useState("");
  const [editUrl, setEditUrl] = useState("");

  // Active show selection
  const [shows, setShows] = useState<any[]>([]);
  const [activeShowId, setActiveShowId] = useState("");

  const fetchPlaylists = async () => {
    const { data } = await supabase.from("playlists").select("*").order("sort_order");
    setPlaylists(data || []);
  };

  useEffect(() => {
    const fetchData = async () => {
      const [streamRes, settingsRes, showsRes] = await Promise.all([
        supabase.from("streams").select("*").limit(1).single(),
        supabase.from("site_settings").select("*"),
        supabase.from("shows").select("id, title, is_active, is_replay, schedule_date").order("created_at", { ascending: false }),
      ]);
      if (streamRes.data) {
        setStream(streamRes.data);
        setTitle(streamRes.data.title);
        setDescription(streamRes.data.description || "");
        setIsLive(streamRes.data.is_live);
      }
      if (showsRes.data) setShows(showsRes.data);
      if (settingsRes.data) {
        settingsRes.data.forEach((s: any) => {
          if (s.key === "next_show_time") setNextShowTime(s.value);
          if (s.key === "player_animation") setPlayerAnimation(s.value as AnimationType);
          if (s.key === "active_show_id") setActiveShowId(s.value);
          if (s.key === "chat_enabled") setChatEnabled(s.value !== "false");
        });
      }
    };
    fetchData();
    fetchPlaylists();
  }, []);

  const toggleLive = async (checked: boolean) => {
    if (!stream) return;
    if (checked && !activeShowId) {
      toast({ title: "⚠️ Pilih show yang sedang live terlebih dahulu!", variant: "destructive" });
      return;
    }
    setIsLive(checked);
    await supabase.from("streams").update({ is_live: checked }).eq("id", stream.id);
    toast({ title: checked ? "🔴 Live ON" : "⚫ Live OFF" });
  };

  const saveActiveShow = async (showId: string) => {
    setActiveShowId(showId);
    await supabase
      .from("site_settings")
      .upsert({ key: "active_show_id", value: showId } as any, { onConflict: "key" });
    const show = shows.find((s) => s.id === showId);
    toast({ title: `Show aktif: ${show?.title || "Tidak ada"}` });
  };

  const saveDetails = async () => {
    if (!stream) return;
    setSaving(true);
    await supabase.from("streams").update({ title, description }).eq("id", stream.id);
    toast({ title: "Tersimpan!" });
    setSaving(false);
  };

  const saveNextShowTime = async () => {
    await supabase
      .from("site_settings")
      .upsert({ key: "next_show_time", value: nextShowTime } as any, { onConflict: "key" });
    toast({ title: "Jadwal show disimpan!" });
  };

  const addPlaylist = async () => {
    if (!newLabel || !newUrl) return;
    setPlLoading(true);
    const urlToSave = newType === "youtube" ? encryptEmbedId(newUrl) : newUrl;
    await supabase.from("playlists").insert({ title: newLabel, type: newType, url: urlToSave, sort_order: playlists.length });
    setNewLabel(""); setNewUrl("");
    await fetchPlaylists();
    toast({ title: "Playlist ditambahkan!" });
    setPlLoading(false);
  };

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setEditLabel(p.title);
    setEditType(p.type);
    setEditUrl(p.type === "youtube" ? decryptEmbedId(p.url) : p.url);
  };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId || !editLabel || !editUrl) return;
    const urlToSave = editType === "youtube" ? encryptEmbedId(editUrl) : editUrl;
    await supabase.from("playlists").update({ title: editLabel, type: editType, url: urlToSave }).eq("id", editingId);
    toast({ title: "Playlist diperbarui!" });
    setEditingId(null);
    await fetchPlaylists();
  };

  const deletePlaylist = async (id: string) => {
    await supabase.from("playlists").delete().eq("id", id);
    await fetchPlaylists();
    toast({ title: "Playlist dihapus" });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-foreground">🔴 Live Control</h2>

      {/* Live Toggle */}
      <div className={`flex items-center justify-between rounded-xl border p-6 ${isLive ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}>
        <div>
          <p className="text-lg font-bold text-foreground">{isLive ? "LIVE" : "OFFLINE"}</p>
          <p className="text-sm text-muted-foreground">Toggle status live stream</p>
        </div>
        <div className={isLive ? "animate-glow-pulse" : ""}>
          <Switch checked={isLive} onCheckedChange={toggleLive} />
        </div>
      </div>

      {/* Chat Toggle */}
      <div className={`flex items-center justify-between rounded-xl border p-6 ${chatEnabled ? "border-[hsl(var(--success))]/50 bg-[hsl(var(--success))]/5" : "border-destructive/50 bg-destructive/5"}`}>
        <div>
          <p className="text-lg font-bold text-foreground">{chatEnabled ? "💬 Chat Aktif" : "🔇 Chat Nonaktif"}</p>
          <p className="text-sm text-muted-foreground">
            {chatEnabled ? "User dapat mengirim pesan di live chat" : "User hanya bisa membaca pesan. Admin tetap bisa mengirim & pin pesan."}
          </p>
        </div>
        <Switch
          checked={chatEnabled}
          onCheckedChange={async (checked) => {
            setChatEnabled(checked);
            await supabase.from("site_settings").upsert(
              { key: "chat_enabled", value: checked ? "true" : "false" } as any,
              { onConflict: "key" }
            );
            toast({ title: checked ? "💬 Live chat dibuka untuk user" : "🔇 Live chat ditutup untuk user" });
          }}
        />
      </div>

      {/* Active Show Selector */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold text-foreground">🎭 Show yang Sedang Live</h3>
        <p className="text-xs text-muted-foreground">Pilih show yang sedang berlangsung. Token hanya bisa akses show yang sesuai.</p>
        <Select value={activeShowId} onValueChange={saveActiveShow}>
          <SelectTrigger className="bg-background"><SelectValue placeholder="Pilih show..." /></SelectTrigger>
          <SelectContent>
            {shows.filter(s => s.is_active).map((show) => (
              <SelectItem key={show.id} value={show.id}>
                {show.title} {show.is_replay ? "(Replay)" : ""} {show.schedule_date ? `- ${show.schedule_date}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeShowId && (
          <p className="text-xs text-muted-foreground">
            Show aktif: <span className="font-semibold text-primary">{shows.find(s => s.id === activeShowId)?.title || "Unknown"}</span>
          </p>
        )}
      </div>

      {/* Next Show Countdown */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold text-foreground">⏰ Jadwal Show Berikutnya</h3>
        <p className="text-xs text-muted-foreground">Countdown akan tampil di player saat offline.</p>
        <div className="flex gap-2">
          <Input type="datetime-local" value={nextShowTime} onChange={(e) => setNextShowTime(e.target.value)} className="bg-background" />
          <Button onClick={saveNextShowTime} size="sm">Simpan</Button>
        </div>
        {nextShowTime && (
          <p className="text-xs text-muted-foreground">
            Dijadwalkan: {new Date(nextShowTime).toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" })}
          </p>
        )}
      </div>

      {/* Player Animation */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Animasi Player</h3>
        </div>
        <p className="text-xs text-muted-foreground">Pilih efek animasi yang tampil di atas video player untuk viewer.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {ANIMATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={async () => {
                setPlayerAnimation(opt.value);
                await supabase.from("site_settings").upsert({ key: "player_animation", value: opt.value } as any, { onConflict: "key" });
                toast({ title: `Animasi: ${opt.label}` });
              }}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.97] ${
                playerAnimation === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <span>{opt.emoji}</span>
              <span className="text-xs">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold text-foreground">📝 Detail Stream</h3>
        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">Judul Live</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="bg-background" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">Deskripsi</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} className="bg-background" />
        </div>
        <Button onClick={saveDetails} disabled={saving}>{saving ? "Menyimpan..." : "Simpan"}</Button>
      </div>

      {/* Playlist Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-foreground">📋 Sumber Video</h3>
        <div className="space-y-3 rounded-xl border border-border bg-card p-6">
          <h4 className="text-sm font-semibold text-foreground">Tambah Sumber Video</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label (e.g. Server 1)" className="bg-background" />
            <Select value={newType} onValueChange={setNewType}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="youtube">YouTube</SelectItem>
                <SelectItem value="m3u8">M3U8 / HLS</SelectItem>
                <SelectItem value="cloudflare">Cloudflare Stream</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="URL atau ID video" className="bg-background" />
          <Button onClick={addPlaylist} disabled={plLoading || !newLabel || !newUrl}>
            <Plus className="mr-1 h-4 w-4" /> Tambah
          </Button>
        </div>

        <div className="space-y-2">
          {playlists.map((p) => (
            <div key={p.id} className="rounded-lg border border-border bg-card p-4">
              {editingId === p.id ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Label" className="bg-background" />
                    <Select value={editType} onValueChange={setEditType}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="youtube">YouTube</SelectItem>
                        <SelectItem value="m3u8">M3U8 / HLS</SelectItem>
                        <SelectItem value="cloudflare">Cloudflare Stream</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="URL" className="bg-background font-mono text-xs" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveEdit} disabled={!editLabel || !editUrl} className="gap-1"><Check className="h-3.5 w-3.5" /> Simpan</Button>
                    <Button size="sm" variant="ghost" onClick={cancelEdit} className="gap-1"><X className="h-3.5 w-3.5" /> Batal</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{p.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      <span className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase">{p.type}</span> {p.url}
                    </p>
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
    </div>
  );
};

export default LiveControl;
