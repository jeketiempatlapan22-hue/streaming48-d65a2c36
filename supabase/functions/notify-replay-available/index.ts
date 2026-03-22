import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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
    const message = `🎬 *Replay Tersedia!*\n\nShow *${show_title}* sekarang tersedia untuk ditonton ulang!\n\nKunjungi halaman Replay Show untuk menonton.\n\nTerima kasih! 🎉`;

    for (const phone of phones) {
      const cleanPhone = phone.replace(/^0/, '62').replace(/[^0-9]/g, '');
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
