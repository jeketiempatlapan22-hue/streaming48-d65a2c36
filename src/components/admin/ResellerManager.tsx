import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, RefreshCw, KeyRound, Trash2, Eye, ShoppingBag, CheckCircle2, AlertTriangle, MessageCircle, Send, Loader2, Pencil } from "lucide-react";

/**
 * Normalize Indonesian phone numbers to the canonical "62xxxxxxxxxx" format
 * used by the WhatsApp bot lookup (`get_reseller_by_phone`).
 * - strip non-digits
 * - "08xxx" → "628xxx"
 * - "8xxx"  → "628xxx"
 * - "+62xx" → "62xx" (handled by digit strip)
 */
const normalizeWaPhone = (raw: string): string => {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
};

const isValidWaPhone = (normalized: string): boolean => {
  // Indonesian mobile numbers normalized as 62 + (8XXXXXXXXX) → typically 11–15 digits
  return /^62\d{8,13}$/.test(normalized);
};

const ResellerManager = () => {
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  // create form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [prefix, setPrefix] = useState("");
  const [notes, setNotes] = useState("");

  // dialogs
  const [detail, setDetail] = useState<any>(null);
  const [pwReseller, setPwReseller] = useState<any>(null);
  const [newPw, setNewPw] = useState("");
  const [resetConfirm, setResetConfirm] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [testingPhone, setTestingPhone] = useState<string | null>(null);

  // edit reseller dialog
  const [editReseller, setEditReseller] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editPrefix, setEditPrefix] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  /**
   * Send a test WhatsApp message via the admin-gated `send-whatsapp` edge function
   * to verify that the reseller's number is reachable through the bot. Surfaces
   * success / failure toasts based on the webhook response.
   */
  const sendTestMessage = async (rawTarget: string, label?: string) => {
    const target = normalizeWaPhone(rawTarget);
    if (!isValidWaPhone(target)) {
      toast({ title: "Nomor tidak valid", description: "Periksa format nomor sebelum mengirim tes.", variant: "destructive" });
      return;
    }
    setTestingPhone(target);
    const message =
      `🤖 *Tes Koneksi Bot*\n\n` +
      `Halo${label ? ` ${label}` : ""}, ini pesan uji dari admin RealTime48 untuk memastikan nomor WhatsApp ini terhubung dengan bot reseller.\n\n` +
      `Jika kamu menerima pesan ini, kirim *${label ? "/" + (prefix || "X").toUpperCase() + "stats" : "/<prefix>stats"}* untuk mulai menggunakan command reseller.`;
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: { target, message },
      });
      if (error) throw new Error(error.message);
      const res = data as any;
      if (res?.success) {
        toast({
          title: "✅ Pesan tes terkirim",
          description: `Bot WhatsApp berhasil mengirim pesan ke +${target}. Periksa WhatsApp untuk konfirmasi.`,
        });
      } else {
        toast({
          title: "⚠️ Gagal mengirim",
          description: res?.error || "Webhook menolak permintaan. Periksa token Fonnte dan status nomor.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "❌ Error koneksi bot",
        description: err?.message || "Tidak dapat menghubungi edge function send-whatsapp.",
        variant: "destructive",
      });
    } finally {
      setTestingPhone(null);
    }
  };

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.rpc("reseller_stats");
    const res = data as any;
    if (res?.success) setStats(res.stats || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const normalizedPhone = normalizeWaPhone(phone);
  const phoneValid = isValidWaPhone(normalizedPhone);

  const createReseller = async () => {
    if (!name || !phone || !password || !prefix) {
      toast({ title: "Lengkapi data", variant: "destructive" });
      return;
    }
    if (!phoneValid) {
      toast({
        title: "Nomor HP tidak valid",
        description: "Pastikan nomor diawali 08, 8, atau 62 dan minimal 10 digit. Nomor ini harus aktif di WhatsApp bot.",
        variant: "destructive",
      });
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.rpc("admin_create_reseller", {
      _name: name, _phone: normalizedPhone, _password: password, _prefix: prefix, _notes: notes,
    });
    setCreating(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    const res = data as any;
    if (!res?.success) { toast({ title: "Gagal", description: res?.error, variant: "destructive" }); return; }
    toast({
      title: "Reseller dibuat!",
      description: `${name} (/${res.prefix}token) — Nomor terhubung: +${res.phone}`,
    });
    setName(""); setPhone(""); setPassword(""); setPrefix(""); setNotes("");
    load();
  };

  const toggleActive = async (id: string, current: boolean) => {
    const { error } = await supabase.from("resellers").update({ is_active: !current }).eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: !current ? "Diaktifkan" : "Dinonaktifkan" }); load(); }
  };

  const deleteReseller = async (id: string) => {
    const { error } = await supabase.from("resellers").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Reseller dihapus" }); setDeleteConfirm(null); load(); }
  };

  const resetTokens = async (id: string) => {
    const { data, error } = await supabase.rpc("admin_reset_reseller_tokens", { _reseller_id: id });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      const res = data as any;
      toast({ title: "Token direset", description: `${res.deleted || 0} token dihapus` });
      setResetConfirm(null);
      load();
    }
  };

  const updatePw = async () => {
    if (!pwReseller || newPw.length < 6) {
      toast({ title: "Sandi minimal 6 karakter", variant: "destructive" });
      return;
    }
    const { data, error } = await supabase.rpc("admin_update_reseller_password", {
      _reseller_id: pwReseller.reseller_id, _new_password: newPw,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      const res = data as any;
      if (res?.success) {
        toast({ title: "Sandi diperbarui", description: "Sesi reseller direset" });
        setPwReseller(null); setNewPw("");
      } else toast({ title: "Gagal", description: res?.error, variant: "destructive" });
    }
  };

  /**
   * Open edit dialog with current reseller data prefilled.
   */
  const openEdit = (r: any) => {
    setEditReseller(r);
    setEditName(r.name || "");
    setEditPhone(r.phone || "");
    setEditPrefix((r.prefix || "").toString());
    setEditNotes(r.notes || "");
  };

  /**
   * Persist edits (name, WA phone, command prefix, notes) to the reseller row.
   * Admins have ALL access via RLS, so a direct update from client is safe.
   */
  const saveEdit = async () => {
    if (!editReseller) return;
    const trimmedName = editName.trim();
    const normalized = normalizeWaPhone(editPhone);
    const cleanPrefix = editPrefix.replace(/[^A-Za-z]/g, "").slice(0, 3);
    if (!trimmedName) {
      toast({ title: "Nama wajib diisi", variant: "destructive" });
      return;
    }
    if (!isValidWaPhone(normalized)) {
      toast({
        title: "Nomor HP tidak valid",
        description: "Pastikan diawali 08, 8, atau 62 dan minimal 10 digit.",
        variant: "destructive",
      });
      return;
    }
    if (!cleanPrefix) {
      toast({ title: "Prefix command wajib diisi", variant: "destructive" });
      return;
    }
    setSavingEdit(true);
    const { error } = await supabase
      .from("resellers")
      .update({
        name: trimmedName,
        phone: normalized,
        wa_command_prefix: cleanPrefix.toUpperCase(),
        notes: editNotes,
      })
      .eq("id", editReseller.reseller_id);
    setSavingEdit(false);
    if (error) {
      const msg = /duplicate|unique/i.test(error.message)
        ? "Nomor WA atau prefix sudah dipakai reseller lain."
        : error.message;
      toast({ title: "Gagal menyimpan", description: msg, variant: "destructive" });
      return;
    }
    toast({
      title: "Reseller diperbarui",
      description: `Data ${trimmedName} berhasil disimpan.`,
    });
    setEditReseller(null);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Manajemen Reseller</h2>
        </div>
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Create form */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Plus className="h-4 w-4 text-primary" /> Tambah Reseller Baru
        </h3>
        <div className="grid sm:grid-cols-2 gap-2">
          <Input placeholder="Nama reseller" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Nomor WA reseller (08xx / 62xx)" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          <Input placeholder="Sandi (min 6 karakter)" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input
            placeholder="Prefix command (1-3 huruf, contoh: W)"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.replace(/[^A-Za-z]/g, "").slice(0, 3))}
            maxLength={3}
          />
        </div>
        <Input placeholder="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

        {/* WA bot connection preview — admin must verify the number is the one connected to WhatsApp */}
        {phone && (
          <div className={`rounded-lg border px-3 py-2 text-xs flex items-start gap-2 ${
            phoneValid
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/5 text-amber-300"
          }`}>
            {phoneValid ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
            <div className="min-w-0 flex-1">
              {phoneValid ? (
                <>
                  <p className="font-semibold flex items-center gap-1">
                    <MessageCircle className="h-3 w-3" /> Nomor WA bot reseller
                  </p>
                  <p className="font-mono mt-0.5 text-foreground">+{normalizedPhone}</p>
                  <p className="text-[10px] mt-1 opacity-80">
                    Reseller harus chat ke bot WhatsApp dari nomor ini untuk menjalankan command <code className="font-mono">/{prefix.toUpperCase() || "X"}token</code>, <code className="font-mono">/{prefix.toUpperCase() || "X"}reset</code>, <code className="font-mono">/{prefix.toUpperCase() || "X"}stats</code>, dan <code className="font-mono">/{prefix.toUpperCase() || "X"}mytokens</code>.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Nomor belum valid</p>
                  <p className="text-[10px] mt-0.5 opacity-90">
                    Format yang diterima: <span className="font-mono">08xxxxxxxxxx</span>, <span className="font-mono">8xxxxxxxxxx</span>, atau <span className="font-mono">62xxxxxxxxxx</span> (min 10 digit).
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        <div className="text-[11px] text-muted-foreground">
          Command bot WA: <code className="font-mono text-primary">/{prefix.toUpperCase() || "X"}token &lt;show&gt; [hari] [maxdevice]</code>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={createReseller} disabled={creating || (!!phone && !phoneValid)} size="sm">
            {creating ? "Membuat..." : "Buat Reseller"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!phoneValid || testingPhone === normalizedPhone}
            onClick={() => sendTestMessage(phone, name)}
            title="Kirim pesan WA uji ke nomor reseller"
          >
            {testingPhone === normalizedPhone ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Mengirim...</>
            ) : (
              <><Send className="h-4 w-4 mr-1" /> Test Bot</>
            )}
          </Button>
        </div>
      </div>

      {/* Stats table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Daftar Reseller ({stats.length})</h3>
        </div>
        {loading ? (
          <div className="p-4 space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-14 bg-background/40 rounded animate-pulse" />)}
          </div>
        ) : stats.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Belum ada reseller</div>
        ) : (
          <div className="divide-y divide-border">
            {stats.map((r) => (
              <div key={r.reseller_id} className="p-3 sm:p-4 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                    <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">/{r.prefix}token</code>
                    {!r.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">Nonaktif</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate flex items-center gap-1" title="Nomor terhubung dengan bot WhatsApp">
                    <MessageCircle className="h-3 w-3 text-emerald-400 shrink-0" />
                    <span className="font-mono">+{r.phone}</span>
                    <span className="opacity-60">•</span>
                    <span className="text-foreground font-semibold">{r.total_tokens}</span>
                    <span>token dibuat</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Switch checked={r.is_active} onCheckedChange={() => toggleActive(r.reseller_id, r.is_active)} />
                  <Button size="sm" variant="ghost" onClick={() => setDetail(r)} title="Detail">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => sendTestMessage(r.phone, r.name)}
                    disabled={testingPhone === normalizeWaPhone(r.phone)}
                    title="Kirim pesan WA uji ke reseller"
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    {testingPhone === normalizeWaPhone(r.phone)
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Send className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(r)} title="Edit reseller">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPwReseller(r)} title="Edit sandi">
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setResetConfirm(r)} title="Reset semua token" className="text-amber-400 hover:text-amber-300">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteConfirm(r)} title="Hapus reseller" className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detail Reseller: {detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="text-xs space-y-1">
                <p>HP: <span className="font-mono">{detail.phone}</span></p>
                <p>Prefix: <code className="font-mono text-primary">/{detail.prefix}token</code></p>
                <p>Total token: <span className="font-bold">{detail.total_tokens}</span></p>
                {detail.notes && <p className="text-muted-foreground">Catatan: {detail.notes}</p>}
              </div>
              <div className="border-t border-border pt-3">
                <p className="text-xs font-semibold mb-2">Rincian per Show:</p>
                {(!detail.per_show || detail.per_show.length === 0) ? (
                  <p className="text-xs text-muted-foreground">Belum ada token dibuat</p>
                ) : (
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {detail.per_show.map((p: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs bg-background/40 rounded px-2 py-1.5">
                        <span className="truncate flex-1 mr-2">{p.show_title || "(tanpa judul)"}</span>
                        <span className="font-bold text-primary">{p.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit password */}
      <Dialog open={!!pwReseller} onOpenChange={(o) => !o && setPwReseller(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Sandi: {pwReseller?.name}</DialogTitle>
          </DialogHeader>
          <Input placeholder="Sandi baru (min 6 karakter)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPwReseller(null); setNewPw(""); }}>Batal</Button>
            <Button onClick={updatePw}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset tokens confirm */}
      <AlertDialog open={!!resetConfirm} onOpenChange={(o) => !o && setResetConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset semua token reseller?</AlertDialogTitle>
            <AlertDialogDescription>
              Akan menghapus <b>{resetConfirm?.total_tokens || 0}</b> token milik <b>{resetConfirm?.name}</b> beserta semua sesi aktifnya. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetConfirm && resetTokens(resetConfirm.reseller_id)}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete reseller confirm */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus reseller?</AlertDialogTitle>
            <AlertDialogDescription>
              Reseller <b>{deleteConfirm?.name}</b> akan dihapus permanen. Token yang sudah dibuat akan tetap ada (kolom reseller di-set null).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirm && deleteReseller(deleteConfirm.reseller_id)}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ResellerManager;
