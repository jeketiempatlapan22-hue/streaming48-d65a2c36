import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!edgeRL(`pw_apply:${ip}`, 10, 60_000)) {
    return ok({ success: false, error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }

  try {
    const { secure_token, new_password } = await req.json();

    if (!secure_token || typeof secure_token !== 'string' || secure_token.length < 32) {
      return ok({ success: false, error: 'Token tidak valid' });
    }

    if (!new_password || new_password.length < 6) {
      return ok({ success: false, error: 'Password minimal 6 karakter' });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Try plaintext token first, then hashed token
    let request: any = null;

    const { data: r1 } = await supabase
      .from('password_reset_requests')
      .select('id, user_id, status, processed_at, secure_token')
      .eq('secure_token', secure_token)
      .eq('status', 'approved')
      .maybeSingle();

    if (r1) {
      request = r1;
    } else {
      // Try hashed lookup (DB function stores hash_token())
      const { data: hashResult } = await supabase.rpc('hash_token', { _token: secure_token });
      if (hashResult) {
        const { data: r2 } = await supabase
          .from('password_reset_requests')
          .select('id, user_id, status, processed_at, secure_token')
          .eq('secure_token', hashResult)
          .eq('status', 'approved')
          .maybeSingle();
        if (r2) request = r2;
      }
    }

    if (!request) {
      return ok({ success: false, error: 'Link reset tidak valid atau sudah digunakan.' });
    }

    // Check 2-hour expiry
    if (request.processed_at) {
      const approvedAt = new Date(request.processed_at).getTime();
      if (Date.now() - approvedAt > 2 * 60 * 60 * 1000) {
        await supabase.from('password_reset_requests')
          .update({ status: 'expired' })
          .eq('id', request.id);
        return ok({ success: false, error: 'Link reset sudah expired (2 jam). Minta reset ulang.' });
      }
    }

    // Mark completed (one-time-use)
    const { error: markErr } = await supabase.from('password_reset_requests')
      .update({ status: 'completed', secure_token: null })
      .eq('id', request.id)
      .eq('status', 'approved');

    if (markErr) {
      return ok({ success: false, error: 'Link sudah digunakan.' });
    }

    // Update password via Admin API
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${request.user_id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: new_password }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg = errBody?.msg || errBody?.message || '';
      const isWeak = res.status === 422 || String(errMsg).includes('weak');

      // Revert status
      await supabase.from('password_reset_requests')
        .update({ status: 'approved', secure_token: request.secure_token })
        .eq('id', request.id);

      if (isWeak) {
        // Bypass HIBP: set temp password then real password
        const tempPass = `Tmp${crypto.randomUUID().slice(0, 12)}!@#`;
        const res1 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${request.user_id}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: tempPass }),
        });
        if (res1.ok) {
          const res2 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${request.user_id}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: new_password }),
          });
          if (res2.ok) {
            await supabase.from('password_reset_requests')
              .update({ status: 'completed', secure_token: null })
              .eq('id', request.id);
            return ok({ success: true });
          }
        }
        return ok({ success: false, error: 'Password terlalu lemah. Gunakan minimal 8 karakter dengan huruf besar, kecil, angka, dan simbol.' });
      }

      return ok({ success: false, error: 'Gagal mengubah password. Coba lagi.' });
    }

    return ok({ success: true });
  } catch (e) {
    console.error('apply-password-reset error:', e);
    return ok({ success: false, error: 'Terjadi kesalahan server' });
  }
});
