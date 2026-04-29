import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, ShieldAlert, Lock, Unlock } from "lucide-react";

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
  };
}

const TokenAccessTest = () => {
  const [tokenCode, setTokenCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [summary, setSummary] = useState<{ exclusive: number; nonExclusive: number; allowed: number; denied: number } | null>(null);

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

      // Compute summary
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

  const exclusiveResults = results.filter((r) => r.show?.exclude_from_membership);
  const normalResults = results.filter((r) => r.show && !r.show.exclude_from_membership);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold neon-text">🔬 Token Access Test</h1>
          <p className="text-sm text-muted-foreground">
            Cek apakah token (MBR / MRD / BDL / RT48 / token spesifik) bisa memutar setiap show. Show eksklusif harus
            ditolak untuk token universal — show non-eksklusif harus diterima sesuai durasi membership.
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
              {exclusiveResults.map((r, i) => (
                <ResultRow key={`ex-${i}`} r={r} />
              ))}
            </div>
          </section>
        )}

        {normalResults.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Unlock className="h-4 w-4" /> Show Non-Eksklusif ({normalResults.length})
            </h2>
            <div className="space-y-2">
              {normalResults.map((r, i) => (
                <ResultRow key={`nm-${i}`} r={r} />
              ))}
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

const ResultRow = ({ r }: { r: CheckResult }) => {
  const allowed = r.can_access === true;
  return (
    <Card className={`glass p-3 border-l-4 ${allowed ? "border-l-green-500" : "border-l-red-500"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{r.show?.title}</span>
            {r.show?.short_id && (
              <Badge variant="outline" className="text-[10px] font-mono">
                {r.show.short_id}
              </Badge>
            )}
            {r.show?.exclude_from_membership && (
              <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
                🔒 EKSKLUSIF
              </Badge>
            )}
            {r.show?.is_replay && (
              <Badge variant="outline" className="text-[10px]">
                replay
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{r.reason || r.error}</p>
        </div>
        <Badge
          className={`shrink-0 ${
            allowed
              ? "bg-green-500/20 text-green-300 border border-green-500/40"
              : "bg-red-500/20 text-red-300 border border-red-500/40"
          }`}
        >
          {allowed ? (
            <>
              <ShieldCheck className="h-3 w-3 mr-1" /> ALLOW
            </>
          ) : (
            <>
              <ShieldAlert className="h-3 w-3 mr-1" /> DENY
            </>
          )}
        </Badge>
      </div>
    </Card>
  );
};

export default TokenAccessTest;
