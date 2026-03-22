import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Users, Coins, Plus, Minus, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
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

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const [profilesRes, balancesRes, ordersRes, tokensRes] = await Promise.all([
      supabase.from("profiles").select("id, username, created_at"),
      supabase.from("coin_balances").select("user_id, balance"),
      supabase.from("coin_orders").select("user_id"),
      supabase.from("tokens").select("user_id"),
    ]);

    const balanceMap: Record<string, number> = {};
    (balancesRes.data || []).forEach((b: any) => { balanceMap[b.user_id] = b.balance; });

    const orderCountMap: Record<string, number> = {};
    (ordersRes.data || []).forEach((o: any) => { orderCountMap[o.user_id] = (orderCountMap[o.user_id] || 0) + 1; });

    const tokenCountMap: Record<string, number> = {};
    (tokensRes.data || []).forEach((t: any) => { if (t.user_id) tokenCountMap[t.user_id] = (tokenCountMap[t.user_id] || 0) + 1; });

    const mapped: UserProfile[] = (profilesRes.data || []).map((p: any) => ({
      id: p.id,
      username: p.username,
      created_at: p.created_at,
      balance: balanceMap[p.id] || 0,
      order_count: orderCountMap[p.id] || 0,
      token_count: tokenCountMap[p.id] || 0,
    }));

    setUsers(mapped);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const adjustCoins = async (action: "add" | "deduct") => {
    if (!selectedUser || !coinAmount || parseInt(coinAmount) <= 0) return;
    const amount = parseInt(coinAmount);
    setAdjusting(true);

    if (action === "add") {
      const { error } = await supabase.from("coin_balances").upsert(
        { user_id: selectedUser.id, balance: selectedUser.balance + amount },
        { onConflict: "user_id" }
      );
      if (!error) {
        await supabase.from("coin_transactions").insert({
          user_id: selectedUser.id,
          amount,
          type: "admin_add",
          description: coinReason || `Admin menambah ${amount} koin`,
        });
        toast.success(`+${amount} koin ditambahkan`);
      }
    } else {
      const newBal = Math.max(0, selectedUser.balance - amount);
      const { error } = await supabase.from("coin_balances").update({ balance: newBal }).eq("user_id", selectedUser.id);
      if (!error) {
        await supabase.from("coin_transactions").insert({
          user_id: selectedUser.id,
          amount: -Math.min(amount, selectedUser.balance),
          type: "admin_deduct",
          description: coinReason || `Admin mengurangi ${amount} koin`,
        });
        toast.success(`-${Math.min(amount, selectedUser.balance)} koin dikurangi`);
      }
    }

    setAdjusting(false);
    setSelectedUser(null);
    setCoinAmount("");
    setCoinReason("");
    fetchUsers();
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null;
    return sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  const filtered = users
    .filter(u => {
      const q = search.toLowerCase();
      return !q || (u.username || "").toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortField === "balance") return (a.balance - b.balance) * dir;
      if (sortField === "username") return ((a.username || "").localeCompare(b.username || "")) * dir;
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Manajemen User</h2>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">{users.length}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchUsers} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
      </div>

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
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Memuat...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Tidak ada user ditemukan</td></tr>
              ) : (
                filtered.slice(0, 100).map(u => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{u.username || "—"}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{u.id.slice(0, 8)}...</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-bold ${u.balance > 0 ? "text-[hsl(var(--warning))]" : "text-muted-foreground"}`}>{u.balance}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">{u.order_count}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">{u.token_count}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell text-xs">
                      {new Date(u.created_at).toLocaleDateString("id-ID")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" onClick={() => { setSelectedUser(u); setCoinAmount(""); setCoinReason(""); }}>
                        <Coins className="mr-1 h-3 w-3" /> Kelola
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 100 && <p className="px-4 py-2 text-xs text-muted-foreground text-center border-t border-border">Menampilkan 100 dari {filtered.length} user</p>}
      </div>

      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Kelola Koin</DialogTitle>
            <DialogDescription>{selectedUser?.username || selectedUser?.id.slice(0, 8)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-secondary/50 p-4 text-center">
              <p className="text-xs text-muted-foreground">Saldo Saat Ini</p>
              <p className="text-2xl font-bold text-[hsl(var(--warning))]">{selectedUser?.balance} Koin</p>
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
    </div>
  );
};

export default UserManager;
