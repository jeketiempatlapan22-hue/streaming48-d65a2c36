import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompressor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import {
  Copy,
  Crown,
  ExternalLink,
  Eye,
  EyeOff,
  Film,
  GripVertical,
  Image,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import MediaPickerDialog from "./MediaPickerDialog";
import { parseYoutubeId } from "@/lib/youtubeUrl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { parseShowImport, type ParsedShow, type ParsedTeam } from "@/lib/parseShowImport";
import { findBestMediaMatch, fileNameToLabel } from "@/lib/mediaNaming";

interface Show {
  id: string;
  title: string;
  price: string;
  lineup: string;
  schedule_date: string;
  schedule_time: string;
  background_image_url: string | null;
  qris_image_url: string | null;
  is_active: boolean;
  is_subscription: boolean;
  max_subscribers: number;
  subscription_benefits: string;
  group_link: string;
  is_order_closed: boolean;
  category: string;
  category_member: string;
  coin_price: number;
  replay_coin_price: number;
  access_password: string;
  is_replay: boolean;
  qris_price: number;
  replay_qris_price: number;
  membership_duration_days: number;
  short_id: string | null;
  external_show_id: string | null;
  team: string;
  is_bundle: boolean;
  bundle_description: string;
  bundle_duration_days: number;
  bundle_replay_passwords: any[];
  bundle_replay_info: string;
  replay_m3u8_url: string;
  replay_youtube_url: string;
  replay_month: string;
  exclude_from_membership: boolean;
}

const CATEGORY_OPTIONS = [
  { value: "regular", label: "🎭 Reguler", tone: "bg-primary/10 text-primary", hasMember: false },
  { value: "birthday", label: "🎂 Ulang Tahun/STS", tone: "bg-accent/15 text-foreground", hasMember: true },
  { value: "special", label: "⭐ Spesial", tone: "bg-secondary text-secondary-foreground", hasMember: false },
  { value: "anniversary", label: "🎉 Anniversary", tone: "bg-muted text-muted-foreground", hasMember: false },
  { value: "last_show", label: "👋 Last Show", tone: "bg-destructive/10 text-destructive", hasMember: true },
] as const;

const MONTH_MAP: Record<string, number> = {
  januari: 1,
  februari: 2,
  maret: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  agustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  desember: 12,
};

const normalizeShow = (show: Partial<Show> & { id: string; title: string }): Show => ({
  id: show.id,
  title: show.title ?? "Show Baru",
  price: show.price ?? "Gratis",
  lineup: show.lineup ?? "",
  schedule_date: show.schedule_date ?? "",
  schedule_time: show.schedule_time ?? "",
  background_image_url: show.background_image_url ?? null,
  qris_image_url: show.qris_image_url ?? null,
  is_active: show.is_active ?? true,
  is_subscription: show.is_subscription ?? false,
  max_subscribers: show.max_subscribers ?? 0,
  subscription_benefits: show.subscription_benefits ?? "",
  group_link: show.group_link ?? "",
  is_order_closed: show.is_order_closed ?? false,
  category: show.category ?? "regular",
  category_member: show.category_member ?? "",
  coin_price: show.coin_price ?? 0,
  replay_coin_price: show.replay_coin_price ?? 0,
  access_password: show.access_password ?? "",
  is_replay: show.is_replay ?? false,
  qris_price: show.qris_price ?? 0,
  replay_qris_price: show.replay_qris_price ?? 0,
  membership_duration_days: show.membership_duration_days ?? 30,
  short_id: show.short_id?.trim() ? show.short_id.trim().toLowerCase() : null,
  external_show_id: show.external_show_id?.trim() ? show.external_show_id.trim() : null,
  team: show.team ?? "",
  is_bundle: show.is_bundle ?? false,
  bundle_description: show.bundle_description ?? "",
  bundle_duration_days: show.bundle_duration_days ?? 30,
  bundle_replay_passwords: show.bundle_replay_passwords ?? [],
  bundle_replay_info: show.bundle_replay_info ?? "",
  replay_m3u8_url: (show as any).replay_m3u8_url ?? "",
  replay_youtube_url: (show as any).replay_youtube_url ?? "",
  replay_month: (show as any).replay_month ?? "",
  exclude_from_membership: (show as any).exclude_from_membership ?? false,
});

const sanitizeShortId = (value: string | null | undefined) => {
  const cleaned = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned || null;
};

const fallbackId = (show: Pick<Show, "id" | "short_id">) => show.short_id || `#${show.id.replace(/-/g, "").slice(0, 6)}`;

function parseShowSchedule(show: Show): number {
  if (!show.schedule_date) return Number.POSITIVE_INFINITY;
  const dateValue = show.schedule_date.trim();
  const timeValue = (show.schedule_time || "23.59 WIB").replace(/\s*WIB\s*/i, "").replace(".", ":");

  const directParse = new Date(`${dateValue} ${timeValue}`);
  if (!Number.isNaN(directParse.getTime())) return directParse.getTime();

  const parts = dateValue.toLowerCase().split(/\s+/);
  if (parts.length === 3) {
    const day = Number(parts[0]);
    const month = MONTH_MAP[parts[1]];
    const year = Number(parts[2]);
    if (month) {
      const [hours, minutes] = timeValue.split(":").map(Number);
      return new Date(year, month - 1, day, hours || 0, minutes || 0).getTime();
    }
  }

  return Number.POSITIVE_INFINITY;
}

function sortShowsBySchedule(list: Show[]): Show[] {
  const now = Date.now();
  return [...list].sort((a, b) => {
    const aTime = parseShowSchedule(a);
    const bTime = parseShowSchedule(b);
    const aUpcoming = aTime >= now;
    const bUpcoming = bTime >= now;
    if (aUpcoming && bUpcoming) return aTime - bTime;
    if (aUpcoming) return -1;
    if (bUpcoming) return 1;
    return bTime - aTime;
  });
}

const ShowManager = () => {
  const [shows, setShows] = useState<Show[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Show | null>(null);
  const [showTab, setShowTab] = useState<"active" | "replay">("active");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryTarget, setGalleryTarget] = useState<"bg" | "qris">("bg");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uploadingTarget, setUploadingTarget] = useState<"bg" | "qris" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<Array<ParsedShow & { selected: boolean }>>([]);
  const [importing, setImporting] = useState(false);
  const { toast } = useToast();

  const filteredShows = useMemo(() => {
    const filtered = shows.filter((show) => (showTab === "replay" ? show.is_replay : !show.is_replay));
    return sortShowsBySchedule(filtered);
  }, [shows, showTab]);

  const fetchShows = async (targetId?: string | null) => {
    const { data, error } = await supabase.from("shows").select("*").order("created_at", { ascending: false });
    setLoading(false);

    if (error) {
      toast({ title: "Gagal memuat show", description: error.message, variant: "destructive" });
      return;
    }

    const normalized = ((data as Show[] | null) ?? []).map((show) => normalizeShow(show));
    setShows(normalized);

    const resolvedId = targetId ?? editingId;
    if (!resolvedId) return;

    const selected = normalized.find((show) => show.id === resolvedId);
    if (selected) {
      setEditingId(selected.id);
      setDraft(selected);
      setDirty(false);
    } else {
      setEditingId(null);
      setDraft(null);
      setDirty(false);
    }
  };

  useEffect(() => {
    void fetchShows();
  }, []);

  const updateDraft = (patch: Partial<Show>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  };

  const selectShow = (show: Show) => {
    if (dirty && draft?.id !== show.id) {
      const keepGoing = window.confirm("Perubahan belum disimpan. Pindah show dan buang perubahan?");
      if (!keepGoing) return;
    }
    setEditingId(show.id);
    setDraft(show);
    setDirty(false);
  };

  const createShow = async () => {
    if (dirty && draft) {
      const keepGoing = window.confirm("Perubahan belum disimpan. Buat show baru dan buang perubahan sekarang?");
      if (!keepGoing) return;
    }

    const { data, error } = await supabase
      .from("shows")
      .insert({
        title: "Show Baru",
        price: "Rp 0",
        lineup: "",
        schedule_date: "",
        schedule_time: "",
        background_image_url: null,
        qris_image_url: null,
        is_active: true,
        is_subscription: false,
        max_subscribers: 0,
        subscription_benefits: "",
        group_link: "",
        is_order_closed: false,
        category: "regular",
        category_member: "",
        coin_price: 0,
        replay_coin_price: 0,
        access_password: "",
        is_replay: false,
        qris_price: 0,
        replay_qris_price: 0,
        membership_duration_days: 30,
        short_id: null,
        external_show_id: null,
        team: null,
        is_bundle: false,
        bundle_description: "",
        bundle_duration_days: 30,
        bundle_replay_passwords: [],
        bundle_replay_info: "",
        exclude_from_membership: false,
      })
      .select()
      .single();

    if (error) {
      toast({ title: "Gagal menambah show", description: error.message, variant: "destructive" });
      return;
    }

    const created = normalizeShow(data as Show);
    setShows((current) => [created, ...current]);
    setEditingId(created.id);
    setDraft(created);
    setDirty(false);
    toast({ title: "Show ditambahkan" });
  };

  const handleImportPreview = () => {
    const parsed = parseShowImport(importText);
    if (parsed.length === 0) {
      toast({ title: "Tidak ada show terdeteksi", description: "Pastikan format pesan benar (🎪 judul, 🗓️ tanggal, dst).", variant: "destructive" });
      return;
    }
    setImportPreview(parsed.map((p) => ({ ...p, selected: true })));
  };

  const updateImportItem = (index: number, patch: Partial<ParsedShow & { selected: boolean }>) => {
    setImportPreview((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeImportItem = (index: number) => {
    setImportPreview((current) => current.filter((_, i) => i !== index));
  };

  const resetImport = () => {
    setImportText("");
    setImportPreview([]);
  };

  const handleImportCreate = async () => {
    const toCreate = importPreview.filter((p) => p.selected && p.title.trim());
    if (toCreate.length === 0) {
      toast({ title: "Tidak ada show yang dipilih", variant: "destructive" });
      return;
    }
    setImporting(true);
    const payload = toCreate.map((p) => ({
      title: p.title.trim(),
      price: "Rp 0",
      lineup: p.lineup.trim(),
      schedule_date: p.schedule_date.trim(),
      schedule_time: p.schedule_time.trim(),
      background_image_url: null,
      qris_image_url: null,
      is_active: true,
      is_subscription: false,
      max_subscribers: 0,
      subscription_benefits: "",
      group_link: "",
      is_order_closed: false,
      category: "regular",
      category_member: "",
      coin_price: 0,
      replay_coin_price: 0,
      access_password: "",
      is_replay: false,
      qris_price: 0,
      replay_qris_price: 0,
      membership_duration_days: 30,
      short_id: null,
      external_show_id: null,
      team: p.team || null,
      is_bundle: false,
      bundle_description: "",
      bundle_duration_days: 30,
      bundle_replay_passwords: [],
      bundle_replay_info: "",
      exclude_from_membership: false,
    }));

    const { data, error } = await supabase.from("shows").insert(payload).select();
    setImporting(false);

    if (error) {
      toast({ title: "Gagal mengimpor show", description: error.message, variant: "destructive" });
      return;
    }

    const created = ((data as Show[] | null) ?? []).map((s) => normalizeShow(s));
    setShows((current) => [...created, ...current]);
    toast({ title: `${created.length} show berhasil dibuat`, description: "Lengkapi harga & koin di tiap show." });
    resetImport();
    setImportOpen(false);
  };

  const saveShow = async () => {
    if (!draft) return;

    const cleanShortId = sanitizeShortId(draft.short_id);

    if (cleanShortId) {
      const { data: conflict, error: conflictError } = await supabase
        .from("shows")
        .select("id")
        .eq("short_id", cleanShortId)
        .neq("id", draft.id)
        .limit(1);

      if (conflictError) {
        toast({ title: "Gagal validasi ID show", description: conflictError.message, variant: "destructive" });
        return;
      }

      if (conflict && conflict.length > 0) {
        toast({
          title: "Custom ID sudah dipakai",
          description: `Gunakan ID lain karena '${cleanShortId}' sudah dipakai show lain.`,
          variant: "destructive",
        });
        return;
      }
    }

    // Validasi YouTube Replay: harus ID 11 karakter atau URL YouTube valid
    const ytRaw = draft.replay_youtube_url.trim();
    let normalizedYoutubeId: string | null = null;
    if (ytRaw) {
      normalizedYoutubeId = parseYoutubeId(ytRaw);
      if (!normalizedYoutubeId) {
        toast({
          title: "YouTube Replay tidak valid",
          description:
            "Masukkan ID YouTube 11 karakter (contoh: dQw4w9WgXcQ) atau URL YouTube yang valid (youtu.be/..., youtube.com/watch?v=..., /embed/, /shorts/, /live/).",
          variant: "destructive",
        });
        return;
      }
    }

    setSaving(true);
    const payload = {
      title: draft.title.trim() || "Show Baru",
      price: draft.price.trim() || "Gratis",
      lineup: draft.lineup.trim(),
      schedule_date: draft.schedule_date.trim(),
      schedule_time: draft.schedule_time.trim(),
      background_image_url: draft.background_image_url || null,
      qris_image_url: draft.qris_image_url || null,
      is_active: draft.is_active,
      is_subscription: draft.is_subscription,
      max_subscribers: Math.max(0, Number(draft.max_subscribers) || 0),
      subscription_benefits: draft.subscription_benefits.trim(),
      group_link: draft.group_link.trim(),
      is_order_closed: draft.is_order_closed,
      category: draft.category || "regular",
      category_member: draft.category_member.trim(),
      coin_price: Math.max(0, Number(draft.coin_price) || 0),
      replay_coin_price: Math.max(0, Number(draft.replay_coin_price) || 0),
      access_password: draft.access_password.trim(),
      is_replay: draft.is_replay,
      qris_price: Math.max(0, Number(draft.qris_price) || 0),
      replay_qris_price: Math.max(0, Number(draft.replay_qris_price) || 0),
      membership_duration_days: Math.max(1, Number(draft.membership_duration_days) || 30),
      short_id: cleanShortId,
      external_show_id: draft.external_show_id?.trim() || null,
      team: draft.team.trim() || null,
      is_bundle: draft.is_bundle,
      bundle_description: draft.bundle_description.trim(),
      bundle_duration_days: Math.max(1, Number(draft.bundle_duration_days) || 30),
      bundle_replay_passwords: draft.bundle_replay_passwords || [],
      bundle_replay_info: draft.bundle_replay_info.trim(),
      replay_m3u8_url: draft.replay_m3u8_url.trim() || null,
      replay_youtube_url: normalizedYoutubeId,
      replay_month: draft.replay_month.trim() || null,
      exclude_from_membership: draft.exclude_from_membership,
    };

    const { data, error } = await supabase.from("shows").update(payload).eq("id", draft.id).select().single();
    setSaving(false);

    if (error) {
      toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
      return;
    }

    const saved = normalizeShow(data as Show);
    setShows((current) => current.map((show) => (show.id === saved.id ? saved : show)));
    setEditingId(saved.id);
    setDraft(saved);
    setDirty(false);
    toast({ title: "Show berhasil disimpan" });
  };

  const deleteShow = async (id: string) => {
    const confirmed = window.confirm("Yakin hapus show ini?");
    if (!confirmed) return;

    const { error } = await supabase.from("shows").delete().eq("id", id);
    if (error) {
      toast({ title: "Gagal menghapus", description: error.message, variant: "destructive" });
      return;
    }

    setShows((current) => current.filter((show) => show.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setDraft(null);
      setDirty(false);
    }
    toast({ title: "Show dihapus" });
  };

  const resetDraft = () => {
    if (!editingId) return;
    const original = shows.find((show) => show.id === editingId);
    if (!original) return;
    setDraft(original);
    setDirty(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, target: "bg" | "qris") => {
    const rawFile = event.target.files?.[0];
    if (!rawFile || !draft) return;

    setUploadingTarget(target);
    try {
      const file = await compressImage(rawFile);
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("show-images").upload(fileName, file);
      if (error) {
        toast({ title: "Upload gagal", description: error.message, variant: "destructive" });
        return;
      }

      const { data } = supabase.storage.from("show-images").getPublicUrl(fileName);
      updateDraft({ [target === "bg" ? "background_image_url" : "qris_image_url"]: data.publicUrl } as Partial<Show>);
      toast({ title: "Gambar siap disimpan" });
    } finally {
      setUploadingTarget(null);
      event.target.value = "";
    }
  };

  const openGallery = (target: "bg" | "qris") => {
    setGalleryTarget(target);
    setGalleryOpen(true);
  };

  const handleGallerySelect = (url: string) => {
    updateDraft({ [galleryTarget === "bg" ? "background_image_url" : "qris_image_url"]: url } as Partial<Show>);
  };

  const autoDetectBackground = async () => {
    if (!draft) return;
    const query = draft.title.trim();
    if (!query) {
      toast({ title: "Isi judul show terlebih dahulu", variant: "destructive" });
      return;
    }
    const { data, error } = await supabase.storage.from("admin-media").list("", {
      limit: 200,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) {
      toast({ title: "Gagal memuat galeri", description: error.message, variant: "destructive" });
      return;
    }
    const candidates = (data || [])
      .filter((f) => f.name && !f.name.startsWith("."))
      .map((f) => {
        const { data: u } = supabase.storage.from("admin-media").getPublicUrl(f.name);
        return { name: f.name, url: u.publicUrl, label: fileNameToLabel(f.name) };
      });
    const best = findBestMediaMatch(query, candidates);
    if (!best) {
      toast({
        title: "Tidak ada foto yang cocok",
        description: "Coba beri nama foto di galeri agar mirip dengan judul show, atau pilih manual.",
        variant: "destructive",
      });
      return;
    }
    updateDraft({ background_image_url: best.file.url });
    toast({ title: `Background dipilih otomatis`, description: best.file.label || best.file.name });
  };


  const selectedCategory = CATEGORY_OPTIONS.find((option) => option.value === (draft?.category || "regular")) || CATEGORY_OPTIONS[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">🎭 Show Manager</h2>
          <p className="text-sm text-muted-foreground">Form edit sekarang memakai draft + simpan manual agar tidak error saat autosave.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setImportOpen(true)} size="sm" variant="outline">
            <Upload className="mr-1 h-4 w-4" /> Impor Cepat
          </Button>
          <Button onClick={createShow} size="sm">
            <Plus className="mr-1 h-4 w-4" /> Tambah Show
          </Button>
        </div>
      </div>

      <Tabs value={showTab} onValueChange={(value) => setShowTab(value as "active" | "replay")}>
        <TabsList className="w-full">
          <TabsTrigger value="active" className="flex-1 gap-1.5">
            <Eye className="h-3.5 w-3.5" /> Show Aktif ({shows.filter((show) => !show.is_replay).length})
          </TabsTrigger>
          <TabsTrigger value="replay" className="flex-1 gap-1.5">
            <Film className="h-3.5 w-3.5" /> Replay ({shows.filter((show) => show.is_replay).length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center rounded-xl border border-border bg-card py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : filteredShows.length > 0 ? (
            filteredShows.map((show) => {
              const category = CATEGORY_OPTIONS.find((option) => option.value === show.category) || CATEGORY_OPTIONS[0];
              return (
                <button
                  key={show.id}
                  onClick={() => selectShow(show)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                    editingId === show.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-foreground">{show.title}</p>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {fallbackId(show)}
                      </span>
                      {show.is_subscription ? <Crown className="h-3 w-3 text-primary" /> : null}
                      {show.is_replay ? <Film className="h-3 w-3 text-primary" /> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">{show.price} · {show.schedule_date || "Belum ada jadwal"}</p>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${category.tone}`}>{category.label}</span>
                    </div>
                  </div>
                  {show.is_active ? <Eye className="h-4 w-4 text-primary" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </button>
              );
            })
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{showTab === "replay" ? "Belum ada replay" : "Belum ada show aktif"}</p>
          )}
        </div>

        {draft ? (
          <div className="max-h-[80vh] space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-foreground">Edit Show</h3>
                <p className="mt-0.5 text-xs font-mono text-muted-foreground">
                  ID: {fallbackId(draft)}
                  <button
                    className="ml-2 text-primary hover:underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigator.clipboard.writeText(draft.short_id || draft.id.replace(/-/g, "").slice(0, 6));
                      sonnerToast.success("ID disalin!");
                    }}
                  >
                    Salin
                  </button>
                </p>
                <p className={`mt-1 text-xs ${dirty ? "text-primary" : "text-muted-foreground"}`}>
                  {dirty ? "Ada perubahan yang belum disimpan" : "Semua perubahan sudah tersimpan"}
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={resetDraft} disabled={!dirty || saving}>
                  Reset
                </Button>
                <Button size="sm" onClick={saveShow} disabled={!dirty || saving}>
                  {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                  Simpan
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteShow(draft.id)} disabled={saving}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg border border-border bg-background p-3">
                <div className="flex items-center gap-2">
                  {draft.is_active ? <Eye className="h-4 w-4 text-primary" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-medium text-foreground">Show aktif</span>
                </div>
                <Switch checked={draft.is_active} onCheckedChange={(value) => updateDraft({ is_active: value })} />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background p-3">
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Kartu Langganan</span>
                </div>
                <Switch checked={draft.is_subscription} onCheckedChange={(value) => updateDraft({ is_subscription: value })} />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm">📦</span>
                  <span className="text-sm font-medium text-foreground">Bundle Show</span>
                </div>
                <Switch checked={draft.is_bundle} onCheckedChange={(value) => updateDraft({ is_bundle: value })} />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/5 p-3">
                <div className="flex items-start gap-2">
                  <span className="text-sm">🔒</span>
                  <div>
                    <div className="text-sm font-medium text-foreground">Eksklusif (tidak include membership)</div>
                    <div className="text-[11px] text-muted-foreground">Membership / Bundle / Token universal TIDAK bisa menonton — wajib beli show ini secara satuan.</div>
                  </div>
                </div>
                <Switch checked={draft.exclude_from_membership} onCheckedChange={(value) => updateDraft({ exclude_from_membership: value })} />
              </div>
            </div>

            {draft.is_bundle && (
              <div className="space-y-3 rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/5 p-4">
                <p className="text-xs font-bold text-[hsl(var(--warning))]">📦 Pengaturan Bundle</p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Durasi Token (hari)</label>
                  <Input type="number" value={draft.bundle_duration_days} onChange={(e) => updateDraft({ bundle_duration_days: Math.max(1, parseInt(e.target.value || "30", 10) || 30) })} className="bg-background" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Deskripsi Bundle (show yang didapat)</label>
                  <Textarea value={draft.bundle_description} onChange={(e) => updateDraft({ bundle_description: e.target.value })} className="bg-background" rows={3} placeholder="Show A, Show B, Show C..." />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Info Replay</label>
                  <Textarea value={draft.bundle_replay_info} onChange={(e) => updateDraft({ bundle_replay_info: e.target.value })} className="bg-background" rows={2} placeholder="Info replay untuk pembeli bundle..." />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Sandi Replay (multi show)</label>
                  {(draft.bundle_replay_passwords || []).map((rp: any, idx: number) => (
                    <div key={idx} className="flex gap-2 mb-2">
                      <Input value={rp.show_name || ""} onChange={(e) => { const arr = [...(draft.bundle_replay_passwords || [])]; arr[idx] = { ...arr[idx], show_name: e.target.value }; updateDraft({ bundle_replay_passwords: arr }); }} className="bg-background flex-1" placeholder="Nama show" />
                      <Input value={rp.password || ""} onChange={(e) => { const arr = [...(draft.bundle_replay_passwords || [])]; arr[idx] = { ...arr[idx], password: e.target.value }; updateDraft({ bundle_replay_passwords: arr }); }} className="bg-background flex-1" placeholder="Sandi" />
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => { const arr = [...(draft.bundle_replay_passwords || [])]; arr.splice(idx, 1); updateDraft({ bundle_replay_passwords: arr }); }}>✕</Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => updateDraft({ bundle_replay_passwords: [...(draft.bundle_replay_passwords || []), { show_name: "", password: "" }] })}>+ Tambah Sandi</Button>
                </div>
              </div>
            )}

            {!draft.is_subscription && draft.replay_coin_price > 0 ? (
              <div className="flex items-center justify-between rounded-lg border border-border bg-background p-3">
                <div className="flex items-center gap-2">
                  <Film className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Mode Replay</span>
                </div>
                <Switch checked={draft.is_replay} onCheckedChange={(value) => updateDraft({ is_replay: value })} />
              </div>
            ) : null}

            {draft.is_replay && draft.access_password ? (
              <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                <p className="text-xs font-medium text-muted-foreground">🎬 Replay aktif</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(draft.access_password || "");
                      sonnerToast.success("Password disalin!");
                    }}
                  >
                    <Copy className="mr-1 h-3 w-3" /> Salin Password
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      const hasMedia = !!(draft.replay_m3u8_url?.trim() || draft.replay_youtube_url?.trim());
                      const internal = `/replay-play?show=${encodeURIComponent(draft.short_id || draft.id)}&password=${encodeURIComponent(draft.access_password || "")}`;
                      const target = hasMedia ? internal : "https://replaytime.lovable.app";
                      window.open(target, "_blank");
                    }}
                  >
                    <ExternalLink className="mr-1 h-3 w-3" /> Tonton Replay
                  </Button>
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Kategori Show</label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORY_OPTIONS.map((category) => (
                  <button
                    key={category.value}
                    onClick={() => updateDraft({ category: category.value, category_member: category.hasMember ? draft.category_member : "" })}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                      draft.category === category.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedCategory.hasMember ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Nama Member</label>
                <Input value={draft.category_member} onChange={(event) => updateDraft({ category_member: event.target.value })} className="bg-background" />
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">🏅 Tim</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { value: "", label: "Tidak ada" },
                  { value: "passion", label: "🔥 Passion" },
                  { value: "dream", label: "☁️ Dream" },
                  { value: "love", label: "💗 Love" },
                ].map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => updateDraft({ team: t.value })}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                      draft.team === t.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nama Show</label>
              <Input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} className="bg-background" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">🏷️ Custom ID (opsional)</label>
              <Input
                value={draft.short_id || ""}
                onChange={(event) => updateDraft({ short_id: sanitizeShortId(event.target.value) })}
                className="bg-background font-mono"
                placeholder="contoh: sts-freya"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Huruf kecil, angka, - dan _ saja. Kosongkan jika tidak ingin custom ID.</p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">🌐 External Show ID (hanabira48)</label>
              <Input
                value={draft.external_show_id || ""}
                onChange={(event) => updateDraft({ external_show_id: event.target.value || null })}
                className="bg-background font-mono"
                placeholder="ID show dari hanabira48"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Harga Tampilan</label>
              <Input value={draft.price} onChange={(event) => updateDraft({ price: event.target.value })} className="bg-background" placeholder="Rp 50.000" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">💳 Harga QRIS Dinamis</label>
              <Input
                type="number"
                value={draft.qris_price}
                onChange={(event) => updateDraft({ qris_price: Math.max(0, parseInt(event.target.value || "0", 10) || 0) })}
                className="bg-background"
                placeholder="Contoh: 52000"
              />
              {draft.qris_price > 0 ? (
                <p className="mt-1 text-[10px] text-muted-foreground">User melihat: {draft.price} — sistem menerima: Rp {draft.qris_price.toLocaleString("id-ID")}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Line Up Member</label>
              <Textarea value={draft.lineup} onChange={(event) => updateDraft({ lineup: event.target.value })} className="bg-background" rows={3} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Tanggal</label>
                <Input value={draft.schedule_date} onChange={(event) => updateDraft({ schedule_date: event.target.value })} className="bg-background" placeholder="20 Maret 2026" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Jam</label>
                <Input value={draft.schedule_time} onChange={(event) => updateDraft({ schedule_time: event.target.value })} className="bg-background" placeholder="19:00 WIB" />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Harga Koin</label>
              <Input type="number" value={draft.coin_price} onChange={(event) => updateDraft({ coin_price: Math.max(0, parseInt(event.target.value || "0", 10) || 0) })} className="bg-background" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">🎬 Harga Koin Replay</label>
              <Input
                type="number"
                value={draft.replay_coin_price}
                onChange={(event) => updateDraft({ replay_coin_price: Math.max(0, parseInt(event.target.value || "0", 10) || 0) })}
                className="bg-background"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">💳 Harga QRIS Replay</label>
              <Input
                type="number"
                value={draft.replay_qris_price}
                onChange={(event) => updateDraft({ replay_qris_price: Math.max(0, parseInt(event.target.value || "0", 10) || 0) })}
                className="bg-background"
                placeholder="Contoh: 25000"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">🔐 Sandi Replay</label>
              <Input value={draft.access_password} onChange={(event) => updateDraft({ access_password: event.target.value })} className="bg-background" placeholder="Kosongkan jika tidak perlu" />
            </div>

            {/* === Replay Media (M3U8 / YouTube / bulan) === */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-primary">
                <Film className="h-3.5 w-3.5" /> Sumber Replay (Internal Player)
              </div>
              <p className="text-[10px] text-muted-foreground">
                Isi link M3U8 dan/atau YouTube di bawah agar pemutar internal aktif.
                Jika kosong, kartu replay otomatis fallback ke <span className="font-mono">replaytime.lovable.app</span>.
              </p>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Link M3U8 Replay</label>
                <Input
                  value={draft.replay_m3u8_url}
                  onChange={(event) => updateDraft({ replay_m3u8_url: event.target.value })}
                  className="bg-background font-mono text-xs"
                  placeholder="https://.../master.m3u8"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">YouTube Replay (URL atau ID)</label>
                {(() => {
                  const ytVal = draft.replay_youtube_url?.trim() || "";
                  const ytId = ytVal ? parseYoutubeId(ytVal) : null;
                  const isInvalid = ytVal.length > 0 && !ytId;
                  return (
                    <>
                      <Input
                        value={draft.replay_youtube_url}
                        onChange={(event) => updateDraft({ replay_youtube_url: event.target.value })}
                        className={`bg-background font-mono text-xs ${isInvalid ? "border-destructive focus-visible:ring-destructive" : ""}`}
                        placeholder="dQw4w9WgXcQ"
                        aria-invalid={isInvalid}
                      />
                      {isInvalid ? (
                        <p className="mt-1 text-[10px] font-semibold text-destructive">
                          Format tidak valid. Gunakan ID YouTube 11 karakter atau URL YouTube yang sah.
                        </p>
                      ) : ytId ? (
                        <p className="mt-1 text-[10px] font-semibold text-emerald-500">
                          ✓ Valid — ID terdeteksi: <code className="font-mono">{ytId}</code>
                        </p>
                      ) : null}
                      <div className="mt-1.5 space-y-0.5 text-[10px] text-muted-foreground">
                        <p className="font-medium">Contoh format yang diterima:</p>
                        <ul className="ml-3 list-disc space-y-0.5 font-mono">
                          <li>dQw4w9WgXcQ <span className="font-sans not-italic opacity-70">(ID 11 karakter)</span></li>
                          <li>https://youtu.be/dQw4w9WgXcQ</li>
                          <li>https://www.youtube.com/watch?v=dQw4w9WgXcQ</li>
                          <li>https://www.youtube.com/embed/dQw4w9WgXcQ</li>
                          <li>https://www.youtube.com/shorts/dQw4w9WgXcQ</li>
                          <li>https://www.youtube.com/live/dQw4w9WgXcQ</li>
                        </ul>
                      </div>
                    </>
                  );
                })()}
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Bulan Replay (untuk sandi global bulanan)</label>
                <Input
                  value={draft.replay_month}
                  onChange={(event) => updateDraft({ replay_month: event.target.value })}
                  className="bg-background font-mono text-xs"
                  placeholder="YYYY-MM (contoh: 2026-04)"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">Kosongkan untuk pakai bulan berjalan otomatis.</p>
              </div>
            </div>

            {draft.is_subscription ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Maks Subscriber</label>
                  <Input
                    type="number"
                    value={draft.max_subscribers}
                    onChange={(event) => updateDraft({ max_subscribers: Math.max(0, parseInt(event.target.value || "0", 10) || 0) })}
                    className="bg-background"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">⏰ Durasi Membership (hari)</label>
                  <Input
                    type="number"
                    value={draft.membership_duration_days}
                    onChange={(event) => updateDraft({ membership_duration_days: Math.max(1, parseInt(event.target.value || "30", 10) || 30) })}
                    className="bg-background"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Benefit Langganan</label>
                  <Textarea value={draft.subscription_benefits} onChange={(event) => updateDraft({ subscription_benefits: event.target.value })} className="bg-background" rows={3} />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Link Grup</label>
                  <Input value={draft.group_link} onChange={(event) => updateDraft({ group_link: event.target.value })} className="bg-background" />
                </div>
              </>
            ) : null}

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Background Image</label>
                {draft.background_image_url ? <img src={draft.background_image_url} alt="Preview background show" className="mb-2 h-24 w-full rounded-lg object-cover" /> : null}
                <div className="flex gap-2">
                  <label className="flex-1 cursor-pointer">
                    <span className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-background px-4 py-3 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-primary">
                      {uploadingTarget === "bg" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploadingTarget === "bg" ? "Mengupload..." : "Upload"}
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleFileUpload(event, "bg")} disabled={uploadingTarget !== null} />
                  </label>
                  <Button variant="outline" className="h-auto gap-1.5 py-3" onClick={() => openGallery("bg")}>
                    <Image className="h-4 w-4" /> Galeri
                  </Button>
                  <Button variant="outline" className="h-auto gap-1.5 py-3" onClick={autoDetectBackground} title="Cari foto di galeri yang cocok dengan judul show">
                    <Sparkles className="h-4 w-4" /> Auto
                  </Button>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  💡 "Auto" akan mencari foto di galeri yang namanya cocok dengan judul show.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">QRIS Image</label>
                {draft.qris_image_url ? <img src={draft.qris_image_url} alt="Preview QRIS show" className="mb-2 h-24 w-24 rounded-lg object-contain" /> : null}
                <div className="flex gap-2">
                  <label className="flex-1 cursor-pointer">
                    <span className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-background px-4 py-3 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-primary">
                      {uploadingTarget === "qris" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploadingTarget === "qris" ? "Mengupload..." : "Upload QRIS"}
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleFileUpload(event, "qris")} disabled={uploadingTarget !== null} />
                  </label>
                  <Button variant="outline" className="h-auto gap-1.5 py-3" onClick={() => openGallery("qris")}>
                    <Image className="h-4 w-4" /> Galeri
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Pilih show di daftar kiri atau tambahkan show baru untuk mulai mengedit.
          </div>
        )}
      </div>

      <MediaPickerDialog
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        onSelect={handleGallerySelect}
        suggestQuery={galleryTarget === "bg" ? draft?.title : undefined}
      />

      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) resetImport(); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>📥 Impor Cepat Show</DialogTitle>
            <DialogDescription>
              Tempel pesan jadwal (format WhatsApp) — judul (🎪), tanggal (🗓️), jam (🕖/🕑), dan lineup (👥). Harga & koin diisi nanti per show.
            </DialogDescription>
          </DialogHeader>

          {importPreview.length === 0 ? (
            <div className="space-y-3">
              <Textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={12}
                placeholder={"*🎪 Cara Meminum Ramune - Team Love*\n*🗓️ Jumat, 1 Mei 2026*\n*🕖 19.00 WIB*\n*👥 Alya, Anindya, ...*\n\n*🎪 Pajama Drive*\n*🗓️ Sabtu, 2 Mei 2026*\n*🕖 19.00 WIB*\n*👥 -*"}
                className="bg-background font-mono text-xs"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setImportOpen(false)}>Batal</Button>
                <Button size="sm" onClick={handleImportPreview} disabled={!importText.trim()}>Pratinjau</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {importPreview.filter((p) => p.selected).length} dari {importPreview.length} show akan dibuat. Edit jika perlu.
              </p>
              <div className="space-y-2">
                {importPreview.map((item, idx) => (
                  <div key={idx} className={`rounded-lg border p-3 ${item.selected ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30 opacity-60"}`}>
                    <div className="mb-2 flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={(e) => updateImportItem(idx, { selected: e.target.checked })}
                        className="mt-1 h-4 w-4"
                      />
                      <Input
                        value={item.title}
                        onChange={(e) => updateImportItem(idx, { title: e.target.value })}
                        placeholder="Judul show"
                        className="flex-1 bg-background font-semibold"
                      />
                      <Button variant="ghost" size="icon" onClick={() => removeImportItem(idx)} className="h-8 w-8 shrink-0">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={item.schedule_date}
                        onChange={(e) => updateImportItem(idx, { schedule_date: e.target.value })}
                        placeholder="Tanggal"
                        className="bg-background text-xs"
                      />
                      <Input
                        value={item.schedule_time}
                        onChange={(e) => updateImportItem(idx, { schedule_time: e.target.value })}
                        placeholder="Jam"
                        className="bg-background text-xs"
                      />
                    </div>
                    <Textarea
                      value={item.lineup}
                      onChange={(e) => updateImportItem(idx, { lineup: e.target.value })}
                      placeholder="Lineup (kosongkan jika belum ada)"
                      rows={2}
                      className="mt-2 bg-background text-xs"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(["", "passion", "dream", "love"] as ParsedTeam[]).map((t) => (
                        <button
                          key={t || "none"}
                          type="button"
                          onClick={() => updateImportItem(idx, { team: t })}
                          className={`rounded-md border px-2 py-1 text-xs ${item.team === t ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"}`}
                        >
                          {t === "" ? "Tanpa Tim" : t === "passion" ? "🔥 Passion" : t === "dream" ? "☁️ Dream" : "💗 Love"}
                        </button>
                      ))}
                    </div>
                    {item.warnings.length > 0 && (
                      <p className="mt-2 text-[11px] text-yellow-500">⚠️ {item.warnings.join(", ")}</p>
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={resetImport}>← Edit Pesan</Button>
                <Button size="sm" onClick={handleImportCreate} disabled={importing}>
                  {importing ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Membuat...</> : `Buat ${importPreview.filter((p) => p.selected).length} Show`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ShowManager;