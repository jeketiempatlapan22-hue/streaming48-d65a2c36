import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!FONNTE_TOKEN) {
      return new Response(JSON.stringify({ success: false, error: 'FONNTE_API_TOKEN not set' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: shows } = await supabase.from('shows').select('*').eq('is_active', true);
    if (!shows || shows.length === 0) {
      return new Response(JSON.stringify({ success: true, reminded: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    let remindedCount = 0;

    for (const show of shows) {
      if (!show.schedule_date || !show.schedule_time) continue;

      const { data: showStartStr } = await supabase.rpc('parse_show_datetime', {
        _date: show.schedule_date,
        _time: show.schedule_time,
      });

      if (!showStartStr) continue;
      const showStart = new Date(showStartStr);
      const diffMs = showStart.getTime() - now.getTime();
      const diffMin = diffMs / 60000;

      // Send reminder if show starts in 25-35 minutes
      if (diffMin < 25 || diffMin > 35) continue;

      const reminderKey = `reminder_sent_${show.id}`;
      const { data: existing } = await supabase.from('site_settings').select('value').eq('key', reminderKey).maybeSingle();
      if (existing) continue;

      // Get subscriber phones
      const { data: subs } = await supabase
        .from('subscription_orders')
        .select('phone')
        .eq('show_id', show.id)
        .eq('status', 'confirmed');

      // Get coin purchaser phones
      const { data: coinTxs } = await supabase
        .from('coin_transactions')
        .select('user_id')
        .eq('reference_id', show.id)
        .in('type', ['redeem', 'membership']);

      const phoneSet = new Set<string>();

      (subs || []).forEach((s: any) => {
        const p = (s.phone || '').replace(/[^0-9]/g, '');
        if (p.length >= 10) phoneSet.add(p);
      });

      // For coin purchasers, look up their phone from coin_orders
      if (coinTxs && coinTxs.length > 0) {
        const userIds = [...new Set(coinTxs.map((t: any) => t.user_id))];
        const { data: coinOrders } = await supabase
          .from('coin_orders')
          .select('phone')
          .in('user_id', userIds)
          .eq('status', 'confirmed');
        (coinOrders || []).forEach((o: any) => {
          const p = (o.phone || '').replace(/[^0-9]/g, '');
          if (p.length >= 10) phoneSet.add(p);
        });
      }

      if (phoneSet.size === 0) continue;

      const timeStr = show.schedule_time || '';
      const targets = Array.from(phoneSet).join(',');
      const message = `⏰ *REMINDER*\n\n🎬 *${show.title}*\nDimulai dalam 30 menit! (${timeStr})\n\nSiapkan dirimu dan jangan sampai ketinggalan! 🔥`;

      await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: { 'Authorization': FONNTE_TOKEN },
        body: new URLSearchParams({ target: targets, message }),
      });

      await supabase.from('site_settings').upsert(
        { key: reminderKey, value: new Date().toISOString() },
        { onConflict: 'key' }
      );

      console.log(`Reminder sent for "${show.title}" to ${phoneSet.size} users`);
      remindedCount++;
    }

    return new Response(JSON.stringify({ success: true, reminded: remindedCount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Reminder error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
