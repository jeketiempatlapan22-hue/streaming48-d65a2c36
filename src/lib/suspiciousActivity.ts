import { supabase } from "@/integrations/supabase/client";

// Track suspicious activities client-side and report to backend
const activityCounts = new Map<string, { count: number; firstSeen: number }>();

type SuspiciousActivityType =
  | 'rapid_login_attempts'
  | 'devtools_detected'
  | 'multiple_tab_abuse'
  | 'rapid_api_calls'
  | 'token_manipulation'
  | 'unauthorized_access'
  | 'payment_fraud_attempt'
  | 'session_hijack_attempt';

interface ReportOptions {
  userId: string;
  activityType: SuspiciousActivityType;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
  metadata?: Record<string, any>;
}

export async function reportSuspiciousActivity(opts: ReportOptions) {
  const key = `${opts.userId}-${opts.activityType}`;
  const now = Date.now();
  const entry = activityCounts.get(key);

  // Throttle: don't report more than 3 times per 5 minutes for same type
  if (entry && now - entry.firstSeen < 300_000 && entry.count >= 3) return;

  if (entry && now - entry.firstSeen < 300_000) {
    entry.count++;
  } else {
    activityCounts.set(key, { count: 1, firstSeen: now });
  }

  try {
    await supabase.functions.invoke('report-suspicious-activity', {
      body: {
        user_id: opts.userId,
        activity_type: opts.activityType,
        severity: opts.severity || 'medium',
        description: opts.description || '',
        metadata: opts.metadata || {},
      },
    });
  } catch {
    // Silent fail — don't break UX
  }
}

/** Check if user is banned, returns ban info */
export async function checkBanStatus(userId: string): Promise<{ banned: boolean; reason?: string }> {
  try {
    const { data, error } = await (supabase.rpc as any)('get_ban_info', { _user_id: userId });
    if (error || !data) return { banned: false };
    const info = data as any;
    return { banned: !!info.banned, reason: info.reason };
  } catch {
    return { banned: false };
  }
}
