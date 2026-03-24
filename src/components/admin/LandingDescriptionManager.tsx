import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Eye, EyeOff, Upload, Image, AlignLeft, AlignCenter, AlignRight, X } from "lucide-react";
import MediaPickerDialog from "./MediaPickerDialog";

interface Description {
  id: string; title: string; content: string; icon: string; sort_order: number; is_active: boolean; image_url: string; text_align: string;
}

const LandingDescriptionManager = () => {
  const [items, setItems] = useState<Description[]>([]);
  const [uploading, setUploading] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryTargetId, setGalleryTargetId] = useState<string | null>(null);

  // Layout settings
  const [descLayout, setDescLayout] = useState("list");
  const [descWidth, setDescWidth] = useState("medium");
  const [descTitle, setDescTitle] = useState("");
  const [descSubtitle, setDescSubtitle] = useState("");
  const [descQuote, setDescQuote] = useState("");
  const { toast } = useToast();

  const fetchItems = async () => {
    const { data } = await supabase.from("landing_descriptions" as any).select("*").order("sort_order");
    setItems((data as any[]) || []);
  };


  const fetchSettings = async () => {
    const { data } = await supabase.from("site_settings").select("*").in("key", ["landing_desc_layout", "landing_description_width", "landing_desc_title", "landing_desc_subtitle", "landing_desc_quote"]);
    if (data) {
      data.forEach((s: any) => {
        if (s.key === "landing_desc_layout") setDescLayout(s.value || "list");
        if (s.key === "landing_description_width") setDescWidth(s.value || "medium");
        if (s.key === "landing_desc_title") setDescTitle(s.value || "");
        if (s.key === "landing_desc_subtitle") setDescSubtitle(s.value || "");
        if (s.key === "landing_desc_quote") setDescQuote(s.value || "");
      });
    }
  };

  useEffect(() => { fetchItems(); fetchSettings(); }, []);

  const saveSetting = async (key: string, value: string) => {
    await supabase.from("site_settings").upsert({ key, value } as any, { onConflict: "key" });
    toast({ title: "Pengaturan disimpan" });
  };

  const create = async () => {
    await supabase.from("landing_descriptions" as any).insert({ title: "Fitur Baru", content: "Deskripsi fitur...", icon: "✨", sort_order: items.length } as any);
    await fetchItems();
    toast({ title: "Deskripsi ditambahkan" });
  };

  const update = async (item: Description) => {
    await supabase.from("landing_descriptions" as any).update({ title: item.title, content: item.content, icon: item.icon, is_active: item.is_active, sort_order: item.sort_order, image_url: item.image_url, text_align: item.text_align } as any).eq("id", item.id);
    await fetchItems();
  };

  const remove = async (id: string) => {
    await supabase.from("landing_descriptions" as any).delete().eq("id", id);
    await fetchItems();
    toast({ title: "Deskripsi dihapus" });
  };

  const uploadImage = async (file: File, itemId: string) => {
    setUploading(true);
    const fileName = `${crypto.randomUUID()}.${file.name.split(".").pop()}`;
    const { error } = await supabase.storage.from("show-images").upload(fileName, file);
    if (error) { toast({ title: "Upload gagal", variant: "destructive" }); setUploading(false); return; }
    const url = supabase.storage.from("show-images").getPublicUrl(fileName).data.publicUrl;
    const item = items.find((i) => i.id === itemId);
    if (item) { const updated = { ...item, image_url: url }; setItems(items.map((i) => i.id === itemId ? updated : i)); await update(updated); }
    await fetchGallery();
    setUploading(false);
  };

  const selectFromGallery = async (url: string) => {
    if (!galleryTargetId) return;
    const item = items.find((i) => i.id === galleryTargetId);
    if (item) { const updated = { ...item, image_url: url }; setItems(items.map((i) => i.id === galleryTargetId ? updated : i)); await update(updated); }
    setShowGallery(false); setGalleryTargetId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">📝 Deskripsi Landing Page</h2>
        <Button onClick={create} size="sm"><Plus className="mr-1 h-4 w-4" /> Tambah</Button>
      </div>

      {/* Layout Settings */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">⚙️ Pengaturan Tampilan</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Layout</label>
            <Select value={descLayout} onValueChange={(v) => { setDescLayout(v); saveSetting("landing_desc_layout", v); }}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="list">List (Vertikal)</SelectItem>
                <SelectItem value="grid">Grid (2 Kolom)</SelectItem>
                <SelectItem value="cards">Cards (3 Kolom)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Lebar Konten</label>
            <Select value={descWidth} onValueChange={(v) => { setDescWidth(v); saveSetting("landing_description_width", v); }}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Kecil (max-w-2xl)</SelectItem>
                <SelectItem value="medium">Sedang (max-w-4xl)</SelectItem>
                <SelectItem value="large">Lebar (max-w-6xl)</SelectItem>
                <SelectItem value="full">Full Width</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Judul Section</label>
          <Input value={descTitle} onChange={(e) => setDescTitle(e.target.value)} onBlur={() => saveSetting("landing_desc_title", descTitle)} placeholder="Tentang Kami" className="bg-background" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Subtitle</label>
          <Input value={descSubtitle} onChange={(e) => setDescSubtitle(e.target.value)} onBlur={() => saveSetting("landing_desc_subtitle", descSubtitle)} placeholder="Kenapa harus kami?" className="bg-background" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Kutipan / Quote</label>
          <Textarea value={descQuote} onChange={(e) => setDescQuote(e.target.value)} onBlur={() => saveSetting("landing_desc_quote", descQuote)} placeholder="Kutipan yang tampil di bawah deskripsi..." className="bg-background" rows={2} />
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Input value={item.icon} onChange={(e) => setItems(items.map((i) => i.id === item.id ? { ...i, icon: e.target.value } : i))} onBlur={() => update(item)} className="w-14 bg-background text-center text-lg" maxLength={4} />
                <Input value={item.title} onChange={(e) => setItems(items.map((i) => i.id === item.id ? { ...i, title: e.target.value } : i))} onBlur={() => update(item)} className="bg-background font-semibold" placeholder="Judul" />
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { const u = { ...item, is_active: !item.is_active }; setItems(items.map((i) => i.id === u.id ? u : i)); update(u); }}>
                  {item.is_active ? <Eye className="h-4 w-4 text-[hsl(var(--success))]" /> : <EyeOff className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(item.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
            <Textarea value={item.content} onChange={(e) => setItems(items.map((i) => i.id === item.id ? { ...i, content: e.target.value } : i))} onBlur={() => update(item)} className="bg-background" rows={2} placeholder="Konten deskripsi..." />
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Rata:</span>
              {[{ value: "left", icon: <AlignLeft className="h-3.5 w-3.5" /> }, { value: "center", icon: <AlignCenter className="h-3.5 w-3.5" /> }, { value: "right", icon: <AlignRight className="h-3.5 w-3.5" /> }, { value: "justify", icon: <span className="h-3.5 w-3.5 text-[10px] font-bold leading-none">J</span> }].map((opt) => (
                <Button key={opt.value} variant={item.text_align === opt.value ? "default" : "outline"} size="sm" className="h-7 px-2" onClick={() => { const u = { ...item, text_align: opt.value }; setItems(items.map((i) => i.id === u.id ? u : i)); update(u); }}>
                  {opt.icon}
                </Button>
              ))}
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Foto</span>
              <div className="flex gap-2">
                <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs hover:bg-secondary">
                  <Upload className="h-3 w-3" /> Upload
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadImage(file, item.id); }} />
                </label>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setGalleryTargetId(item.id); setShowGallery(true); }}><Image className="mr-1 h-3 w-3" /> Galeri</Button>
                {item.image_url && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => { const u = { ...item, image_url: "" }; setItems(items.map((i) => i.id === u.id ? u : i)); update(u); }}><X className="mr-1 h-3 w-3" /> Hapus</Button>
                )}
              </div>
              {item.image_url && <img src={item.image_url} alt="" className="mt-2 h-20 w-full rounded-lg object-cover" />}
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Belum ada deskripsi</p>}
      </div>
      {uploading && <p className="text-xs text-primary">Mengupload...</p>}

      {showGallery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="mx-4 max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-foreground">📸 Galeri Foto</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowGallery(false)}>Tutup</Button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {galleryImages.map((url) => (
                <img key={url} src={url} alt="" className="h-28 w-full cursor-pointer rounded-lg object-cover transition hover:ring-2 hover:ring-primary" onClick={() => selectFromGallery(url)} />
              ))}
            </div>
            {galleryImages.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Belum ada foto</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingDescriptionManager;
