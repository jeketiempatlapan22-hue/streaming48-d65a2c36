import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Check if IP is blocked
  const { data: ipBlocked } = await supabase.rpc("is_ip_blocked", { _ip: ip });
  if (ipBlocked === true) return ok({ success: false, error: 'Akses ditolak.' });

  if (!edgeRL(`pw_reset:${ip}`, 5, 60_000)) {
    await supabase.rpc("record_rate_limit_violation", { _ip: ip, _endpoint: "request-password-reset", _violation_key: `pw_reset:${ip}` });
    return ok({ success: false, error: 'Terlalu banyak permintaan. Tunggu sebentar.' });
  }

  try {
    const { identifier, phone } = await req.json();

    if (!identifier || typeof identifier !== 'string') {
      return ok({ success: false, error: 'Data tidak valid' });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Persistent DB-level rate limit: 10 reset requests per hour per IP
    const { data: dbAllowed } = await supabase.rpc("check_rate_limit", {
      _key: "pw_request_ip:" + ip, _max_requests: 10, _window_seconds: 3600,
    });
    if (dbAllowed === false) {
      return ok({ success: false, error: 'Terlalu banyak permintaan. Tunggu sebentar.' });
    }

    // Prevent spam
    const { data: existingPending } = await supabase
      .from('password_reset_requests')
      .select('id, created_at')
      .eq('identifier', identifier)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPending) {
      const createdAt = new Date(existingPending.created_at).getTime();
      if (Date.now() - createdAt < 30 * 60 * 1000) {
        return ok({ success: false, error: 'Permintaan reset sudah dikirim. Tunggu admin menyetujui (max 30 menit).' });
      }
    }

    // Find user by email
    const encodedEmail = encodeURIComponent(identifier.toLowerCase());
    const userLookupRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1&filter=${encodedEmail}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'apikey': SERVICE_KEY,
        },
      }
    );

    let foundUser: any = null;
    if (userLookupRes.ok) {
      const usersData = await userLookupRes.json();
      const allUsers = usersData.users || usersData || [];
      foundUser = allUsers.find((u: any) => u.email?.toLowerCase() === identifier.toLowerCase());
    } else {
      await userLookupRes.text();
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

    // Generate plaintext secure token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const secureToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const whatsappPhone = phone || (identifier.endsWith('@rt48.user') ? identifier.replace('@rt48.user', '') : '');

    const { error: insertErr } = await supabase
      .from('password_reset_requests')
      .insert({
        user_id: foundUser.id,
        identifier,
        phone: whatsappPhone,
        status: 'pending',
        secure_token: secureToken,
      });

    if (insertErr) {
      console.error('Insert error:', insertErr);
      return ok({ success: false, error: 'Gagal membuat permintaan.' });
    }

    const { data: newReq } = await supabase
      .from('password_reset_requests')
      .select('short_id')
      .eq('user_id', foundUser.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Notify admin
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-password-reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          short_id: newReq?.short_id || 'unknown',
          identifier,
          username: profile?.username || (identifier.endsWith('@rt48.user') ? identifier.replace('@rt48.user', '') : identifier.split('@')[0]),
        }),
      });
    } catch (e) {
      console.error('Failed to notify admin:', e);
    }

    return ok({ success: true });
  } catch (e) {
    console.error('request-password-reset error:', e);
    return ok({ success: false, error: 'Terjadi kesalahan' });
  }
});
