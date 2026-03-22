import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Trash2, UserPlus, Loader2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Moderator {
  id: string;
  user_id: string;
  username: string;
  is_active: boolean;
  created_at: string;
}

const ModeratorAccountManager = () => {
  const [moderators, setModerators] = useState<Moderator[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchModerators = async () => {
    const { data } = await (supabase.from as any)("moderators")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setModerators(data);
  };

  useEffect(() => { fetchModerators(); }, []);

  const createModerator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !username) return;
    setCreating(true);

    const { data: { session } } = await supabase.auth.getSession();
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/manage-moderator-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: "create", email, password, username }),
      }
    );
    const result = await res.json();

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`Akun moderator ${username} berhasil dibuat.`);
      setEmail(""); setPassword(""); setUsername("");
      fetchModerators();
    }
    setCreating(false);
  };

  const deleteModerator = async (userId: string, modUsername: string) => {
    setDeletingId(userId);
    const { data: { session } } = await supabase.auth.getSession();
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/manage-moderator-account`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: "delete", user_id: userId }),
      }
    );
    const result = await res.json();

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`Akun ${modUsername} berhasil dihapus.`);
      fetchModerators();
    }
    setDeletingId(null);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-foreground">👥 Kelola Akun Moderator</h2>

      <form onSubmit={createModerator} className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold text-foreground">Buat Akun Moderator Baru</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} className="bg-background" required />
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="bg-background" required />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="bg-background" required minLength={6} />
        </div>
        <Button type="submit" disabled={creating}>
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
          {creating ? "Membuat..." : "Buat Akun"}
        </Button>
      </form>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead className="w-[80px]">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {moderators.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">Belum ada moderator.</TableCell>
              </TableRow>
            ) : (
              moderators.map((mod) => (
                <TableRow key={mod.id}>
                  <TableCell className="font-medium">{mod.username}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${mod.is_active ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]" : "bg-destructive/10 text-destructive"}`}>
                      {mod.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(mod.created_at).toLocaleDateString("id-ID")}
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Hapus Akun Moderator?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Akun <strong>{mod.username}</strong> akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Batal</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteModerator(mod.user_id, mod.username)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            {deletingId === mod.user_id ? "Menghapus..." : "Hapus"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default ModeratorAccountManager;
