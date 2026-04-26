import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage, formatFileSize } from "@/lib/imageCompressor";
import { toast } from "sonner";
import { Users, Upload, Trash2, Search, RefreshCw, Plus, X, FolderUp, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";

interface MemberPhoto {
  id: string;
  name: string;
  photo_url: string | null;
  created_at: string;
}

/**
 * Convert filename to clean member name.
 * "freya_jkt48.jpg" → "Freya Jkt48"
 * "Zee-JKT48.png"  → "Zee Jkt48"
 * "christy 01.webp"→ "Christy 01"
 */
function filenameToMemberName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, ""); // strip extension
  const cleaned = base
    .replace(/[_\-\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Title case each word
  return cleaned
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const MemberPhotoManager = () => {
  const [members, setMembers] = useState<MemberPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);

  // Bulk upload state
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Edit name state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("member_photos")
      .select("*")
      .order("name");
    if (error) {
      toast.error("Gagal memuat data member");
    } else {
      setMembers(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const addMember = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (members.some(m => m.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("Nama member sudah ada");
      return;
    }
    const { error } = await supabase.from("member_photos").insert({ name: trimmed });
    if (error) {
      toast.error("Gagal menambah member: " + error.message);
    } else {
      toast.success(`${trimmed} ditambahkan`);
      setNewName("");
      fetchMembers();
    }
  };

  const deleteMember = async (member: MemberPhoto) => {
    if (!confirm(`Hapus "${member.name}" dari daftar member?`)) return;
    if (member.photo_url) {
      const path = member.photo_url.split("/member-photos/")[1];
      if (path) {
        await supabase.storage.from("member-photos").remove([decodeURIComponent(path)]);
      }
    }
    const { error } = await supabase.from("member_photos").delete().eq("id", member.id);
    if (error) {
      toast.error("Gagal menghapus");
    } else {
      toast.success(`${member.name} dihapus`);
      setMembers(prev => prev.filter(m => m.id !== member.id));
    }
  };

  const startEditName = (member: MemberPhoto) => {
    setEditingId(member.id);
    setEditName(member.name);
  };

  const cancelEditName = () => {
    setEditingId(null);
    setEditName("");
  };

  const saveEditName = async (member: MemberPhoto) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      toast.error("Nama tidak boleh kosong");
      return;
    }
    if (trimmed === member.name) {
      cancelEditName();
      return;
    }
    if (members.some(m => m.id !== member.id && m.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("Nama member sudah dipakai");
      return;
    }
    const { error } = await supabase
      .from("member_photos")
      .update({ name: trimmed })
      .eq("id", member.id);
    if (error) {
      toast.error("Gagal update nama: " + error.message);
    } else {
      toast.success(`Nama diubah ke "${trimmed}"`);
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, name: trimmed } : m));
      cancelEditName();
    }
  };

  const uploadPhotoForMember = async (memberId: string | null, memberName: string, file: File) => {
    const compressed = await compressImage(file, {
      maxWidth: 400,
      maxHeight: 400,
      quality: 0.85,
      maxSizeBytes: 100_000,
    });

    const formData = new FormData();
    formData.append("file", compressed);
    formData.append("member_name", memberName);
    if (memberId) formData.append("member_id", memberId);

    const { data, error } = await supabase.functions.invoke("admin-member-photo", {
      body: formData,
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || "Upload gagal");

    return { url: data.photo_url as string, size: compressed.size, member: data.member as MemberPhoto };
  };

  const handlePhotoUpload = async (memberId: string, memberName: string, file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("File harus berupa gambar");
      return;
    }
    setUploading(memberId);
    try {
      const { url, size } = await uploadPhotoForMember(memberId, memberName, file);
      toast.success(`Foto ${memberName} diupload (${formatFileSize(size)})`);
      setMembers(prev =>
        prev.map(m => m.id === memberId ? { ...m, photo_url: url } : m)
      );
    } catch (err: any) {
      toast.error("Gagal upload: " + (err?.message || "unknown"));
    } finally {
      setUploading(null);
    }
  };

  const removePhoto = async (member: MemberPhoto) => {
    if (!member.photo_url) return;
    const path = member.photo_url.split("/member-photos/")[1];
    if (path) {
      await supabase.storage.from("member-photos").remove([decodeURIComponent(path)]);
    }
    await supabase.from("member_photos").update({ photo_url: null }).eq("id", member.id);
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, photo_url: null } : m));
    toast.success("Foto dihapus");
  };

  /**
   * Bulk upload from folder picker (or multiple files).
   * Each filename becomes the member name (cleaned + title-cased).
   * If a member with that name already exists → just updates the photo.
   * Otherwise → creates a new member then uploads.
   */
  const handleBulkFolderUpload = async (files: FileList) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast.error("Tidak ada file gambar di folder");
      return;
    }

    setBulkUploading(true);
    setBulkProgress({ current: 0, total: imageFiles.length });

    let success = 0;
    let failed = 0;
    let skipped = 0;
    const seenNames = new Set<string>();

    // Refresh latest member list first
    const { data: latestMembers } = await supabase.from("member_photos").select("*");
    const memberMap = new Map<string, MemberPhoto>();
    (latestMembers || []).forEach(m => memberMap.set(m.name.toLowerCase(), m as MemberPhoto));

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      setBulkProgress({ current: i + 1, total: imageFiles.length });

      // Use only filename (drop folder path from webkitdirectory)
      const rawName = (file as any).webkitRelativePath
        ? (file as any).webkitRelativePath.split("/").pop() || file.name
        : file.name;
      const memberName = filenameToMemberName(rawName);

      if (!memberName || memberName.length < 2) {
        skipped++;
        continue;
      }

      const key = memberName.toLowerCase();
      if (seenNames.has(key)) {
        skipped++; // duplicate filename in same batch
        continue;
      }
      seenNames.add(key);

      try {
        let memberId: string | null;
        const existing = memberMap.get(key);
        if (existing) {
          memberId = existing.id;
        } else {
          memberId = null;
        }

        const result = await uploadPhotoForMember(memberId, memberName, file);
        if (result.member) memberMap.set(key, result.member);
        success++;
      } catch (err) {
        console.error("Bulk upload failed for", file.name, err);
        failed++;
      }
    }

    setBulkUploading(false);
    setBulkProgress({ current: 0, total: 0 });

    if (success > 0) toast.success(`${success} foto member berhasil diupload`);
    if (failed > 0) toast.error(`${failed} foto gagal diupload`);
    if (skipped > 0) toast.info(`${skipped} file dilewati (duplikat/nama tidak valid)`);

    fetchMembers();
  };

  const filtered = members.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-foreground">Foto Member</h2>
        <span className="ml-auto text-xs text-muted-foreground">{members.length} member</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Upload foto member di sini. Nama member yang cocok dengan lineup show akan otomatis ditampilkan di bawah player sebagai avatar.
        Untuk upload massal, pilih <strong>Upload Folder</strong> — nama member diambil otomatis dari nama file (contoh: <code className="px-1 py-0.5 rounded bg-secondary text-[10px]">freya_jkt48.jpg</code> → <strong>Freya Jkt48</strong>).
      </p>

      {/* Add new member */}
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Nama member baru..."
          className="flex-1"
          onKeyDown={e => e.key === "Enter" && addMember()}
        />
        <Button size="sm" onClick={addMember} disabled={!newName.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Tambah
        </Button>
      </div>

      {/* Bulk folder upload */}
      <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FolderUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Upload Folder Foto Member</span>
          </div>
          <Button
            size="sm"
            onClick={() => folderInputRef.current?.click()}
            disabled={bulkUploading}
            className="gap-1"
          >
            {bulkUploading ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" />
                Mengupload...
              </>
            ) : (
              <>
                <FolderUp className="h-3 w-3" />
                Pilih Folder
              </>
            )}
          </Button>
          <input
            ref={folderInputRef}
            type="file"
            accept="image/*"
            multiple
            // @ts-expect-error - webkitdirectory not in TS DOM lib
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={e => {
              if (e.target.files && e.target.files.length > 0) {
                handleBulkFolderUpload(e.target.files);
              }
              e.target.value = "";
            }}
          />
        </div>
        {bulkUploading && (
          <div className="space-y-1">
            <Progress value={(bulkProgress.current / Math.max(bulkProgress.total, 1)) * 100} className="h-2" />
            <p className="text-[10px] text-muted-foreground text-center">
              Memproses {bulkProgress.current} / {bulkProgress.total} foto...
            </p>
          </div>
        )}
        {!bulkUploading && (
          <p className="text-[10px] text-muted-foreground">
            💡 Tip: nama file akan jadi nama member otomatis. Member baru dibuat jika belum ada, atau foto diperbarui jika sudah ada.
          </p>
        )}
      </div>

      {/* Search + refresh */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cari member..."
            className="pl-10"
          />
        </div>
        <Button variant="outline" size="icon" onClick={fetchMembers} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Member grid */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center">
          <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {search ? "Tidak ditemukan" : "Belum ada member. Tambahkan nama member di atas atau upload folder."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map(member => {
            const isEditing = editingId === member.id;
            return (
              <div
                key={member.id}
                className="group relative flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-3 transition hover:border-primary/40"
              >
                <Avatar className="h-16 w-16 border-2 border-border">
                  {member.photo_url ? (
                    <AvatarImage src={member.photo_url} alt={member.name} />
                  ) : null}
                  <AvatarFallback className="bg-secondary text-lg font-bold text-muted-foreground">
                    {member.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                {isEditing ? (
                  <div className="flex w-full gap-1">
                    <Input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="h-7 text-xs px-1.5"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === "Enter") saveEditName(member);
                        if (e.key === "Escape") cancelEditName();
                      }}
                    />
                    <button
                      onClick={() => saveEditName(member)}
                      className="rounded bg-primary p-1 text-primary-foreground hover:opacity-90"
                      title="Simpan"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      onClick={cancelEditName}
                      className="rounded bg-secondary p-1 text-muted-foreground hover:text-destructive"
                      title="Batal"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEditName(member)}
                    className="group/name flex items-center gap-1 text-xs font-semibold text-foreground text-center w-full justify-center hover:text-primary transition truncate"
                    title="Klik untuk edit nama"
                  >
                    <span className="truncate">{member.name}</span>
                    <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/name:opacity-100 flex-shrink-0" />
                  </button>
                )}

                {/* Upload button */}
                <label className="cursor-pointer">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-[10px]"
                    asChild
                    disabled={uploading === member.id}
                  >
                    <span>
                      {uploading === member.id ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Upload className="h-3 w-3" />
                      )}
                      {member.photo_url ? "Ganti" : "Upload"}
                    </span>
                  </Button>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handlePhotoUpload(member.id, member.name, f);
                      e.target.value = "";
                    }}
                    disabled={uploading === member.id}
                  />
                </label>

                {/* Delete actions */}
                <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                  {member.photo_url && (
                    <button
                      onClick={() => removePhoto(member)}
                      className="rounded-full bg-secondary p-1 text-muted-foreground hover:text-destructive"
                      title="Hapus foto"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteMember(member)}
                    className="rounded-full bg-destructive/90 p-1 text-destructive-foreground"
                    title="Hapus member"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MemberPhotoManager;
