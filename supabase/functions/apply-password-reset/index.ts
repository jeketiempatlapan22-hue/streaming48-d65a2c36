import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { short_id, new_password } = await req.json();

    if (!short_id || !new_password || new_password.length < 6) {
      return new Response(JSON.stringify({ success: false, error: 'Password minimal 6 karakter' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Find approved reset request
    const { data: request, error: findErr } = await supabase
      .from('password_reset_requests')
      .select('id, user_id, short_id, status, processed_at')
      .eq('short_id', short_id)
      .eq('status', 'approved')
      .maybeSingle();

    if (findErr || !request) {
      return new Response(JSON.stringify({ success: false, error: 'Link reset tidak valid atau sudah digunakan.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if approved within 24 hours
    if (request.processed_at) {
      const approvedAt = new Date(request.processed_at).getTime();
      if (Date.now() - approvedAt > 24 * 60 * 60 * 1000) {
        await supabase.from('password_reset_requests')
          .update({ status: 'expired' })
          .eq('id', request.id);
        return new Response(JSON.stringify({ success: false, error: 'Link reset sudah expired (24 jam).' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
      const err = await updateRes.text();
      console.error('Failed to update password:', err);
      return new Response(JSON.stringify({ success: false, error: 'Gagal mengubah password. Coba lagi.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mark as completed
    await supabase.from('password_reset_requests')
      .update({ status: 'completed', new_password: '[user_set]' })
      .eq('id', request.id);

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
