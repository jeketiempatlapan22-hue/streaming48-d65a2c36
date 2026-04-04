import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage, formatFileSize } from "@/lib/imageCompressor";
import { toast } from "sonner";
import { Users, Upload, Trash2, Search, RefreshCw, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

interface MemberPhoto {
  id: string;
  name: string;
  photo_url: string | null;
  created_at: string;
}

const MemberPhotoManager = () => {
  const [members, setMembers] = useState<MemberPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);

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
    // Delete photo from storage if exists
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

  const handlePhotoUpload = async (memberId: string, memberName: string, file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("File harus berupa gambar");
      return;
    }
    setUploading(memberId);
    try {
      const compressed = await compressImage(file, {
        maxWidth: 400,
        maxHeight: 400,
        quality: 0.85,
        maxSizeBytes: 100_000,
      });
      const ext = compressed.name.split(".").pop() || "webp";
      const safeName = memberName.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const filePath = `${safeName}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("member-photos")
        .upload(filePath, compressed, { upsert: true });

      if (uploadError) {
        toast.error("Gagal upload: " + uploadError.message);
        return;
      }

      const { data: urlData } = supabase.storage.from("member-photos").getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from("member_photos")
        .update({ photo_url: urlData.publicUrl })
        .eq("id", memberId);

      if (updateError) {
        toast.error("Gagal update data");
      } else {
        toast.success(`Foto ${memberName} diupload (${formatFileSize(compressed.size)})`);
        setMembers(prev =>
          prev.map(m => m.id === memberId ? { ...m, photo_url: urlData.publicUrl } : m)
        );
      }
    } catch {
      toast.error("Gagal compress/upload foto");
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
            {search ? "Tidak ditemukan" : "Belum ada member. Tambahkan nama member di atas."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map(member => (
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

              <p className="text-xs font-semibold text-foreground text-center truncate w-full">
                {member.name}
              </p>

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
          ))}
        </div>
      )}
    </div>
  );
};

export default MemberPhotoManager;
