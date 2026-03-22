import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldPlus, Trash2, Shield } from "lucide-react";

interface ChatMod { id: string; username: string; created_at: string; }

const ChatModeratorManager = () => {
  const [mods, setMods] = useState<ChatMod[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [adding, setAdding] = useState(false);
  const { toast } = useToast();

  const fetchMods = async () => {
    const { data } = await supabase.from("chat_moderators" as any).select("*").order("created_at", { ascending: false });
    if (data) setMods(data as any[]);
  };

  useEffect(() => { fetchMods(); }, []);

  const addMod = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUsername.trim();
    if (!trimmed) return;
    if (mods.some((m) => m.username.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: "Username sudah menjadi moderator", variant: "destructive" });
      return;
    }
    setAdding(true);
    const { error } = await supabase.from("chat_moderators" as any).insert({ username: trimmed } as any);
    setAdding(false);
    if (error) {
      toast({ title: "Gagal menambah moderator", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${trimmed} ditambahkan sebagai moderator chat` });
      setNewUsername("");
      fetchMods();
    }
  };

  const removeMod = async (id: string, uname: string) => {
    const { error } = await supabase.from("chat_moderators" as any).delete().eq("id", id);
    if (!error) {
      toast({ title: `${uname} dihapus dari moderator chat` });
      setMods((prev) => prev.filter((m) => m.id !== id));
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">🛡️ Moderator Live Chat</h3>
      </div>
      <p className="text-[11px] text-muted-foreground">Tambahkan username viewer sebagai moderator chat. Moderator dapat menghapus pesan di live chat.</p>
      <form onSubmit={addMod} className="flex gap-2">
        <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="Username viewer..." className="bg-background" />
        <Button type="submit" size="sm" disabled={adding || !newUsername.trim()} className="gap-1.5 shrink-0">
          <ShieldPlus className="h-4 w-4" />{adding ? "..." : "Tambah"}
        </Button>
      </form>
      {mods.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 text-center py-4">Belum ada moderator chat</p>
      ) : (
        <div className="space-y-2">
          {mods.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 border border-primary/30 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-primary">🛡️ MOD</span>
                <span className="text-sm font-medium text-foreground">{m.username}</span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => removeMod(m.id, m.username)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatModeratorManager;
