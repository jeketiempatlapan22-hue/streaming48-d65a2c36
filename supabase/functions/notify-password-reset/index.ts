const TELEGRAM_API = 'https://api.telegram.org/bot';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// In-memory rate limiter
const rlMap = new Map<string, { count: number; resetAt: number }>();
function edgeRL(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (rlMap.size > 500) { for (const [k, v] of rlMap) { if (now > v.resetAt) rlMap.delete(k); } }
  const e = rlMap.get(key);
  if (!e || now > e.resetAt) { rlMap.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!edgeRL(`notify_pw:${ip}`, 10, 60_000)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const _supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Persistent DB-level rate limit: 30 notifications per hour per IP
    const { data: dbAllowed } = await _supabase.rpc("check_rate_limit", {
      _key: "notify_pw_ip:" + ip, _max_requests: 30, _window_seconds: 3600,
    });
    if (dbAllowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limited' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { short_id, identifier, username } = await req.json();

    const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID');
    if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
      return new Response(JSON.stringify({ error: 'Bot not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const escMd = (t: string) => String(t || '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');

    const message =
      `🔑 *PERMINTAAN RESET PASSWORD*\n\n` +
      `👤 User: ${escMd(username || 'Unknown')}\n` +
      `📱 Identifier: \`${escMd(identifier)}\`\n` +
      `🆔 ID: \`${escMd(short_id)}\`\n\n` +
      `Balas \`RESET ${escMd(short_id)}\` untuk setujui\n` +
      `Balas \`TOLAK\\_RESET ${escMd(short_id)}\` untuk menolak`;

    const res = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: message, parse_mode: 'MarkdownV2' }),
    });

    const data = await res.json();
    if (!data.ok) {
      await fetch(`${TELEGRAM_API}${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ADMIN_CHAT_ID,
          text: `🔑 PERMINTAAN RESET PASSWORD\n\nUser: ${username || 'Unknown'}\nIdentifier: ${identifier}\nID: ${short_id}\n\nBalas "RESET ${short_id}" untuk setujui`,
        }),
      });
    }

    // Also notify WhatsApp admins
    const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
    if (FONNTE_TOKEN) {
      const supabase = _supabase;
      const { data: waSetting } = await supabase.from('site_settings').select('value').eq('key', 'whatsapp_admin_numbers').maybeSingle();
      const { data: primarySetting } = await supabase.from('site_settings').select('value').eq('key', 'whatsapp_number').maybeSingle();
      const numbers: string[] = [];
      if (waSetting?.value) numbers.push(...waSetting.value.split(',').map((n: string) => n.trim()).filter(Boolean));
      if (primarySetting?.value) numbers.push(primarySetting.value.trim());
      
      const waMsg = `🔑 *PERMINTAAN RESET PASSWORD*\n\n👤 User: ${username || 'Unknown'}\n📱 Identifier: ${identifier}\n🆔 ID: ${short_id}\n\nBalas: RESET ${short_id}\nTolak: TOLAK_RESET ${short_id}`;
      
      for (const num of [...new Set(numbers)]) {
        const cleanPhone = num.replace(/^0/, '62').replace(/[^0-9]/g, '');
        if (!cleanPhone) continue;
        await fetch('https://api.fonnte.com/send', {
          method: 'POST', headers: { Authorization: FONNTE_TOKEN },
          body: new URLSearchParams({ target: cleanPhone, message: waMsg }),
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('notify-password-reset error:', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
