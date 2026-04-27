import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompressor";
import { toast } from "sonner";
import { Upload, Trash2, Copy, Image, Search, RefreshCw, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildMediaFileName, fileNameToLabel, renameFile, getExt } from "@/lib/mediaNaming";

interface MediaFile {
  name: string;
  url: string;
  created_at: string;
  size: number;
  label: string;
}

const MediaLibrary = () => {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.storage.from("admin-media").list("", {
      limit: 200,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) {
      toast.error("Gagal memuat file");
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
          created_at: f.created_at || "",
          size: (f.metadata as any)?.size || 0,
          label: fileNameToLabel(f.name),
        };
      });
    setFiles(mediaFiles);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

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
      const defaultLabel = rawFile.name.replace(/\.[^.]+$/, "");
      const label = window.prompt(
        `Beri nama foto "${rawFile.name}" (akan dipakai untuk pencarian & auto-detect background show):`,
        defaultLabel,
      );
      if (label === null) continue; // batal
      const file = await compressImage(rawFile);
      const ext = getExt(file.name) || "png";
      const safeName = buildMediaFileName(label || defaultLabel, ext);
      const { error } = await supabase.storage.from("admin-media").upload(safeName, file);
      if (error) {
        toast.error(`Gagal upload ${file.name}`);
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

  const handleDelete = async (name: string) => {
    if (!confirm(`Hapus file "${name}"?`)) return;
    const { error } = await supabase.storage.from("admin-media").remove([name]);
    if (error) {
      toast.error("Gagal menghapus");
    } else {
      toast.success("File dihapus");
      setFiles((prev) => prev.filter((f) => f.name !== name));
    }
  };

  const startRename = (file: MediaFile) => {
    setRenamingName(file.name);
    setRenameValue(file.label || file.name.replace(/\.[^.]+$/, ""));
  };

  const cancelRename = () => {
    setRenamingName(null);
    setRenameValue("");
  };

  const submitRename = async (oldName: string) => {
    if (!renameValue.trim()) {
      toast.error("Nama tidak boleh kosong");
      return;
    }
    const newName = renameFile(oldName, renameValue);
    if (newName === oldName) {
      cancelRename();
      return;
    }
    const { error } = await supabase.storage.from("admin-media").move(oldName, newName);
    if (error) {
      toast.error(`Gagal mengganti nama: ${error.message}`);
      return;
    }
    toast.success("Nama foto diperbarui");
    cancelRename();
    fetchFiles();
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("URL disalin ke clipboard!");
  };

  const filtered = files.filter((f) => {
    const q = search.toLowerCase();
    return f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q);
  });

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Image className="h-5 w-5 text-primary" /> Media Library
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchFiles} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <label className="cursor-pointer">
            <Button size="sm" className="gap-1.5" asChild>
              <span>
                <Upload className="h-4 w-4" /> {uploading ? "Mengupload..." : "Upload"}
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
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari berdasarkan nama foto..."
          className="pl-10"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        💡 Beri nama deskriptif (contoh: "Pajama Drive Team Love") agar foto bisa dikenali otomatis sebagai background kartu show dengan judul yang mirip.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Image className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {search ? "Tidak ada file ditemukan" : "Belum ada file. Upload gambar untuk mulai."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((file) => {
            const isRenaming = renamingName === file.name;
            return (
              <div
                key={file.name}
                className="group relative overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/40 hover:shadow-md"
              >
                <button
                  onClick={() => setPreviewUrl(file.url)}
                  className="block w-full"
                >
                  <div className="aspect-square overflow-hidden bg-secondary/50">
                    <img
                      src={file.url}
                      alt={file.label || file.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                </button>
                <div className="p-2">
                  {isRenaming ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename(file.name);
                          if (e.key === "Escape") cancelRename();
                        }}
                        className="h-7 text-[11px]"
                      />
                      <button onClick={() => submitRename(file.name)} className="rounded bg-primary/20 p-1 text-primary" title="Simpan">
                        <Check className="h-3 w-3" />
                      </button>
                      <button onClick={cancelRename} className="rounded bg-muted p-1 text-muted-foreground" title="Batal">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <p
                        className={`truncate text-[11px] font-medium ${file.label ? "text-foreground" : "italic text-muted-foreground"}`}
                        title={file.label || file.name}
                      >
                        {file.label || "(belum diberi nama)"}
                      </p>
                      <button
                        onClick={() => startRename(file)}
                        className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        title="Ganti nama"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">{formatSize(file.size)}</p>
                  <div className="mt-1.5 flex gap-1">
                    <button
                      onClick={() => copyUrl(file.url)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary transition hover:bg-primary/20"
                      title="Salin URL"
                    >
                      <Copy className="h-3 w-3" /> URL
                    </button>
                    <button
                      onClick={() => handleDelete(file.name)}
                      className="flex items-center justify-center rounded-md bg-destructive/10 px-2 py-1 text-destructive transition hover:bg-destructive/20"
                      title="Hapus"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl("")}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <div className="space-y-3">
              <img src={previewUrl} alt="Preview" className="w-full rounded-lg object-contain max-h-[60vh]" />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-1.5" onClick={() => copyUrl(previewUrl)}>
                  <Copy className="h-4 w-4" /> Salin URL
                </Button>
              </div>
              <Input value={previewUrl} readOnly className="text-xs" onClick={(e) => (e.target as HTMLInputElement).select()} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MediaLibrary;
