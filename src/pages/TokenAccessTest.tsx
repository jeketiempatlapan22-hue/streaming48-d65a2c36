import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, ShieldCheck, ShieldAlert, Lock, Unlock, Radio, Coins, MessageCircle, Copy,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface CheckResult {
  valid: boolean;
  can_access?: boolean;
  reason?: string;
  error?: string;
  token?: {
    code: string;
    status: string;
    expires_at: string | null;
    show_id: string | null;
    is_universal_prefix: boolean;
    prefix: string;
  };
  show?: {
    id: string;
    title: string;
    short_id: string | null;
    exclude_from_membership: boolean;
    is_active: boolean;
    is_replay: boolean;
    coin_price?: number;
    replay_coin_price?: number;
  };
}

/** Mirrors the button-rendering logic in src/components/viewer/ShowCard.tsx */
function predictedButtons(r: CheckResult): { label: string; tone: "live" | "coin" | "qris" | "copy" }[] {
  if (!r.show) return [];
  if (r.can_access) {
    if (r.show.is_replay) return [{ label: "Salin Sandi / Tonton Replay", tone: "copy" }];
    return [{ label: "🔴 Tonton Live", tone: "live" }, { label: "Salin Link", tone: "copy" }];
  }
  // denied → purchase buttons
  const buttons: { label: string; tone: "live" | "coin" | "qris" | "copy" }[] = [];
  const coin = r.show.is_replay ? r.show.replay_coin_price : r.show.coin_price;
  const isExclusive = r.show.exclude_from_membership;
  if (coin && coin > 0) {
    buttons.push({
      label: isExclusive ? `Beli Eksklusif ${coin} Koin` : `Beli ${coin} Koin`,
      tone: "coin",
    });
  }
  buttons.push({
    label: isExclusive ? "Beli Eksklusif via QRIS" : (coin && coin > 0 ? "Beli via QRIS" : "Beli Tiket"),
    tone: "qris",
  });
  return buttons;
}

const TokenAccessTest = () => {
  const [tokenCode, setTokenCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [summary, setSummary] = useState<{ exclusive: number; nonExclusive: number; allowed: number; denied: number } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) { if (mounted) { setIsAdmin(false); setAuthChecking(false); } return; }
      const { data } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" } as never);
      if (mounted) { setIsAdmin(Boolean(data)); setAuthChecking(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const runTest = async () => {
    if (!tokenCode.trim()) return;
    setLoading(true);
    setResults([]);
    setSummary(null);

    try {
      const { data, error } = await supabase.rpc("test_token_all_shows" as never, {
        _token_code: tokenCode.trim(),
      } as never);
      if (error) throw error;

      const list = ((data as { results: CheckResult[] })?.results) ?? [];
      setResults(list);

      const s = { exclusive: 0, nonExclusive: 0, allowed: 0, denied: 0 };
      list.forEach((r) => {
        if (!r.show) return;
        if (r.show.exclude_from_membership) s.exclusive++;
        else s.nonExclusive++;
        if (r.can_access) s.allowed++;
        else s.denied++;
      });
      setSummary(s);
    } catch (e) {
      console.error("Test error:", e);
      setResults([{ valid: false, error: (e as Error).message }]);
    } finally {
      setLoading(false);
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-3 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/admin" replace />;

  const exclusiveResults = results.filter((r) => r.show?.exclude_from_membership);
  const normalResults = results.filter((r) => r.show && !r.show.exclude_from_membership);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold neon-text">🔬 Token Access Test (Admin)</h1>
          <p className="text-sm text-muted-foreground">
            Cek apakah token (MBR / MRD / BDL / RT48 / token spesifik) bisa memutar setiap show, dan lihat
            preview tombol yang akan muncul di kartu show landing page.
          </p>
        </div>

        <Card className="glass p-4 space-y-3">
          <label className="text-sm font-medium">Token Code</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={tokenCode}
              onChange={(e) => setTokenCode(e.target.value)}
              placeholder="MBR-XXXXXXXX / BDL-XXXX / RT48-XXXX / token-spesifik"
              className="font-mono"
              onKeyDown={(e) => e.key === "Enter" && runTest()}
            />
            <Button onClick={runTest} disabled={loading || !tokenCode.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Jalankan Test
            </Button>
          </div>
        </Card>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="glass p-3 text-center">
              <div className="text-xs text-muted-foreground">Show Eksklusif</div>
              <div className="text-2xl font-bold">{summary.exclusive}</div>
            </Card>
            <Card className="glass p-3 text-center">
              <div className="text-xs text-muted-foreground">Show Non-Eksklusif</div>
              <div className="text-2xl font-bold">{summary.nonExclusive}</div>
            </Card>
            <Card className="glass p-3 text-center">
              <div className="text-xs text-muted-foreground">✅ Diizinkan</div>
              <div className="text-2xl font-bold text-green-400">{summary.allowed}</div>
            </Card>
            <Card className="glass p-3 text-center">
              <div className="text-xs text-muted-foreground">❌ Ditolak</div>
              <div className="text-2xl font-bold text-red-400">{summary.denied}</div>
            </Card>
          </div>
        )}

        {exclusiveResults.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Lock className="h-4 w-4" /> Show Eksklusif ({exclusiveResults.length})
            </h2>
            <div className="space-y-2">
              {exclusiveResults.map((r, i) => <ResultRow key={`ex-${i}`} r={r} />)}
            </div>
          </section>
        )}

        {normalResults.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Unlock className="h-4 w-4" /> Show Non-Eksklusif ({normalResults.length})
            </h2>
            <div className="space-y-2">
              {normalResults.map((r, i) => <ResultRow key={`nm-${i}`} r={r} />)}
            </div>
          </section>
        )}

        {results.length > 0 && results[0].error && (
          <Card className="glass p-4 border-red-500/50">
            <p className="text-red-400">Error: {results[0].error}</p>
          </Card>
        )}
      </div>
    </div>
  );
};

