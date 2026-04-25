import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Tv2, Plus, Copy, Trash2, RefreshCw, ExternalLink, KeyRound,
} from "lucide-react";
import { formatWIBWithLocal } from "@/lib/timeFormat";

interface Code {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

interface Playlist {
  id: string;
  title: string;
  type: string;
  is_active: boolean;
  is_restream: boolean;
  sort_order: number;
}

const generateCode = (len = 8) => {
  // No look-alike characters (no 0, O, 1, I)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
};

const RestreamManager = () => {
  const { toast } = useToast();

  // Codes
  const [codes, setCodes] = useState<Code[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newCode, setNewCode] = useState(generateCode());
  const [creating, setCreating] = useState(false);

  // Playlists
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(true);

  const restreamUrl = `${window.location.origin}/restream`;

  const loadCodes = useCallback(async () => {
    setLoadingCodes(true);
    const { data, error } = await supabase
      .from("restream_codes")
      .select("id, code, label, is_active, last_used_at, created_at")
      .order("created_at", { ascending: false });
    setLoadingCodes(false);
    if (error) {
      toast({ title: "Gagal memuat kode restream", variant: "destructive" });
      return;
    }
    setCodes((data || []) as Code[]);
  }, [toast]);

  const loadPlaylists = useCallback(async () => {
    setLoadingPlaylists(true);
    const { data } = await supabase
      .from("playlists")
      .select("id, title, type, is_active, is_restream, sort_order")
      .order("sort_order");
    setLoadingPlaylists(false);
    setPlaylists((data || []) as any[]);
  }, []);

  useEffect(() => {
    loadCodes();
    loadPlaylists();
  }, [loadCodes, loadPlaylists]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Disalin!" });
  };

  const handleCreate = async () => {
    const code = newCode.trim().toUpperCase();
    if (!code || code.length < 4) {
      toast({ title: "Kode minimal 4 karakter", variant: "destructive" });
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("restream_codes").insert({
      code,
      label: newLabel.trim(),
    });
    setCreating(false);
    if (error) {
      toast({
        title: error.message.includes("duplicate") || error.message.includes("unique")
          ? "Kode sudah dipakai, silakan pilih kode lain"
          : "Gagal membuat kode: " + error.message,
        variant: "destructive",
      });
      return;
    }
    setNewLabel("");
    setNewCode(generateCode());
    await loadCodes();
    toast({ title: "Kode restream dibuat" });
  };

  const handleDelete = async (id: string, code: string) => {
    if (!confirm(`Hapus kode "${code}"? Pengguna dengan kode ini langsung kehilangan akses.`)) return;
    const { error } = await supabase.from("restream_codes").delete().eq("id", id);
    if (error) {
      toast({ title: "Gagal menghapus kode", variant: "destructive" });
      return;
    }
    setCodes((prev) => prev.filter((c) => c.id !== id));
    toast({ title: "Kode dihapus" });
  };

  const handleToggleCode = async (id: string, next: boolean) => {
    const { error } = await supabase
      .from("restream_codes")
      .update({ is_active: next })
      .eq("id", id);
    if (error) {
      toast({ title: "Gagal mengubah status", variant: "destructive" });
      return;
    }
    setCodes((prev) => prev.map((c) => (c.id === id ? { ...c, is_active: next } : c)));
    toast({ title: next ? "Kode diaktifkan" : "Kode dinonaktifkan" });
  };

  const handleTogglePlaylist = async (id: string, next: boolean) => {
    const { error } = await supabase
      .from("playlists")
      .update({ is_restream: next })
      .eq("id", id);
    if (error) {
      toast({ title: "Gagal memperbarui playlist", variant: "destructive" });
      return;
    }
    setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, is_restream: next } : p)));
    toast({ title: next ? "Playlist masuk daftar restream" : "Playlist dikeluarkan dari restream" });
  };

  const restreamPlaylistsCount = playlists.filter((p) => p.is_restream && p.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Tv2 className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-bold text-foreground">Halaman Restream</h2>
      </div>

      {/* URL info */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <p className="text-xs text-muted-foreground mb-1">URL halaman restream (bagikan ke partner):</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-background border border-border px-3 py-2 text-xs font-mono text-foreground">
            {restreamUrl}
          </code>
          <Button size="sm" variant="outline" onClick={() => handleCopy(restreamUrl)} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" /> Salin
          </Button>
          <Button size="sm" variant="outline" asChild className="gap-1.5">
            <a href={restreamUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> Buka
            </a>
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Halaman bersih: hanya video, tanpa watermark/chat. Pengunjung butuh kode aktif untuk masuk.
        </p>
      </div>

      {/* Playlist selection */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-foreground">Playlist yang Tampil di Restream</h3>
            <p className="text-[11px] text-muted-foreground">
              {restreamPlaylistsCount} playlist aktif ditampilkan sebagai opsi switcher di halaman restream
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={loadPlaylists} disabled={loadingPlaylists} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loadingPlaylists ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {loadingPlaylists ? (
          <p className="text-xs text-muted-foreground">Memuat...</p>
        ) : playlists.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada playlist. Buat dulu di Playlist Manager.</p>
        ) : (
          <ul className="space-y-2">
            {playlists.map((p) => (
              <li
                key={p.id}
                className={`flex items-center gap-3 rounded-lg border p-3 ${
                  p.is_active ? "border-border/60 bg-background/40" : "border-border/30 bg-muted/30 opacity-70"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{p.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono uppercase">{p.type}</span>
                    {!p.is_active && <span className="ml-2 text-destructive">(playlist dimatikan)</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{p.is_restream ? "ON" : "OFF"}</span>
                  <Switch
                    checked={p.is_restream}
                    onCheckedChange={(checked) => handleTogglePlaylist(p.id, checked)}
                    disabled={!p.is_active}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Codes manager */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Kode Akses Restream</h3>
        </div>

        {/* Create form */}
        <div className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">Kode</label>
              <div className="flex gap-1.5">
                <Input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                  placeholder="MISAL: PARTNER01"
                  className="bg-background font-mono uppercase"
                  maxLength={50}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setNewCode(generateCode())}
                  title="Acak kode"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">Label / Catatan (opsional)</label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="misal: Partner A, Tim Editor, dst."
                className="bg-background"
                maxLength={100}
              />
            </div>
          </div>
          <Button onClick={handleCreate} disabled={creating || !newCode.trim()} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> {creating ? "Membuat..." : "Buat Kode"}
          </Button>
        </div>

        {/* Codes list */}
        {loadingCodes ? (
          <p className="text-xs text-muted-foreground">Memuat...</p>
        ) : codes.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Belum ada kode. Buat satu di atas untuk mulai membagikan akses restream.
          </p>
        ) : (
          <ul className="space-y-2">
            {codes.map((c) => (
              <li
                key={c.id}
                className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${
                  c.is_active ? "border-border/60 bg-background/40" : "border-border/30 bg-muted/30 opacity-70"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="rounded bg-secondary/70 px-2 py-0.5 font-mono text-sm font-bold text-foreground tracking-wide">
                      {c.code}
                    </code>
                    <button
                      onClick={() => handleCopy(c.code)}
                      className="text-muted-foreground hover:text-primary"
                      title="Salin kode"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleCopy(`${restreamUrl}?code=${encodeURIComponent(c.code)}`)}
                      className="text-muted-foreground hover:text-primary text-[10px] underline"
                      title="Salin link langsung"
                    >
                      salin link
                    </button>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      c.is_active
                        ? "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {c.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </div>
                  {c.label && <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{c.label}</p>}
                  <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                    Dibuat: {formatWIBWithLocal(c.created_at)}
                    {c.last_used_at && <> · Terakhir dipakai: {formatWIBWithLocal(c.last_used_at)}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={c.is_active}
                    onCheckedChange={(checked) => handleToggleCode(c.id, checked)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(c.id, c.code)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive gap-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default RestreamManager;
