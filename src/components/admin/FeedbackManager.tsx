import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Search,
  Trash2,
  Archive,
  ArchiveRestore,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Inbox,
} from "lucide-react";

interface FeedbackRow {
  id: string;
  message: string;
  category: string;
  page_url: string;
  user_id: string | null;
  username: string | null;
  user_agent: string | null;
  is_read: boolean;
  is_archived: boolean;
  created_at: string;
}

type StatusFilter = "all" | "unread" | "read" | "archived";

const CATEGORY_LABEL: Record<string, { label: string; color: string; emoji: string }> = {
  saran: { label: "Saran", color: "bg-blue-500/15 text-blue-500 border-blue-500/30", emoji: "💡" },
  kritik: { label: "Kritik", color: "bg-orange-500/15 text-orange-500 border-orange-500/30", emoji: "🗣️" },
  bug: { label: "Bug", color: "bg-red-500/15 text-red-500 border-red-500/30", emoji: "🐛" },
  lainnya: { label: "Lainnya", color: "bg-muted text-muted-foreground border-border", emoji: "✉️" },
};

const formatRelative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} hari lalu`;
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const shortUA = (ua: string | null) => {
  if (!ua) return "Tidak diketahui";
  const m = ua.match(/(Chrome|Safari|Firefox|Edg|SamsungBrowser|OPR|MiuiBrowser)\/[\d.]+/);
  const platform = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
    ? "Android"
    : /Windows/.test(ua)
    ? "Windows"
    : /Mac OS/.test(ua)
    ? "macOS"
    : "?";
  return `${platform} • ${m ? m[0].split("/")[0] : "Browser"}`;
};

const FeedbackManager = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("unread");
  const [category, setCategory] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("feedback_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      toast({
        title: "Gagal memuat",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setRows((data as any) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Realtime: insert/update/delete
    const ch = supabase
      .channel("feedback-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feedback_messages" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (status === "unread" && (r.is_read || r.is_archived)) return false;
      if (status === "read" && (!r.is_read || r.is_archived)) return false;
      if (status === "archived" && !r.is_archived) return false;
      if (category !== "all" && r.category !== category) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.message.toLowerCase().includes(q) &&
          !(r.username || "").toLowerCase().includes(q) &&
          !(r.page_url || "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [rows, status, category, search]);

  const counts = useMemo(() => {
    return {
      unread: rows.filter((r) => !r.is_read && !r.is_archived).length,
      read: rows.filter((r) => r.is_read && !r.is_archived).length,
      archived: rows.filter((r) => r.is_archived).length,
      total: rows.length,
    };
  }, [rows]);

  const setRead = async (id: string, value: boolean) => {
    const { error } = await supabase
      .from("feedback_messages")
      .update({ is_read: value })
      .eq("id", id);
    if (error) toast({ title: "Gagal", description: error.message, variant: "destructive" });
  };

  const setArchived = async (id: string, value: boolean) => {
    const { error } = await supabase
      .from("feedback_messages")
      .update({ is_archived: value, is_read: true })
      .eq("id", id);
    if (error) toast({ title: "Gagal", description: error.message, variant: "destructive" });
  };

  const remove = async (id: string) => {
    if (!confirm("Hapus feedback ini permanen?")) return;
    const { error } = await supabase.from("feedback_messages").delete().eq("id", id);
    if (error) toast({ title: "Gagal", description: error.message, variant: "destructive" });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <MessageSquare className="h-5 w-5 text-primary" />
            Kritik & Saran
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pesan dari pengguna seluruh halaman
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-md bg-primary/15 px-2 py-1 font-bold text-primary">
            {counts.unread} baru
          </span>
          <span className="rounded-md bg-muted px-2 py-1 font-semibold text-muted-foreground">
            Total {counts.total}
          </span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari pesan, nama, halaman…"
            className="pl-8 bg-background"
          />
        </div>

        {/* Status pills */}
        <div className="flex gap-1 rounded-md bg-secondary p-1">
          {(
            [
              ["unread", `Baru (${counts.unread})`],
              ["read", `Dibaca (${counts.read})`],
              ["archived", `Arsip (${counts.archived})`],
              ["all", "Semua"],
            ] as [StatusFilter, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStatus(v)}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                status === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-background"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Category */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground"
        >
          <option value="all">Semua kategori</option>
          <option value="saran">💡 Saran</option>
          <option value="kritik">🗣️ Kritik</option>
          <option value="bug">🐛 Bug</option>
          <option value="lainnya">✉️ Lainnya</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card p-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
          <Inbox className="h-10 w-10 opacity-50" />
          <p className="text-sm font-semibold">Tidak ada feedback di filter ini</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const cat = CATEGORY_LABEL[r.category] || CATEGORY_LABEL.lainnya;
            return (
              <div
                key={r.id}
                className={`rounded-xl border bg-card p-4 transition ${
                  !r.is_read && !r.is_archived
                    ? "border-primary/40 shadow-sm shadow-primary/10"
                    : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${cat.color}`}
                    >
                      <span>{cat.emoji}</span>
                      {cat.label}
                    </span>
                    {!r.is_read && !r.is_archived && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-extrabold text-primary-foreground">
                        BARU
                      </span>
                    )}
                    {r.is_archived && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold text-muted-foreground">
                        ARSIP
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelative(r.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setRead(r.id, !r.is_read)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      title={r.is_read ? "Tandai belum dibaca" : "Tandai dibaca"}
                    >
                      {r.is_read ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => setArchived(r.id, !r.is_archived)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      title={r.is_archived ? "Kembalikan dari arsip" : "Arsipkan"}
                    >
                      {r.is_archived ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="rounded p-1.5 text-destructive hover:bg-destructive/10"
                      title="Hapus permanen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {r.message}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <span>
                    <span className="font-semibold text-foreground">
                      {r.username || "Anonim"}
                    </span>
                    {r.user_id ? " · login" : " · tamu"}
                  </span>
                  {r.page_url && (
                    <a
                      href={r.page_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-primary"
                      title={r.page_url}
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span className="max-w-[180px] truncate">{r.page_url}</span>
                    </a>
                  )}
                  <span>{shortUA(r.user_agent)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FeedbackManager;
