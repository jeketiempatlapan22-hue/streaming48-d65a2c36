import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { identifier, phone } = await req.json();

    if (!identifier || typeof identifier !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'Data tidak valid' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Prevent spam: check for recent pending request
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
        return new Response(JSON.stringify({
          success: false,
          error: 'Permintaan reset sudah dikirim. Tunggu admin menyetujui (max 30 menit).',
        }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Find user by email via admin API (supports email filter)
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
      // Don't reveal whether user exists — always show success
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get username from profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', foundUser.id)
      .maybeSingle();

    // Generate 64-char secure token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const secureToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // Determine phone for WhatsApp delivery
    const whatsappPhone = phone || (identifier.endsWith('@rt48.user') ? identifier.replace('@rt48.user', '') : '');

    // Create password reset request
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
      return new Response(JSON.stringify({ success: false, error: 'Gagal membuat permintaan.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the short_id
    const { data: newReq } = await supabase
      .from('password_reset_requests')
      .select('short_id')
      .eq('user_id', foundUser.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Notify admin via Telegram + WhatsApp
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

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('request-password-reset error:', e);
    return new Response(JSON.stringify({ success: false, error: 'Terjadi kesalahan' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