const toneClass: Record<string, string> = {
  live: "bg-green-500/20 text-green-200 border-green-500/40",
  coin: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  qris: "bg-primary/20 text-primary border-primary/40",
  copy: "bg-muted text-muted-foreground border-border",
};
const toneIcon: Record<string, JSX.Element> = {
  live: <Radio className="h-3 w-3 mr-1" />,
  coin: <Coins className="h-3 w-3 mr-1" />,
  qris: <MessageCircle className="h-3 w-3 mr-1" />,
  copy: <Copy className="h-3 w-3 mr-1" />,
};

const ResultRow = ({ r }: { r: CheckResult }) => {
  const allowed = r.can_access === true;
  const buttons = predictedButtons(r);
  return (
    <Card className={`glass p-3 border-l-4 ${allowed ? "border-l-green-500" : "border-l-red-500"} space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{r.show?.title}</span>
            {r.show?.short_id && <Badge variant="outline" className="text-[10px] font-mono">{r.show.short_id}</Badge>}
            {r.show?.exclude_from_membership && (
              <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">🔒 EKSKLUSIF</Badge>
            )}
            {r.show?.is_replay && <Badge variant="outline" className="text-[10px]">replay</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{r.reason || r.error}</p>
        </div>
        <Badge className={`shrink-0 ${allowed ? "bg-green-500/20 text-green-300 border border-green-500/40" : "bg-red-500/20 text-red-300 border border-red-500/40"}`}>
          {allowed ? <><ShieldCheck className="h-3 w-3 mr-1" /> ALLOW</> : <><ShieldAlert className="h-3 w-3 mr-1" /> DENY</>}
        </Badge>
      </div>
      {buttons.length > 0 && (
        <div className="border-t border-border/50 pt-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Tombol yang muncul di kartu show
          </p>
          <div className="flex flex-wrap gap-1.5">
            {buttons.map((b, i) => (
              <span key={i} className={`inline-flex items-center text-[11px] font-semibold px-2 py-1 rounded border ${toneClass[b.tone]}`}>
                {toneIcon[b.tone]}{b.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

export default TokenAccessTest;
