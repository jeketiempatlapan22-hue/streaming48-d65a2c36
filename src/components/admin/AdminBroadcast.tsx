import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, Megaphone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const AdminBroadcast = () => {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) return;
    setSending(true);
    const { error } = await supabase.from("admin_notifications").insert({
      title: title.trim(),
      message: message.trim(),
      type: "broadcast",
    });
    setSending(false);
    if (error) {
      toast.error("Gagal mengirim broadcast");
    } else {
      toast.success("Broadcast berhasil dikirim!");
      setTitle("");
      setMessage("");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Broadcast Pengumuman</h3>
      </div>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Judul</label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Judul pengumuman" className="bg-background" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Pesan</label>
          <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Isi pesan broadcast..." rows={3} className="bg-background resize-none" />
        </div>
        <Button onClick={handleSend} disabled={sending || !title.trim() || !message.trim()} className="gap-2">
          <Send className="h-4 w-4" /> {sending ? "Mengirim..." : "Kirim Broadcast"}
        </Button>
      </div>
    </div>
  );
};

export default AdminBroadcast;
