import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, CheckCircle2, XCircle, Search, Clock, Key, Copy } from "lucide-react";
import { APP_URL } from "@/lib/appConfig";

interface ResetRequest {
  id: string;
  user_id: string;
  identifier: string;
  phone: string;
  short_id: string;
  status: string;
  created_at: string;
  processed_at: string | null;
  secure_token: string | null;
  username?: string;
}

const PasswordResetManager = () => {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("password_reset_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const userIds = [...new Set((data || []).map((r) => r.user_id))];
      let profileMap = new Map<string, string | null>();

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, username")
          .in("id", userIds);
        profileMap = new Map((profiles || []).map((p) => [p.id, p.username]));
      }

      setRequests(
        (data || []).map((r) => ({
          ...r,
          username: profileMap.get(r.user_id) || r.identifier,
        }))
      );
    } catch {
      toast.error("Gagal memuat data reset password");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleAction = async (request: ResetRequest, action: "approve" | "reject") => {
    setProcessing(request.id);
    try {
      const newStatus = action === "approve" ? "approved" : "rejected";
      const { error } = await supabase
        .from("password_reset_requests")
        .update({ status: newStatus, processed_at: new Date().toISOString() })
        .eq("id", request.id);

      if (error) throw error;

      if (action === "approve" && request.phone) {
        const siteUrl = window.location.origin;
        const resetLink = `${siteUrl}/reset-password?token=${request.secure_token || request.short_id}`;
        
        try {
          await supabase.functions.invoke("send-whatsapp", {
            body: {
              target: request.phone,
              message: `🔑 *Reset Password Disetujui*\n\nKlik link berikut untuk membuat password baru:\n${resetLink}\n\n⏰ Link berlaku 2 jam.`,
            },
          });
        } catch {
          toast.warning("Reset disetujui tapi gagal mengirim WhatsApp. Salin link manual.");
        }
      }

      toast.success(
        action === "approve"
          ? `Reset ${request.short_id} disetujui! Link dikirim ke user.`
          : `Reset ${request.short_id} ditolak.`
      );
      fetchRequests();
    } catch {
      toast.error("Gagal memproses permintaan");
    } finally {
      setProcessing(null);
    }
  };

  const copyResetLink = (request: ResetRequest) => {
    const link = `${window.location.origin}/reset-password?token=${request.secure_token || request.short_id}`;
    navigator.clipboard.writeText(link);
    toast.success("Link reset disalin!");
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="border-amber-500/30 text-amber-500"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case "approved":
        return <Badge variant="outline" className="border-primary/30 text-primary"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
      case "completed":
        return <Badge variant="outline" className="border-emerald-500/30 text-emerald-500"><CheckCircle2 className="h-3 w-3 mr-1" />Selesai</Badge>;
      case "rejected":
        return <Badge variant="outline" className="border-destructive/30 text-destructive"><XCircle className="h-3 w-3 mr-1" />Ditolak</Badge>;
      case "expired":
        return <Badge variant="outline" className="text-muted-foreground">Expired</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return requests.filter((r) =>
      !q ||
      r.identifier.toLowerCase().includes(q) ||
      r.short_id.toLowerCase().includes(q) ||
      (r.username || "").toLowerCase().includes(q) ||
      r.phone.includes(q)
    );
  }, [requests, search]);

  const formatDate = (d: string) =>
    new Date(d).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const pendingCount = requests.filter(r => r.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Manajemen Reset Password</h2>
          {pendingCount > 0 && (
            <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-bold text-destructive">{pendingCount} pending</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={fetchRequests} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Cari username, identifier, ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">ID</TableHead>
                <TableHead>User</TableHead>
                <TableHead className="hidden sm:table-cell">Identifier</TableHead>
                <TableHead className="hidden md:table-cell">HP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Waktu</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" /> Memuat...
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Tidak ada permintaan reset password
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.short_id}</TableCell>
                    <TableCell>
                      <p className="font-medium text-sm">{r.username || "-"}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">{r.identifier}</TableCell>
                    <TableCell className="text-xs hidden md:table-cell">{r.phone || "-"}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                      {formatDate(r.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {r.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleAction(r, "approve")}
                              disabled={processing === r.id}
                              className="h-7 text-xs"
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Setujui
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleAction(r, "reject")}
                              disabled={processing === r.id}
                              className="h-7 text-xs"
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Tolak
                            </Button>
                          </>
                        )}
                        {r.status === "approved" && r.secure_token && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyResetLink(r)}
                            className="h-7 text-xs"
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Salin Link
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default PasswordResetManager;
