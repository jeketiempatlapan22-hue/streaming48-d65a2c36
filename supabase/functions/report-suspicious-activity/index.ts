import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const TELEGRAM_API = 'https://api.telegram.org/bot';

// In-memory rate limiter
const rlMap = new Map<string, { count: number; resetAt: number }>();
function edgeRL(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const e = rlMap.get(key);
  if (rlMap.size > 1000) { for (const [k, v] of rlMap) { if (now > v.resetAt) rlMap.delete(k); } }
  if (!e || now > e.resetAt) { rlMap.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Rate limit: max 10 reports per minute per IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!edgeRL(`report:${ip}`, 10, 60_000)) {
      return new Response(JSON.stringify({ error: 'Rate limited' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { user_id, activity_type, severity, description, metadata } = await req.json();

    if (!user_id || !activity_type) {
      return new Response(JSON.stringify({ error: 'Missing user_id or activity_type' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Persistent DB-level rate limit: 30 reports per hour per IP
    const { data: dbAllowed } = await supabase.rpc("check_rate_limit", {
      _key: "report_ip:" + ip, _max_requests: 30, _window_seconds: 3600,
    });
    if (dbAllowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limited' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log the suspicious activity
    await supabase.from('suspicious_activity_log').insert({
      user_id, activity_type, severity: severity || 'medium', description: description || '', metadata: metadata || {},
    });

    // Get user info for notification
    const { data: profile } = await supabase.from('profiles').select('username').eq('id', user_id).maybeSingle();
    const username = profile?.username || 'Unknown';

    // Count recent suspicious activities for this user
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase.from('suspicious_activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user_id)
      .gte('created_at', oneHourAgo);

    const severityEmoji: Record<string, string> = { low: '🟡', medium: '🟠', high: '🔴', critical: '🚨' };
    const emoji = severityEmoji[severity || 'medium'] || '🟠';

    const message = `${emoji} *AKTIVITAS MENCURIGAKAN*\n\n` +
      `👤 User: ${username}\n` +
      `🆔 ID: \`${user_id.slice(0, 8)}\`\n` +
      `📋 Tipe: ${activity_type}\n` +
      `⚠️ Severity: ${(severity || 'medium').toUpperCase()}\n` +
      `📝 Detail: ${description || '-'}\n` +
      `📊 Total dalam 1 jam: ${count || 1}x\n\n` +
      `Balas \`/banuser ${username}\` untuk blokir user`;

    // Notify Telegram
    const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID');
    if (BOT_TOKEN && ADMIN_CHAT_ID) {
      const escMd = (t: string) => String(t || '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
      const tgMsg = `${emoji} *AKTIVITAS MENCURIGAKAN*\n\n` +
        `👤 User: ${escMd(username)}\n` +
        `🆔 ID: \`${escMd(user_id.slice(0, 8))}\`\n` +
        `📋 Tipe: ${escMd(activity_type)}\n` +
        `⚠️ Severity: ${escMd((severity || 'medium').toUpperCase())}\n` +
        `📝 Detail: ${escMd(description || '-')}\n` +
        `📊 Total dalam 1 jam: ${count || 1}x\n\n` +
        `Balas \`/banuser ${escMd(username)}\` untuk blokir user`;

      await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: tgMsg, parse_mode: 'MarkdownV2' }),
      }).catch(() => {});
    }

    // Notify WhatsApp
    const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
    if (FONNTE_TOKEN) {
      const { data: waSetting } = await supabase.from('site_settings').select('value').eq('key', 'whatsapp_admin_numbers').maybeSingle();
      const numbers = waSetting?.value?.split(',').map((n: string) => n.trim()).filter(Boolean) || [];
      for (const num of numbers) {
        const cleanPhone = num.replace(/^0/, '62').replace(/[^0-9]/g, '');
        if (!cleanPhone) continue;
        await fetch('https://api.fonnte.com/send', {
          method: 'POST', headers: { Authorization: FONNTE_TOKEN },
          body: new URLSearchParams({ target: cleanPhone, message }),
        }).catch(() => {});
      }
    }

    // Auto-ban if critical severity or too many incidents
    if (severity === 'critical' || (count && count >= 10)) {
      await supabase.from('user_bans').upsert({
        user_id, reason: `Auto-ban: ${activity_type} (${count}x dalam 1 jam)`, banned_by: 'system',
        evidence: [{ type: activity_type, description, count, auto: true }], is_active: true,
      }, { onConflict: 'user_id' });

      const banMsg = `🚫 *AUTO-BAN* User ${username} telah diblokir otomatis karena: ${activity_type} (${count}x)`;
      if (BOT_TOKEN && ADMIN_CHAT_ID) {
        const escMd = (t: string) => String(t || '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
        await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: `🚫 *AUTO\\-BAN* User ${escMd(username)} telah diblokir otomatis karena: ${escMd(activity_type)} \\(${count}x\\)`, parse_mode: 'MarkdownV2' }),
        }).catch(() => {});
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('report-suspicious-activity error:', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: corsHeaders,
    });
  }
});
