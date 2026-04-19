import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = "https://realtime48stream.my.id";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizePhone(raw: string | null | undefined) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  else if (!digits.startsWith('62')) digits = `62${digits}`;
  return digits;
}

async function sendWhatsApp(target: string, message: string, token: string) {
  try {
    const response = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: token },
      body: new URLSearchParams({ target, message }),
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    const accepted = response.ok && payload.status !== false && payload.ok !== false && payload.success !== false;
    if (!accepted) return { success: false, error: String(payload.reason || payload.message || payload.error || "WA send failed") };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: String(e?.message || "WA error") };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: ipBlocked } = await supabase.rpc("is_ip_blocked", { _ip: ip });
  if (ipBlocked === true) return ok({ success: false, error: 'Akses ditolak.' });

  if (!edgeRL(`pw_reset:${ip}`, 5, 60_000)) {
    await supabase.rpc("record_rate_limit_violation", { _ip: ip, _endpoint: "request-password-reset", _violation_key: `pw_reset:${ip}` });
    return ok({ success: false, error: 'Terlalu banyak permintaan. Tunggu sebentar.' });
  }

  try {
    const { identifier, phone } = await req.json();
    if (!identifier || typeof identifier !== 'string') return ok({ success: false, error: 'Data tidak valid' });

    const normalizedPhone = normalizePhone(phone);
    const whatsappPhone = normalizedPhone || (identifier.endsWith('@rt48.user') ? normalizePhone(identifier.replace('@rt48.user', '')) : '');
    if (!whatsappPhone) return ok({ success: false, error: 'Masukkan nomor WhatsApp aktif untuk menerima link reset.' });

    const { data: dbAllowed } = await supabase.rpc("check_rate_limit", {
      _key: "pw_request_ip:" + ip, _max_requests: 10, _window_seconds: 3600,
    });
    if (dbAllowed === false) return ok({ success: false, error: 'Terlalu banyak permintaan. Tunggu sebentar.' });

    // Anti-spam: max 1 active request per identifier per 5 min
    const { data: existingPending } = await supabase
      .from('password_reset_requests')
      .select('id, created_at, status, secure_token')
      .eq('identifier', identifier)
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPending) {
      const createdAt = new Date(existingPending.created_at).getTime();
      if (Date.now() - createdAt < 5 * 60 * 1000) {
        return ok({ success: true, info: 'Link reset sudah dikirim baru-baru ini. Cek WhatsApp kamu.' });
      }
    }

    // Find user by email
    const encodedEmail = encodeURIComponent(identifier.toLowerCase());
    const userLookupRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1&filter=${encodedEmail}`,
      { method: 'GET', headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    );

    let foundUser: any = null;
    if (userLookupRes.ok) {
      const usersData = await userLookupRes.json();
      const allUsers = usersData.users || usersData || [];
      foundUser = allUsers.find((u: any) => u.email?.toLowerCase() === identifier.toLowerCase());
    }

    if (!foundUser) {
      // Don't reveal whether user exists
      return ok({ success: true });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', foundUser.id)
      .maybeSingle();

    // Generate secure token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const secureToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // Insert as APPROVED so user gets link immediately
    const nowIso = new Date().toISOString();
    const { error: insertErr } = await supabase
      .from('password_reset_requests')
      .insert({
        user_id: foundUser.id,
        identifier,
        phone: whatsappPhone,
        status: 'approved',
        processed_at: nowIso,
        secure_token: secureToken,
      });

    if (insertErr) {
      console.error('Insert error:', insertErr);
      return ok({ success: false, error: 'Gagal membuat permintaan.' });
    }

    // Send WhatsApp link directly
    if (FONNTE_TOKEN) {
      const resetLink = `${APP_URL}/reset-password?token=${secureToken}`;
      const msg =
        `🔑 *Reset Password RealTime48*\n\n` +
        `Hi ${profile?.username || "user"}, kamu meminta reset password.\n\n` +
        `Klik link berikut untuk membuat password baru:\n${resetLink}\n\n` +
        `⏰ Link berlaku 2 jam.\n\n` +
        `Jika kamu tidak meminta reset ini, abaikan pesan ini.`;
      const waResult = await sendWhatsApp(whatsappPhone, msg, FONNTE_TOKEN);
      if (!waResult.success) {
        console.error("WA send failed:", waResult.error);
        // Notify admin so they can resend manually
        try {
          const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
          await fetch(`${SUPABASE_URL}/functions/v1/notify-password-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
            body: JSON.stringify({
              short_id: 'auto',
              identifier,
              username: profile?.username || identifier,
            }),
          });
        } catch {}
        return ok({ success: false, error: 'Gagal mengirim WhatsApp. Hubungi admin atau coba lagi nanti.' });
      }
    } else {
      return ok({ success: false, error: 'Konfigurasi WhatsApp belum aktif. Hubungi admin.' });
    }

    return ok({ success: true });
  } catch (e) {
    console.error('request-password-reset error:', e);
    return ok({ success: false, error: 'Terjadi kesalahan' });
  }
});
