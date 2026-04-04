import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompressor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, GripVertical, Eye, EyeOff, Upload, Crown, Film, Copy, ExternalLink, Image } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import MediaPickerDialog from "./MediaPickerDialog";

interface Show {
  id: string; title: string; price: string; lineup: string;
  schedule_date: string; schedule_time: string;
  background_image_url: string | null; qris_image_url: string | null;
  is_active: boolean; is_subscription: boolean;
  max_subscribers: number; subscription_benefits: string; group_link: string;
  is_order_closed: boolean; category: string; category_member: string;
  coin_price: number; replay_coin_price: number; access_password: string; is_replay: boolean;
  qris_price: number;
  membership_duration_days: number;
}

const CATEGORY_OPTIONS = [
  { value: "regular", label: "🎭 Reguler", color: "bg-primary/10 text-primary", hasMember: false },
  { value: "birthday", label: "🎂 Ulang Tahun/STS", color: "bg-pink-500/10 text-pink-500", hasMember: true },
  { value: "special", label: "⭐ Spesial", color: "bg-yellow-500/10 text-yellow-500", hasMember: false },
  { value: "anniversary", label: "🎉 Anniversary", color: "bg-purple-500/10 text-purple-500", hasMember: false },
  { value: "last_show", label: "👋 Last Show", color: "bg-red-500/10 text-red-500", hasMember: true },
];

const MONTH_MAP: Record<string, number> = { januari:1, februari:2, maret:3, april:4, mei:5, juni:6, juli:7, agustus:8, september:9, oktober:10, november:11, desember:12 };

function parseShowSchedule(show: Show): number {
  if (!show.schedule_date) return Infinity;
  const d = show.schedule_date.trim();
  const t = (show.schedule_time || "23.59 WIB").replace(/\s*WIB\s*/i, "").replace(".", ":");
  // Try ISO-like parse first
  const attempt = new Date(`${d} ${t}`);
  if (!isNaN(attempt.getTime())) return attempt.getTime();
  // Try "20 Maret 2026" format
  const parts = d.toLowerCase().split(/\s+/);
  if (parts.length === 3) {
    const day = parseInt(parts[0]); const month = MONTH_MAP[parts[1]]; const year = parseInt(parts[2]);
    if (month) {
      const [h, m] = t.split(":").map(Number);
      return new Date(year, month - 1, day, h || 0, m || 0).getTime();
    }
  }
  return Infinity;
}

function sortShowsBySchedule(list: Show[]): Show[] {
  const now = Date.now();
  return [...list].sort((a, b) => {
    const ta = parseShowSchedule(a); const tb = parseShowSchedule(b);
    const aUp = ta >= now; const bUp = tb >= now;
    if (aUp && bUp) return ta - tb; // both upcoming: nearest first
    if (aUp) return -1; if (bUp) return 1;
    return tb - ta; // both past: most recent first
  });
}

