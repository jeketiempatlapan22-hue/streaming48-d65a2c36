import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart3, Plus, Trash2, Send, XCircle } from "lucide-react";

const PollManager = () => {
  const [polls, setPolls] = useState<any[]>([]);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  const fetchPolls = async () => {
    const { data } = await supabase
      .from("live_polls")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);
    setPolls(data || []);
  };

  useEffect(() => { fetchPolls(); }, []);

  const handleCreate = async () => {
    const validOptions = options.filter(o => o.trim());
    if (!question.trim() || validOptions.length < 2) {
      toast({ title: "Minimal 2 opsi dan 1 pertanyaan", variant: "destructive" });
      return;
    }
    setCreating(true);
    await supabase.from("live_polls").update({ is_active: false, ended_at: new Date().toISOString() } as any).eq("is_active", true);
    const { error } = await supabase.from("live_polls").insert({ question: question.trim(), options: validOptions, is_active: true } as any);
    setCreating(false);
    if (error) {
      toast({ title: "Gagal membuat poll", variant: "destructive" });
    } else {
      toast({ title: "Poll dibuat!" });
      setQuestion("");
      setOptions(["", ""]);
      fetchPolls();
    }
  };

  const handleEnd = async (id: string) => {
    await supabase.from("live_polls").update({ is_active: false, ended_at: new Date().toISOString() } as any).eq("id", id);
    toast({ title: "Poll diakhiri" });
    fetchPolls();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("live_polls").delete().eq("id", id);
    fetchPolls();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Live Poll</h3>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pertanyaan poll..." className="text-sm" />
        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={i} className="flex gap-2">
              <Input value={opt} onChange={(e) => { const next = [...options]; next[i] = e.target.value; setOptions(next); }} placeholder={`Opsi ${i + 1}`} className="text-sm" />
              {options.length > 2 && (
                <Button variant="ghost" size="icon" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {options.length < 8 && (
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setOptions([...options, ""])}>
            <Plus className="h-3 w-3" /> Tambah Opsi
          </Button>
        )}
        <Button className="w-full gap-2" onClick={handleCreate} disabled={creating}>
          <Send className="h-4 w-4" /> {creating ? "Membuat..." : "Kirim Poll ke Viewer"}
        </Button>
      </div>

      {polls.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Riwayat Poll</p>
          {polls.map((poll) => (
            <div key={poll.id} className="flex items-center justify-between rounded-lg border border-border bg-background p-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground truncate">{poll.question}</p>
                <p className="text-[10px] text-muted-foreground">
                  {(poll.options as string[])?.length || 0} opsi · {poll.is_active ? "🟢 Aktif" : "⚪ Selesai"}
                </p>
              </div>
              <div className="flex gap-1">
                {poll.is_active && (
                  <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => handleEnd(poll.id)}>
                    <XCircle className="h-3 w-3" /> Akhiri
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(poll.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PollManager;
