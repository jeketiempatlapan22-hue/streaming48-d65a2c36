import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Activity, AlertTriangle, Shield, Clock, TrendingUp } from "lucide-react";

interface Stats {
  activeUsers: number;
  recentLogins: number;
  recentSignups: number;
  suspiciousCount: number;
  bannedCount: number;
  recentEvents: any[];
}

const AdminTrafficMonitor = () => {
  const [stats, setStats] = useState<Stats>({
    activeUsers: 0, recentLogins: 0, recentSignups: 0,
    suspiciousCount: 0, bannedCount: 0, recentEvents: [],
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const now = new Date();
      const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
      const oneHourAgo = new Date(now.getTime() - 60 * 60_000).toISOString();

      const [loginMetrics, signupMetrics, suspiciousRes, bansRes, recentSuspicious] = await Promise.all([
        supabase.from('auth_metrics').select('id', { count: 'exact', head: true })
          .in('event_type', ['login_success', 'login_success_late']).gte('created_at', tenMinAgo),
        supabase.from('auth_metrics').select('id', { count: 'exact', head: true })
          .in('event_type', ['signup_success', 'signup_success_late']).gte('created_at', oneHourAgo),
        supabase.from('suspicious_activity_log').select('id', { count: 'exact', head: true })
          .eq('resolved', false),
        supabase.from('user_bans').select('id', { count: 'exact', head: true })
          .eq('is_active', true),
        supabase.from('suspicious_activity_log').select('*')
          .order('created_at', { ascending: false }).limit(10),
      ]);

      // Active users = recent auth metrics (unique by approximation)
      const activeMetrics = await supabase.from('auth_metrics').select('id', { count: 'exact', head: true })
        .gte('created_at', tenMinAgo);

      setStats({
        activeUsers: activeMetrics.count || 0,
        recentLogins: loginMetrics.count || 0,
        recentSignups: signupMetrics.count || 0,
        suspiciousCount: suspiciousRes.count || 0,
        bannedCount: bansRes.count || 0,
        recentEvents: recentSuspicious.data || [],
      });
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const severityColor: Record<string, string> = {
    low: 'bg-muted text-muted-foreground',
    medium: 'bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]',
    high: 'bg-destructive/20 text-destructive',
    critical: 'bg-destructive text-destructive-foreground',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">📊 Traffic Monitor</h2>
        <Badge variant="outline" className="text-xs">
          <Clock className="mr-1 h-3 w-3" /> Auto-refresh 30s
        </Badge>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <Activity className="mx-auto mb-2 h-6 w-6 text-primary" />
            <p className="text-2xl font-bold text-foreground">{stats.activeUsers}</p>
            <p className="text-xs text-muted-foreground">Request (10m)</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <Users className="mx-auto mb-2 h-6 w-6 text-[hsl(var(--success))]" />
            <p className="text-2xl font-bold text-foreground">{stats.recentLogins}</p>
            <p className="text-xs text-muted-foreground">Login (10m)</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <TrendingUp className="mx-auto mb-2 h-6 w-6 text-primary" />
            <p className="text-2xl font-bold text-foreground">{stats.recentSignups}</p>
            <p className="text-xs text-muted-foreground">Signup (1h)</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <AlertTriangle className={`mx-auto mb-2 h-6 w-6 ${stats.suspiciousCount > 0 ? 'text-[hsl(var(--warning))]' : 'text-muted-foreground'}`} />
            <p className="text-2xl font-bold text-foreground">{stats.suspiciousCount}</p>
            <p className="text-xs text-muted-foreground">Suspicious</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <Shield className={`mx-auto mb-2 h-6 w-6 ${stats.bannedCount > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
            <p className="text-2xl font-bold text-foreground">{stats.bannedCount}</p>
            <p className="text-xs text-muted-foreground">Banned</p>
          </CardContent>
        </Card>
      </div>

      {/* Alert if traffic spike */}
      {stats.activeUsers > 100 && (
        <div className="rounded-xl border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[hsl(var(--warning))]" />
            <p className="font-medium text-foreground">⚡ Lonjakan Traffic Terdeteksi</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.activeUsers} request dalam 10 menit terakhir. Pastikan server dalam kondisi stabil.
          </p>
        </div>
      )}

      {stats.suspiciousCount > 5 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-destructive" />
            <p className="font-medium text-foreground">🚨 Banyak Aktivitas Mencurigakan</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.suspiciousCount} aktivitas mencurigakan belum ditangani. Cek di Security Log.
          </p>
        </div>
      )}

      {/* Recent suspicious events */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">Aktivitas Terbaru</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada aktivitas mencurigakan terbaru.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {stats.recentEvents.map((ev) => (
                <div key={ev.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] ${severityColor[ev.severity] || severityColor.medium}`}>
                        {ev.severity}
                      </Badge>
                      <span className="text-xs font-medium text-foreground truncate">{ev.activity_type}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{ev.description}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                    {new Date(ev.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminTrafficMonitor;
