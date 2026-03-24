import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Image, Trash2, Search, Upload, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface MediaPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (url: string) => void;
}

interface MediaFile {
  name: string;
  url: string;
  size: number;
}

const MediaPickerDialog = ({ open, onOpenChange, onSelect }: MediaPickerDialogProps) => {
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
        };
      });
    setFiles(mediaFiles);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) fetchFiles();
  }, [open, fetchFiles]);

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
      const file = await compressImage(rawFile);
      const ext = file.name.split(".").pop();
      const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
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

  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="h-5 w-5 text-primary" /> Pilih dari Galeri
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari file..."
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
              {filtered.map((file) => (
                <div
                  key={file.name}
                  className="group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary hover:shadow-md"
                  onClick={() => {
                    onSelect(file.url);
                    onOpenChange(false);
                  }}
                >
                  <div className="aspect-square overflow-hidden bg-secondary/50">
                    <img
                      src={file.url}
                      alt={file.name}
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
                  <p className="truncate px-1.5 py-1 text-[10px] text-muted-foreground" title={file.name}>
                    {file.name}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MediaPickerDialog;
