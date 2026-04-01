import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Users, Coins, Plus, Minus, RefreshCw, ChevronDown, ChevronUp, KeyRound, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface UserProfile {
  id: string;
  username: string | null;
  created_at: string;
  balance: number;
  order_count: number;
  token_count: number;
}

const PAGE_SIZE = 50;

const UserManager = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"created_at" | "balance" | "username">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [coinAmount, setCoinAmount] = useState("");
  const [coinReason, setCoinReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [resetUser, setResetUser] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [page, setPage] = useState(0);
  const [fetchError, setFetchError] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setFetchError("");
    try {
      // Fetch all profiles with pagination to bypass 1000-row limit
      let allProfiles: any[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, username, created_at")
          .order("created_at", { ascending: false })
          .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allProfiles = allProfiles.concat(data);
        if (data.length < batchSize) break;
        from += batchSize;
      }

      // Fetch balances and counts in parallel
      const [balancesRes, ordersRes, tokensRes] = await Promise.allSettled([
        supabase.from("coin_balances").select("user_id, balance").limit(5000),
        supabase.from("coin_orders").select("user_id").limit(5000),
        supabase.from("tokens").select("user_id").limit(5000),
      ]);

      const balanceMap: Record<string, number> = {};
      if (balancesRes.status === "fulfilled" && balancesRes.value.data) {
        balancesRes.value.data.forEach((b: any) => { balanceMap[b.user_id] = b.balance; });
      }

      const orderCountMap: Record<string, number> = {};
      if (ordersRes.status === "fulfilled" && ordersRes.value.data) {
        ordersRes.value.data.forEach((o: any) => { orderCountMap[o.user_id] = (orderCountMap[o.user_id] || 0) + 1; });
      }

      const tokenCountMap: Record<string, number> = {};
      if (tokensRes.status === "fulfilled" && tokensRes.value.data) {
        tokensRes.value.data.forEach((t: any) => { if (t.user_id) tokenCountMap[t.user_id] = (tokenCountMap[t.user_id] || 0) + 1; });
      }

      const mapped: UserProfile[] = allProfiles.map((p: any) => ({
        id: p.id,
        username: p.username,
        created_at: p.created_at,
        balance: balanceMap[p.id] || 0,
        order_count: orderCountMap[p.id] || 0,
        token_count: tokenCountMap[p.id] || 0,
      }));

      setUsers(mapped);
    } catch (err: any) {
      const msg = err?.message || "Gagal memuat data user";
      setFetchError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const adjustCoins = async (action: "add" | "deduct") => {
    if (!selectedUser || !coinAmount || parseInt(coinAmount) <= 0) return;
    const amount = parseInt(coinAmount);
    if (isNaN(amount) || amount <= 0) return;
    setAdjusting(true);

    try {
      if (action === "add") {
        const { error } = await supabase.from("coin_balances").upsert(
          { user_id: selectedUser.id, balance: selectedUser.balance + amount },
          { onConflict: "user_id" }
        );
        if (error) throw error;
        await supabase.from("coin_transactions").insert({
          user_id: selectedUser.id,
          amount,
          type: "admin_add",
          description: coinReason || `Admin menambah ${amount} koin`,
        });
        toast.success(`+${amount} koin ditambahkan ke ${selectedUser.username || "user"}`);
      } else {
        if (selectedUser.balance <= 0) {
          toast.error("Saldo user sudah 0");
          setAdjusting(false);
          return;
        }
        const deducted = Math.min(amount, selectedUser.balance);
        const newBal = selectedUser.balance - deducted;
        const { error } = await supabase.from("coin_balances").update({ balance: newBal }).eq("user_id", selectedUser.id);
        if (error) throw error;
        await supabase.from("coin_transactions").insert({
          user_id: selectedUser.id,
          amount: -deducted,
          type: "admin_deduct",
          description: coinReason || `Admin mengurangi ${deducted} koin`,
        });
        toast.success(`-${deducted} koin dikurangi dari ${selectedUser.username || "user"}`);
      }

      setSelectedUser(null);
      setCoinAmount("");
      setCoinReason("");
      fetchUsers();
    } catch (err: any) {
      toast.error(err?.message || "Gagal mengubah koin");
    } finally {
      setAdjusting(false);
    }
  };

  const resetPassword = async () => {
    if (!resetUser || !newPassword || newPassword.length < 8) {
      toast.error("Password minimal 8 karakter dengan kombinasi huruf, angka, simbol");
      return;
    }
    setResetting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-password", {
        body: { target_user_id: resetUser.id, new_password: newPassword },
      });
      if (error) {
        toast.error(error.message || "Gagal menghubungi server");
      } else if (!data?.success) {
        toast.error(data?.error || "Gagal mereset password");
      } else {
        toast.success(`Password ${resetUser.username || resetUser.id.slice(0, 8)} berhasil diubah`);
        setResetUser(null);
        setNewPassword("");
        setShowPassword(false);
      }
    } catch {
      toast.error("Gagal menghubungi server");
    } finally {
      setResetting(false);
    }
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
    setPage(0);
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null;
    return sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users
      .filter(u => !q || (u.username || "").toLowerCase().includes(q) || u.id.toLowerCase().includes(q))
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        if (sortField === "balance") return (a.balance - b.balance) * dir;
        if (sortField === "username") return ((a.username || "").localeCompare(b.username || "")) * dir;
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      });
  }, [users, search, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when search changes
  useEffect(() => { setPage(0); }, [search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Manajemen User</h2>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">{users.length}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchUsers} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {fetchError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {fetchError}
          <Button variant="link" size="sm" className="ml-2 text-destructive" onClick={fetchUsers}>Coba lagi</Button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari username atau ID..." className="pl-10 bg-background" />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  <button onClick={() => toggleSort("username")} className="flex items-center gap-1 hover:text-foreground">Username <SortIcon field="username" /></button>
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  <button onClick={() => toggleSort("balance")} className="flex items-center gap-1 ml-auto hover:text-foreground">Saldo <SortIcon field="balance" /></button>
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">Order</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">Token</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden lg:table-cell">
                  <button onClick={() => toggleSort("created_at")} className="flex items-center gap-1 ml-auto hover:text-foreground">Terdaftar <SortIcon field="created_at" /></button>
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" /> Memuat data user...
                  </div>
                </td></tr>
              ) : paged.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {search ? `Tidak ada user cocok "${search}"` : "Tidak ada user ditemukan"}
                </td></tr>
              ) : (
                paged.map(u => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{u.username || "—"}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{u.id.slice(0, 8)}...</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-bold ${u.balance > 0 ? "text-primary" : "text-muted-foreground"}`}>{u.balance}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">{u.order_count}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">{u.token_count}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell text-xs">
                      {new Date(u.created_at).toLocaleDateString("id-ID")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setSelectedUser(u); setCoinAmount(""); setCoinReason(""); }}>
                          <Coins className="mr-1 h-3 w-3" /> Koin
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setResetUser(u); setNewPassword(""); setShowPassword(false); }}>
                          <KeyRound className="mr-1 h-3 w-3" /> Sandi
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2">
            <p className="text-xs text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} dari {filtered.length} user
            </p>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                ← Prev
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                Next →
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Kelola Koin Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Kelola Koin</DialogTitle>
            <DialogDescription>{selectedUser?.username || selectedUser?.id.slice(0, 8)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-secondary/50 p-4 text-center">
              <p className="text-xs text-muted-foreground">Saldo Saat Ini</p>
              <p className="text-2xl font-bold text-primary">{selectedUser?.balance} Koin</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Jumlah Koin</label>
              <Input type="number" min="1" value={coinAmount} onChange={e => setCoinAmount(e.target.value)} placeholder="Masukkan jumlah" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Alasan (opsional)</label>
              <Input value={coinReason} onChange={e => setCoinReason(e.target.value)} placeholder="Alasan penyesuaian" />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 gap-1" onClick={() => adjustCoins("add")} disabled={adjusting || !coinAmount}>
                <Plus className="h-4 w-4" /> Tambah
              </Button>
              <Button className="flex-1 gap-1" variant="destructive" onClick={() => adjustCoins("deduct")} disabled={adjusting || !coinAmount}>
                <Minus className="h-4 w-4" /> Kurangi
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetUser} onOpenChange={() => { setResetUser(null); setNewPassword(""); setShowPassword(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Ubah password untuk <span className="font-semibold text-foreground">{resetUser?.username || resetUser?.id.slice(0, 8)}</span>. Password lama akan langsung tergantikan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Password Baru</label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min 8 karakter (huruf+angka+simbol)"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              ⚠️ Password harus minimal 8 karakter dengan kombinasi huruf besar/kecil, angka, dan simbol agar tidak ditolak sistem keamanan. Beritahu user password barunya via WhatsApp.
            </p>
            <Button
              className="w-full gap-2"
              onClick={resetPassword}
              disabled={resetting || !newPassword || newPassword.length < 8}
            >
              <KeyRound className="h-4 w-4" /> {resetting ? "Mereset..." : "Reset Password"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManager;
