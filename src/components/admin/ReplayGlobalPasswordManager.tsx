import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Plus, Trash2, Calendar, CalendarDays, Globe } from "lucide-react";

/**
 * Sandi global replay disimpan di site_settings dengan pola key:
 *   - replay_global_password__YYYY-MM        → sandi bulanan
 *   - replay_global_password__YYYY-MM-DD     → sandi tanggal spesifik
 *   - replay_global_password__all            → sandi master (semua bulan)
 *
 * RPC validate_replay_access akan mencocokkan password input dengan key-key di atas.
 */

interface SettingRow {
  id: string;
  key: string;
  value: string;
}

const PREFIX = "replay_global_password__";

const ReplayGlobalPasswordManager = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New entry
  const [scope, setScope] = useState<"all" | "month" | "day">("month");
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear().toString());
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [day, setDay] = useState(String(now.getDate()).padStart(2, "0"));
  const [password, setPassword] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("site_settings")
      .select("*")
      .like("key", `${PREFIX}%`)
      .order("key", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "Gagal memuat sandi global", description: error.message, variant: "destructive" });
      return;
    }
    setItems((data as SettingRow[]) || []);
  };

  useEffect(() => {
    void fetchAll();
  }, []);

  const buildKey = (): string => {
    if (scope === "all") return `${PREFIX}all`;
    if (scope === "month") return `${PREFIX}${year}-${month}`;
    return `${PREFIX}${year}-${month}-${day}`;
  };

  const addPassword = async () => {
    const trimmed = password.trim();
    if (!trimmed) {
      toast({ title: "Sandi tidak boleh kosong", variant: "destructive" });
      return;
    }
    if (trimmed.length < 4) {
      toast({ title: "Sandi minimal 4 karakter", variant: "destructive" });
      return;
    }
    setSaving(true);
    const key = buildKey();
    const { error } = await supabase.from("site_settings").upsert({ key, value: trimmed }, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast({ title: "Gagal menyimpan", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Sandi global tersimpan", description: key });
    setPassword("");
    void fetchAll();
  };

  const removePassword = async (key: string) => {
    if (!window.confirm(`Hapus sandi global '${key}'?`)) return;
    const { error } = await supabase.from("site_settings").delete().eq("key", key);
    if (error) {
      toast({ title: "Gagal menghapus", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Sandi dihapus" });
    void fetchAll();
  };

  const labelFor = (key: string) => {
    const tail = key.replace(PREFIX, "");
    if (tail === "all") return "Sandi Master (semua periode)";
    if (/^\d{4}-\d{2}$/.test(tail)) {
      const [y, m] = tail.split("-");
      const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
      return `Bulanan • ${monthName}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(tail)) {
      const dt = new Date(`${tail}T00:00:00`);
      return `Harian • ${dt.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })}`;
    }
    return tail;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" /> Sandi Global Replay
        </h2>
        <p className="text-sm text-muted-foreground">
          Sandi global dapat dipakai user untuk membuka semua replay yang sudah memiliki link M3U8/YouTube
          pada periode yang ditentukan (bulanan / tanggal spesifik / master).
        </p>
      </div>

      {/* Form tambah sandi */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Plus className="h-4 w-4" /> Tambah / Update Sandi Global
        </h3>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setScope("all")}
            className={`rounded-lg border p-2 text-xs font-medium transition ${
              scope === "all" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"
            }`}
          >
            <KeyRound className="mx-auto mb-1 h-4 w-4" /> Master
          </button>
          <button
            onClick={() => setScope("month")}
            className={`rounded-lg border p-2 text-xs font-medium transition ${
              scope === "month" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"
            }`}
          >
            <Calendar className="mx-auto mb-1 h-4 w-4" /> Bulanan
          </button>
          <button
            onClick={() => setScope("day")}
            className={`rounded-lg border p-2 text-xs font-medium transition ${
              scope === "day" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"
            }`}
          >
            <CalendarDays className="mx-auto mb-1 h-4 w-4" /> Tanggal
          </button>
        </div>

        {scope !== "all" && (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] uppercase text-muted-foreground">Tahun</label>
              <Input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} className="bg-background" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-muted-foreground">Bulan</label>
              <Input
                value={month}
                onChange={(e) => setMonth(e.target.value.replace(/\D/g, "").slice(0, 2).padStart(2, "0"))}
                className="bg-background"
              />
            </div>
            {scope === "day" && (
              <div>
                <label className="text-[10px] uppercase text-muted-foreground">Tanggal</label>
                <Input
                  value={day}
                  onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2).padStart(2, "0"))}
                  className="bg-background"
                />
              </div>
            )}
          </div>
        )}

        <div>
          <label className="text-[10px] uppercase text-muted-foreground">Sandi</label>
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contoh: RT48-APR2026"
            className="bg-background font-mono"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">Minimal 4 karakter. Sandi disimpan apa adanya.</p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
          <span>Key:</span>
          <span className="font-mono text-foreground">{buildKey()}</span>
        </div>

        <Button onClick={addPassword} disabled={saving} className="w-full">
          <Plus className="mr-1 h-4 w-4" /> {saving ? "Menyimpan..." : "Simpan Sandi"}
        </Button>
      </div>

      {/* Daftar sandi */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Daftar Sandi Global Aktif</h3>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Memuat…</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada sandi global.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
              >
                <KeyRound className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{labelFor(row.key)}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {row.key} → <span className="text-foreground">{row.value}</span>
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removePassword(row.key)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ReplayGlobalPasswordManager;
