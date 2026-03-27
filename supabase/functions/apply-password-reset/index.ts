import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Hash the incoming token to compare with stored hash
    const { data: hashResult } = await supabase.rpc('hash_token', { _token: secure_token });
    const hashedToken = hashResult as string;

    // Find approved reset request by hashed secure_token
    const { data: request, error: findErr } = await supabase
      .from('password_reset_requests')
      .select('id, user_id, status, processed_at')
      .eq('secure_token', hashedToken)
      .eq('status', 'approved')
      .maybeSingle();

    if (findErr || !request) {
      return new Response(JSON.stringify({ success: false, error: 'Link reset tidak valid atau sudah digunakan.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if approved within 2 hours (shortened from 24h)
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

    // Mark as completed FIRST (one-time-use enforcement) to prevent race conditions
    const { error: markErr } = await supabase.from('password_reset_requests')
      .update({ status: 'completed', secure_token: null })
      .eq('id', request.id)
      .eq('status', 'approved');

    if (markErr) {
      return new Response(JSON.stringify({ success: false, error: 'Link sudah digunakan.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update password via admin API
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${request.user_id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: new_password }),
    });

    if (!updateRes.ok) {
      // Revert status if password update failed
      await supabase.from('password_reset_requests')
        .update({ status: 'approved' })
        .eq('id', request.id);
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
