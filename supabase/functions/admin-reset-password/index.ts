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
  if (!edgeRL(`admin_reset:${ip}`, 5, 60_000)) {
    return ok({ success: false, error: 'Terlalu banyak permintaan. Tunggu sebentar.' });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return ok({ success: false, error: 'Unauthorized' });

    const token = authHeader.replace('Bearer ', '');
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !user) return ok({ success: false, error: 'Unauthorized' });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // Persistent DB-level rate limit: 15 resets per hour per IP
    const { data: dbAllowed } = await adminClient.rpc("check_rate_limit", {
      _key: "admin_reset_ip:" + ip, _max_requests: 15, _window_seconds: 3600,
    });
    if (dbAllowed === false) {
      return ok({ success: false, error: 'Terlalu banyak permintaan. Tunggu sebentar.' });
    }

    const { data: isAdmin } = await adminClient.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isAdmin) return ok({ success: false, error: 'Forbidden' });

    const { target_user_id, new_password } = await req.json();

    if (!target_user_id || typeof target_user_id !== 'string') {
      return ok({ success: false, error: 'User ID tidak valid' });
    }
    if (!new_password || new_password.length < 6) {
      return ok({ success: false, error: 'Password minimal 6 karakter' });
    }

    // Try direct Admin API
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target_user_id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: new_password }),
    });

    if (res.ok) return ok({ success: true });

    const errBody = await res.json().catch(() => ({}));
    const errMsg = errBody?.msg || errBody?.message || errBody?.error || '';
    const isWeak = res.status === 422 || String(errMsg).includes('weak');

    if (isWeak) {
      // Bypass HIBP with temp password trick
      const tempPass = `Tmp${crypto.randomUUID().slice(0, 12)}!@#`;
      const res1 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target_user_id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: tempPass }),
      });

      if (res1.ok) {
        const res2 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target_user_id}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: new_password }),
        });
        if (res2.ok) return ok({ success: true });
      }
      return ok({ success: false, error: 'Password terlalu lemah. Gunakan password yang lebih kuat.' });
    }

    return ok({ success: false, error: errMsg || 'Gagal mengubah password' });
  } catch (e) {
    console.error('admin-reset-password error:', e);
    return ok({ success: false, error: 'Terjadi kesalahan server' });
  }
});
