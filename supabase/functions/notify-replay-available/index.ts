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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Rate limit: 5 per minute per IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!edgeRL(`notify_replay:${ip}`, 5, 60_000)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
    if (!FONNTE_TOKEN) throw new Error('FONNTE_API_TOKEN is not configured');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { show_id, show_title } = await req.json();
    if (!show_id || !show_title) throw new Error('Missing show_id or show_title');

    // Get users who redeemed coins for this show
    const { data: coinTxns } = await supabase
      .from('coin_transactions')
      .select('user_id')
      .eq('reference_id', show_id)
      .in('type', ['redeem', 'replay_redeem']);

    const userIds = [...new Set((coinTxns || []).map((t: any) => t.user_id))];
    const phones = new Set<string>();

    if (userIds.length > 0) {
      const { data: coinOrders } = await supabase
        .from('coin_orders')
        .select('phone')
        .in('user_id', userIds)
        .eq('status', 'confirmed')
        .neq('phone', '');
      (coinOrders || []).forEach((o: any) => { if (o.phone) phones.add(o.phone); });
    }

    // Get subscription order phones
    const { data: subOrders } = await supabase
      .from('subscription_orders')
      .select('phone')
      .eq('show_id', show_id)
      .eq('status', 'confirmed')
      .neq('phone', '');
    (subOrders || []).forEach((o: any) => { if (o.phone) phones.add(o.phone); });

    let sent = 0;
    const message = `━━━━━━━━━━━━━━━━━━\n🎬 *Replay Tersedia!*\n━━━━━━━━━━━━━━━━━━\n\nShow *${show_title}* sekarang tersedia untuk ditonton ulang!\n\n🔗 *Link Replay:*\nhttps://replaytime.lovable.app\n\n_Kunjungi link di atas untuk menonton._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih!_ 🎉`;

    for (const phone of phones) {
      let cleanPhone = phone.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
      if (!cleanPhone.startsWith('62')) cleanPhone = '62' + cleanPhone;
      try {
        await fetch('https://api.fonnte.com/send', {
          method: 'POST',
          headers: { 'Authorization': FONNTE_TOKEN },
          body: new URLSearchParams({ target: cleanPhone, message }),
        });
        sent++;
      } catch (e) {
        console.error('Failed to send WA to', cleanPhone, e);
      }
    }

    await supabase.from('admin_notifications').insert({
      title: '🎬 Mode Replay Diaktifkan',
      message: `Show "${show_title}" diubah ke mode replay. ${sent} notifikasi WA dikirim ke pembeli.`,
      type: 'replay',
    });

    return new Response(JSON.stringify({ success: true, sent, total_phones: phones.size }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('notify-replay-available error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
