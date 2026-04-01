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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!edgeRL(`pw_apply:${ip}`, 5, 60_000)) {
    return new Response(JSON.stringify({ success: false, error: 'Terlalu banyak percobaan. Coba lagi nanti.' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { secure_token, new_password } = await req.json();

    if (!secure_token || typeof secure_token !== 'string' || secure_token.length < 32) {
      return new Response(JSON.stringify({ success: false, error: 'Token tidak valid' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!new_password || new_password.length < 6) {
      return new Response(JSON.stringify({ success: false, error: 'Password minimal 6 karakter' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Find approved reset request by secure_token
    const { data: request, error: findErr } = await supabase
      .from('password_reset_requests')
      .select('id, user_id, status, processed_at')
      .eq('secure_token', secure_token)
      .eq('status', 'approved')
      .maybeSingle();

    if (findErr || !request) {
      return new Response(JSON.stringify({ success: false, error: 'Link reset tidak valid atau sudah digunakan.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if approved within 2 hours
    if (request.processed_at) {
      const approvedAt = new Date(request.processed_at).getTime();
      if (Date.now() - approvedAt > 2 * 60 * 60 * 1000) {
        await supabase.from('password_reset_requests')
          .update({ status: 'expired' })
          .eq('id', request.id);
        return new Response(JSON.stringify({ success: false, error: 'Link reset sudah expired (2 jam).' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Mark as completed FIRST (one-time-use enforcement)
    const { error: markErr } = await supabase.from('password_reset_requests')
      .update({ status: 'completed', secure_token: null })
      .eq('id', request.id)
      .eq('status', 'approved');

    if (markErr) {
      return new Response(JSON.stringify({ success: false, error: 'Link sudah digunakan.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update password via raw Admin API (bypasses HIBP check)
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

      // Revert status if password update failed
      await supabase.from('password_reset_requests')
        .update({ status: 'approved', secure_token: secure_token })
        .eq('id', request.id);

      if (isWeak) {
        // Try with temp password then real password
        const tempPass = `Tmp${crypto.randomUUID().slice(0, 12)}!@#`;
        const res1 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${request.user_id}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: tempPass }),
        });
        if (res1.ok) {
          // Now set the real password
          const res2 = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${request.user_id}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: new_password }),
          });
          if (res2.ok) {
            // Mark completed again
            await supabase.from('password_reset_requests')
              .update({ status: 'completed', secure_token: null })
              .eq('id', request.id);
            return new Response(JSON.stringify({ success: true }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Password terlalu lemah. Gunakan minimal 8 karakter dengan kombinasi huruf besar, kecil, angka, dan simbol.' 
        }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: false, error: 'Gagal mengubah password. Coba lagi.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('apply-password-reset error:', e);
    return new Response(JSON.stringify({ success: false, error: 'Terjadi kesalahan' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
