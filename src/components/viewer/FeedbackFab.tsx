import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageSquarePlus, X, Send, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const HIDE_KEY = "rt48_feedback_fab_hidden_v1";
const HIDDEN_PATH_PREFIXES = ["/adpan", "/restream", "/reset-password", "/forgot-password"];

type Category = "saran" | "kritik" | "bug" | "lainnya";

const CATEGORIES: { value: Category; label: string; emoji: string }[] = [
  { value: "saran", label: "Saran", emoji: "💡" },
  { value: "kritik", label: "Kritik", emoji: "🗣️" },
  { value: "bug", label: "Bug", emoji: "🐛" },
  { value: "lainnya", label: "Lainnya", emoji: "✉️" },
];

const FeedbackFab = () => {
  const { toast } = useToast();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [category, setCategory] = useState<Category>("saran");
  const [message, setMessage] = useState("");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Hidden via session toggle
  useEffect(() => {
    setHidden(sessionStorage.getItem(HIDE_KEY) === "1");
  }, []);

  // Hide saat fullscreen
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  // Auto-isi username dari profil saat dialog dibuka
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data } = await supabase
            .from("profiles")
            .select("username")
            .eq("id", session.user.id)
            .maybeSingle();
          if (data?.username && !username) setUsername(data.username);
        }
      } catch { /* silent */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const path = location.pathname;
  const isHiddenRoute = HIDDEN_PATH_PREFIXES.some((p) => path.startsWith(p));

  if (isHiddenRoute || hidden || isFullscreen) return null;

  const submit = async () => {
    const trimmed = message.trim();
    if (trimmed.length < 5) {
      toast({
        title: "Pesan terlalu pendek",
        description: "Minimal 5 karakter.",
        variant: "destructive",
      });
      return;
    }
    if (trimmed.length > 1000) {
      toast({
        title: "Pesan terlalu panjang",
        description: "Maksimal 1000 karakter.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        message: trimmed,
        category,
        page_url: location.pathname + location.search,
        user_id: session?.user?.id ?? null,
        username: username.trim().slice(0, 50) || null,
        user_agent: navigator.userAgent.slice(0, 500),
      };

      const { error } = await supabase
        .from("feedback_messages")
        .insert(payload as any);

      if (error) {
        toast({
          title: "Gagal mengirim",
          description: error.message.includes("Terlalu banyak")
            ? "Anda sudah mengirim cukup banyak pesan. Coba lagi nanti."
            : error.message,
          variant: "destructive",
        });
        setSubmitting(false);
        return;
      }

      toast({
        title: "Terima kasih! 💖",
        description: "Masukan Anda sudah kami terima dan akan dibaca admin.",
      });
      setMessage("");
      setCategory("saran");
      setOpen(false);
    } catch (e: any) {
      toast({
        title: "Gagal mengirim",
        description: e?.message || "Coba lagi nanti.",
        variant: "destructive",
      });
    }
    setSubmitting(false);
  };

  const dismissForSession = () => {
    sessionStorage.setItem(HIDE_KEY, "1");
    setHidden(true);
  };

  return (
    <>
      {/* FAB — kanan-bawah, offset di atas MobileBottomNav (mobile) */}
      <div
        className="fixed right-3 z-[60] flex flex-col items-end gap-1 bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] sm:bottom-4"
        aria-label="Kritik dan saran"
      >
        <button
          onClick={dismissForSession}
          className="hidden h-5 w-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border hover:text-foreground sm:flex"
          title="Sembunyikan untuk sesi ini"
          aria-label="Sembunyikan tombol"
        >
          <X className="h-3 w-3" />
        </button>
        <button
          onClick={() => setOpen(true)}
          className="group flex items-center gap-2 rounded-full bg-primary/85 px-3 py-2.5 text-xs font-bold text-primary-foreground shadow-lg ring-1 ring-primary/40 backdrop-blur-sm transition-all hover:bg-primary hover:scale-105 hover:shadow-xl active:scale-95 opacity-70 hover:opacity-100"
          title="Kritik & Saran"
        >
          <MessageSquarePlus className="h-4 w-4" />
          <span className="hidden sm:inline">Kritik & Saran</span>
        </button>
      </div>

      {/* Dialog form */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquarePlus className="h-5 w-5 text-primary" />
              Kritik & Saran
            </DialogTitle>
            <DialogDescription>
              Bantu kami jadi lebih baik. Pesan Anda akan dibaca langsung oleh
              admin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Kategori */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Jenis masukan
              </label>
              <div className="grid grid-cols-4 gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={`flex flex-col items-center gap-0.5 rounded-lg border p-2 text-[11px] font-semibold transition ${
                      category === c.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <span className="text-lg leading-none">{c.emoji}</span>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Username (opsional) */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Nama (opsional)
              </label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Anonim"
                maxLength={50}
                className="bg-background"
              />
            </div>

            {/* Pesan */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Pesan Anda
              </label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tulis kritik, saran, atau laporan bug…"
                rows={5}
                maxLength={1000}
                className="bg-background resize-none"
              />
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Min 5 karakter</span>
                <span
                  className={
                    message.length > 950
                      ? "text-destructive font-semibold"
                      : ""
                  }
                >
                  {message.length}/1000
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="flex-1"
              >
                Batal
              </Button>
              <Button
                onClick={submit}
                disabled={submitting || message.trim().length < 5}
                className="flex-1 gap-2"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {submitting ? "Mengirim…" : "Kirim"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default FeedbackFab;