const ShowManager = () => {
  const [shows, setShows] = useState<Show[]>([]);
  const [editing, setEditing] = useState<Show | null>(null);
  const [uploading, setUploading] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryTarget, setGalleryTarget] = useState<"bg" | "qris">("bg");
  const [showTab, setShowTab] = useState<"active" | "replay">("active");
  const { toast } = useToast();

  const filteredShows = useMemo(() => {
    const filtered = shows.filter(s => showTab === "replay" ? s.is_replay : !s.is_replay);
    return sortShowsBySchedule(filtered);
  }, [shows, showTab]);

  const fetchShows = async () => {
    const { data } = await supabase.from("shows").select("*").order("created_at", { ascending: false });
    setShows((data as unknown as Show[]) || []);
  };

  useEffect(() => { fetchShows(); }, []);

  const createShow = async () => {
    await supabase.from("shows").insert({ title: "Show Baru", price: "Rp 0" });
    await fetchShows();
    toast({ title: "Show ditambahkan" });
  };

  const updateShow = async (show: Show) => {
    await supabase.from("shows").update({
      title: show.title, price: show.price, lineup: show.lineup,
      schedule_date: show.schedule_date, schedule_time: show.schedule_time,
      background_image_url: show.background_image_url, qris_image_url: show.qris_image_url,
      is_active: show.is_active, is_subscription: show.is_subscription,
      max_subscribers: show.max_subscribers, subscription_benefits: show.subscription_benefits,
      group_link: show.group_link, is_order_closed: show.is_order_closed,
      category: show.category, category_member: show.category_member,
      coin_price: show.coin_price, replay_coin_price: show.replay_coin_price,
      access_password: show.access_password, is_replay: show.is_replay,
      qris_price: show.qris_price || 0,
      membership_duration_days: show.membership_duration_days || 30,
    }).eq("id", show.id);
    await fetchShows();
    toast({ title: "Show diperbarui" });
  };

  const deleteShow = async (id: string) => {
    if (!confirm("Yakin hapus show ini?")) return;
    await supabase.from("shows").delete().eq("id", id);
    await fetchShows();
    setEditing(null);
    toast({ title: "Show dihapus" });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: "bg" | "qris") => {
    const rawFile = e.target.files?.[0];
    if (!rawFile || !editing) return;
    setUploading(true);
    const file = await compressImage(rawFile);
    const ext = file.name.split(".").pop();
    const fileName = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("show-images").upload(fileName, file);
    if (error) {
      toast({ title: "Upload gagal", description: error.message, variant: "destructive" });
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("show-images").getPublicUrl(fileName);
    const updated = { ...editing, [target === "bg" ? "background_image_url" : "qris_image_url"]: urlData.publicUrl };
    setEditing(updated);
    await updateShow(updated);
    setUploading(false);
  };

  const handleGallerySelect = (url: string) => {
    if (!editing) return;
    const field = galleryTarget === "bg" ? "background_image_url" : "qris_image_url";
    const updated = { ...editing, [field]: url };
    setEditing(updated);
    updateShow(updated);
  };

  const openGallery = (target: "bg" | "qris") => {
    setGalleryTarget(target);
    setGalleryOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">🎭 Show Manager</h2>
        <Button onClick={createShow} size="sm"><Plus className="mr-1 h-4 w-4" /> Tambah Show</Button>
      </div>

      <Tabs value={showTab} onValueChange={(v) => setShowTab(v as "active" | "replay")}>
        <TabsList className="w-full">
          <TabsTrigger value="active" className="flex-1 gap-1.5">
            <Eye className="h-3.5 w-3.5" /> Show Aktif ({shows.filter(s => !s.is_replay).length})
          </TabsTrigger>
          <TabsTrigger value="replay" className="flex-1 gap-1.5">
            <Film className="h-3.5 w-3.5" /> Replay ({shows.filter(s => s.is_replay).length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          {filteredShows.map((show) => (
            <button
              key={show.id}
              onClick={() => setEditing(show)}
              className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                editing?.id === show.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50"
              }`}
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-foreground truncate">{show.title}</p>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title="Show ID untuk bot command">
                    #{show.id.replace(/-/g, '').slice(0, 6)}
                  </span>
                  {show.is_subscription && <Crown className="h-3 w-3 text-yellow-500" />}
                  {show.is_replay && <Film className="h-3 w-3 text-accent" />}
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">{show.price} · {show.schedule_date}</p>
                  {(() => {
                    const cat = CATEGORY_OPTIONS.find(c => c.value === show.category) || CATEGORY_OPTIONS[0];
                    return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cat.color}`}>{cat.label}</span>;
                  })()}
                </div>
              </div>
              {show.is_active ? <Eye className="h-4 w-4 text-[hsl(var(--success))]" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
            </button>
          ))}
          {filteredShows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{showTab === "replay" ? "Belum ada replay" : "Belum ada show aktif"}</p>}
        </div>

        {editing && (
          <div className="space-y-4 rounded-xl border border-border bg-card p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Edit Show</h3>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  ID: #{editing.id.replace(/-/g, '').slice(0, 6)}
                  <button className="ml-2 text-primary hover:underline" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(editing.id.replace(/-/g, '').slice(0, 6)); sonnerToast.success("ID disalin!"); }}>Salin</button>
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  onClick={() => { const u = { ...editing, is_active: !editing.is_active }; setEditing(u); updateShow(u); }}>
                  {editing.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteShow(editing.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium text-foreground">Kartu Langganan</span>
              </div>
              <Switch checked={editing.is_subscription} onCheckedChange={(v) => { const u = { ...editing, is_subscription: v }; setEditing(u); updateShow(u); }} />
            </div>

            {!editing.is_subscription && editing.replay_coin_price > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent/5 p-3">
                <div className="flex items-center gap-2">
                  <Film className="h-4 w-4 text-accent" />
                  <span className="text-sm font-medium text-foreground">Mode Replay</span>
                </div>
                <Switch checked={editing.is_replay} onCheckedChange={(v) => { const u = { ...editing, is_replay: v }; setEditing(u); updateShow(u); }} />
              </div>
            )}

            {editing.is_replay && editing.access_password && (
              <div className="space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
                <p className="text-xs font-medium text-muted-foreground">🎬 Replay Aktif</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => {
                    navigator.clipboard.writeText(editing.access_password || "");
                    sonnerToast.success("Password disalin!");
                  }}>
                    <Copy className="mr-1 h-3 w-3" /> Salin Password
                  </Button>
                  <Button size="sm" className="flex-1 text-xs" onClick={() => {
                    window.open(`https://replaytime.lovable.app/replay`, "_blank");
                  }}>
                    <ExternalLink className="mr-1 h-3 w-3" /> Tonton Replay
                  </Button>
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Kategori Show</label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORY_OPTIONS.map((cat) => (
                  <button key={cat.value}
                    onClick={() => { const u = { ...editing, category: cat.value }; setEditing(u); updateShow(u); }}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                      (editing.category || "regular") === cat.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/30"
                    }`}>{cat.label}</button>
                ))}
              </div>
            </div>

            {(() => {
              const selectedCat = CATEGORY_OPTIONS.find(c => c.value === (editing.category || "regular"));
              return selectedCat?.hasMember ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Nama Member</label>
                  <Input value={editing.category_member || ""} onChange={(e) => setEditing({ ...editing, category_member: e.target.value })} onBlur={() => updateShow(editing)} className="bg-background" />
                </div>
              ) : null;
            })()}

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nama Show</label>
              <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} onBlur={() => updateShow(editing)} className="bg-background" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Harga Tampilan (dilihat user)</label>
              <Input value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} onBlur={() => updateShow(editing)} className="bg-background" placeholder="Rp 50.000" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">💳 Harga QRIS Dinamis (dikirim ke Pak Kasir, 0 = sama dengan harga tampilan)</label>
              <Input type="number" value={editing.qris_price || 0} onChange={(e) => setEditing({ ...editing, qris_price: parseInt(e.target.value) || 0 })} onBlur={() => updateShow(editing)} className="bg-background" placeholder="Contoh: 52000" />
              {editing.qris_price > 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground">User melihat: {editing.price} — Pak Kasir menerima: Rp {editing.qris_price.toLocaleString("id-ID")}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Line Up Member</label>
              <Textarea value={editing.lineup} onChange={(e) => setEditing({ ...editing, lineup: e.target.value })} onBlur={() => updateShow(editing)} className="bg-background" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Tanggal</label>
                <Input value={editing.schedule_date} onChange={(e) => setEditing({ ...editing, schedule_date: e.target.value })} onBlur={() => updateShow(editing)} className="bg-background" placeholder="20 Maret 2026" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Jam</label>
                <Input value={editing.schedule_time} onChange={(e) => setEditing({ ...editing, schedule_time: e.target.value })} onBlur={() => updateShow(editing)} className="bg-background" placeholder="19:00 WIB" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Harga Koin (0 = tidak dijual via koin)</label>
              <Input type="number" value={editing.coin_price} onChange={(e) => setEditing({ ...editing, coin_price: parseInt(e.target.value) || 0 })} onBlur={() => updateShow(editing)} className="bg-background" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">🎬 Harga Koin Replay (0 = tidak ada replay)</label>
              <Input type="number" value={editing.replay_coin_price} onChange={(e) => setEditing({ ...editing, replay_coin_price: parseInt(e.target.value) || 0 })} onBlur={() => updateShow(editing)} className="bg-background" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">🔐 Sandi Replay</label>
              <Input value={editing.access_password || ""} onChange={(e) => setEditing({ ...editing, access_password: e.target.value })} onBlur={() => updateShow(editing)} className="bg-background" placeholder="Kosongkan jika tidak perlu" />
            </div>

            {editing.is_subscription && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Maks Subscriber</label>
                  <Input type="number" value={editing.max_subscribers} onChange={(e) => setEditing({ ...editing, max_subscribers: parseInt(e.target.value) || 0 })} onBlur={() => updateShow(editing)} className="bg-background" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Benefit Langganan</label>
                  <Textarea value={editing.subscription_benefits} onChange={(e) => setEditing({ ...editing, subscription_benefits: e.target.value })} onBlur={() => updateShow(editing)} className="bg-background" rows={3} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Link Grup</label>
                  <Input value={editing.group_link || ""} onChange={(e) => setEditing({ ...editing, group_link: e.target.value })} onBlur={() => updateShow(editing)} className="bg-background" />
                </div>
              </>
            )}

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Background Image</label>
                {editing.background_image_url && <img src={editing.background_image_url} alt="" className="mb-2 h-24 w-full rounded-lg object-cover" />}
                <div className="flex gap-2">
                  <label className="flex-1 cursor-pointer">
                    <span className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-background px-4 py-3 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-primary">
                      <Upload className="h-4 w-4" /> {uploading ? "Mengupload..." : "Upload"}
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, "bg")} disabled={uploading} />
                  </label>
                  <Button variant="outline" className="gap-1.5 py-3 h-auto" onClick={() => openGallery("bg")}>
                    <Image className="h-4 w-4" /> Galeri
                  </Button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">QRIS Image</label>
                {editing.qris_image_url && <img src={editing.qris_image_url} alt="" className="mb-2 h-24 w-24 rounded-lg object-contain" />}
                <div className="flex gap-2">
                  <label className="flex-1 cursor-pointer">
                    <span className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-background px-4 py-3 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-primary">
                      <Upload className="h-4 w-4" /> {uploading ? "Mengupload..." : "Upload QRIS"}
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, "qris")} disabled={uploading} />
                  </label>
                  <Button variant="outline" className="gap-1.5 py-3 h-auto" onClick={() => openGallery("qris")}>
                    <Image className="h-4 w-4" /> Galeri
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <MediaPickerDialog open={galleryOpen} onOpenChange={setGalleryOpen} onSelect={handleGallerySelect} />
    </div>
  );
};

export default ShowManager;
