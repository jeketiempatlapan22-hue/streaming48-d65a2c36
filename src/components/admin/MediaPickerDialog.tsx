import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompressor";
import { toast } from "sonner";
import { Image, Trash2, Search, Upload, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  buildMediaFileName,
  fileNameToLabel,
  getExt,
  findBestMediaMatch,
  matchScore,
} from "@/lib/mediaNaming";

interface MediaPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (url: string) => void;
  /** Judul show / keyword untuk auto-highlight foto yang cocok. */
  suggestQuery?: string;
}

interface MediaFile {
  name: string;
  url: string;
  size: number;
  label: string;
}

const MediaPickerDialog = ({ open, onOpenChange, onSelect, suggestQuery }: MediaPickerDialogProps) => {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.storage.from("admin-media").list("", {
      limit: 200,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) {
      toast.error("Gagal memuat galeri");
      setLoading(false);
      return;
    }
    const mediaFiles: MediaFile[] = (data || [])
      .filter((f) => f.name && !f.name.startsWith("."))
      .map((f) => {
        const { data: urlData } = supabase.storage.from("admin-media").getPublicUrl(f.name);
        return {
          name: f.name,
          url: urlData.publicUrl,
          size: (f.metadata as any)?.size || 0,
          label: fileNameToLabel(f.name),
        };
      });
    setFiles(mediaFiles);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) {
      fetchFiles();
      // Pre-fill pencarian dengan query saran
      if (suggestQuery) setSearch("");
    }
  }, [open, fetchFiles, suggestQuery]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    let uploaded = 0;
    for (let i = 0; i < fileList.length; i++) {
      const rawFile = fileList[i];
      if (rawFile.size > 10 * 1024 * 1024) {
        toast.error(`${rawFile.name} terlalu besar (max 10MB)`);
        continue;
      }
      const defaultLabel = suggestQuery || rawFile.name.replace(/\.[^.]+$/, "");
      const label = window.prompt(
        `Beri nama foto (untuk pencarian & auto-detect):`,
        defaultLabel,
      );
      if (label === null) continue;
      const file = await compressImage(rawFile);
      const ext = getExt(file.name) || "png";
      const safeName = buildMediaFileName(label || defaultLabel, ext);
      const { error } = await supabase.storage.from("admin-media").upload(safeName, file);
      if (error) {
        toast.error(`Gagal upload ${file.name}: ${error.message}`);
      } else {
        uploaded++;
      }
    }
    if (uploaded > 0) {
      toast.success(`${uploaded} file berhasil diupload`);
      fetchFiles();
    }
    setUploading(false);
    e.target.value = "";
  };

  const handleDelete = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    if (!confirm(`Hapus file "${name}"?`)) return;
    const { error } = await supabase.storage.from("admin-media").remove([name]);
    if (error) {
      toast.error("Gagal menghapus");
    } else {
      toast.success("File dihapus");
      setFiles((prev) => prev.filter((f) => f.name !== name));
    }
  };

  // Sort: kalau ada suggestQuery, urutkan menurut skor kecocokan; sisanya tetap.
  const sorted = useMemo(() => {
    if (!suggestQuery || !suggestQuery.trim()) return files;
    return [...files].sort((a, b) => {
      const sa = matchScore(suggestQuery, `${a.label} ${a.name}`);
      const sb = matchScore(suggestQuery, `${b.label} ${b.name}`);
      return sb - sa;
    });
  }, [files, suggestQuery]);

  const filtered = sorted.filter((f) => {
    const q = search.toLowerCase();
    return f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q);
  });

  const best = useMemo(
    () => (suggestQuery ? findBestMediaMatch(suggestQuery, files.map((f) => ({ name: f.name, url: f.url, label: f.label }))) : null),
    [suggestQuery, files],
  );

  const handleAutoPick = () => {
    if (!best) return;
    onSelect(best.file.url);
    onOpenChange(false);
    toast.success(`Foto dipilih otomatis: ${best.file.label || best.file.name}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="h-5 w-5 text-primary" /> Pilih dari Galeri
          </DialogTitle>
        </DialogHeader>

        {suggestQuery && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                🔍 Mencari foto untuk: <strong className="text-foreground">{suggestQuery}</strong>
              </span>
              {best ? (
                <Button size="sm" variant="default" className="h-7 gap-1" onClick={handleAutoPick} title="Pakai saran ini (akan menimpa pilihan saat ini)">
                  <Sparkles className="h-3 w-3" /> Saran: "{best.file.label || best.file.name}"
                </Button>
              ) : (
                <span className="text-muted-foreground italic">Tidak ada foto yang cocok — pilih manual di bawah</span>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari berdasarkan nama foto..."
              className="pl-10"
            />
          </div>
          <Button variant="outline" size="icon" onClick={fetchFiles} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <label className="cursor-pointer">
            <Button size="sm" className="gap-1.5 h-10" asChild>
              <span>
                <Upload className="h-4 w-4" /> {uploading ? "..." : "Upload"}
              </span>
            </Button>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <Image className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {search ? "Tidak ada file ditemukan" : "Belum ada file. Upload gambar untuk mulai."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 py-2">
              {filtered.map((file) => {
                const isBest = best?.file.name === file.name;
                return (
                  <div
                    key={file.name}
                    className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-card transition hover:shadow-md ${
                      isBest ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary"
                    }`}
                    onClick={() => {
                      onSelect(file.url);
                      onOpenChange(false);
                    }}
                  >
                    {isBest && (
                      <span className="absolute left-1 top-1 z-10 flex items-center gap-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
                        <Sparkles className="h-2.5 w-2.5" /> Cocok
                      </span>
                    )}
                    <div className="aspect-square overflow-hidden bg-secondary/50">
                      <img
                        src={file.url}
                        alt={file.label || file.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, file.name)}
                      className="absolute right-1 top-1 rounded-full bg-destructive/90 p-1 text-destructive-foreground opacity-0 transition group-hover:opacity-100"
                      title="Hapus"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <p
                      className={`truncate px-1.5 py-1 text-[10px] ${file.label ? "text-foreground" : "italic text-muted-foreground"}`}
                      title={file.label || file.name}
                    >
                      {file.label || "(tanpa nama)"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MediaPickerDialog;
