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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!edgeRL(`notify_coin_show:${ip}`, 10, 60_000)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
    if (!FONNTE_TOKEN) {
      return new Response(JSON.stringify({ success: false, error: 'FONNTE not configured' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { user_id, show_id, token_code, access_password, show_title, purchase_type, phone: provided_phone } = await req.json();
    if (!user_id || !show_id) {
      return new Response(JSON.stringify({ error: 'Missing user_id or show_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use provided phone first, then look up from order history
    let phone: string | null = provided_phone || null;

    if (!phone) {
      // 1. Check subscription_orders for this user
      const { data: subOrders } = await supabase
        .from('subscription_orders')
        .select('phone')
        .eq('user_id', user_id)
        .neq('phone', '')
        .not('phone', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      if (subOrders?.[0]?.phone) phone = subOrders[0].phone;
    }

    // 2. Check coin_orders
    if (!phone) {
      const { data: coinOrders } = await supabase
        .from('coin_orders')
        .select('phone')
        .eq('user_id', user_id)
        .neq('phone', '')
        .not('phone', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      if (coinOrders?.[0]?.phone) phone = coinOrders[0].phone;
    }

    if (!phone) {
      return new Response(JSON.stringify({ success: false, error: 'No phone found for user' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get show details if not provided
    let title = show_title || '';
    let replayPassword = access_password || '';
    let groupLink = '';
    let isSubscription = false;
    let isReplay = false;
    let durationDays = 30;
    let scheduleDate = '';
    let scheduleTime = '';

    const { data: show } = await supabase
      .from('shows')
      .select('title, access_password, group_link, is_subscription, is_replay, membership_duration_days, schedule_date, schedule_time')
      .eq('id', show_id)
      .maybeSingle();

    if (show) {
      title = title || show.title;
      replayPassword = replayPassword || show.access_password || '';
      groupLink = show.group_link || '';
      isSubscription = show.is_subscription;
      isReplay = show.is_replay;
      durationDays = show.membership_duration_days || 30;
      scheduleDate = show.schedule_date || '';
      scheduleTime = show.schedule_time || '';
    }

    const siteUrl = 'realtime48stream.my.id';
    let message = '';

    if (purchase_type === 'membership' || isSubscription) {
      message = `━━━━━━━━━━━━━━━━━━\n✅ *Pembelian Membership Berhasil!*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${title}*\n📦 Tipe: *Membership*\n💳 Metode: *Koin*\n⏰ Durasi: *${durationDays} hari*\n`;
      if (token_code) {
        message += `\n🎫 *Token Membership:* ${token_code}\n📺 *Link Nonton:*\nhttps://${siteUrl}/live?t=${token_code}\n`;
      }
      if (groupLink) {
        message += `\n🔗 *Link Grup:*\n${groupLink}\n`;
      }
      message += `\n🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app/replay\n`;
      if (replayPassword) {
        message += `🔑 Sandi Replay: ${replayPassword}\n`;
      }
    } else if (purchase_type === 'replay' || isReplay) {
      message = `━━━━━━━━━━━━━━━━━━\n✅ *Pembelian Replay Berhasil!*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${title}*\n📦 Tipe: *Replay*\n💳 Metode: *Koin*\n`;
      message += `\n🔗 *Link Replay:*\nhttps://replaytime.lovable.app/replay\n`;
      if (replayPassword) {
        message += `🔐 *Sandi Replay:* ${replayPassword}\n`;
      }
    } else {
      message = `━━━━━━━━━━━━━━━━━━\n✅ *Pembelian Show Berhasil!*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${title}*\n💳 Metode: *Koin*\n`;
      if (token_code) {
        message += `\n🎫 *Token Akses:* ${token_code}\n📺 *Link Nonton:*\nhttps://${siteUrl}/live?t=${token_code}\n`;
      }
      if (scheduleDate) {
        message += `📅 *Jadwal:* ${scheduleDate} ${scheduleTime}\n`;
      }
      if (replayPassword) {
        message += `\n🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app/replay\n`;
        message += `🔑 Sandi Replay: ${replayPassword}\n`;
      }
    }

    message += `\n⚠️ _Jangan bagikan token/link ini ke orang lain._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih telah membeli!_ 🙏`;

    // Clean phone number
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
    if (!cleanPhone.startsWith('62')) cleanPhone = '62' + cleanPhone;

    try {
      await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: { 'Authorization': FONNTE_TOKEN },
        body: new URLSearchParams({ target: cleanPhone, message }),
      });
    } catch (e) {
      console.error('Failed to send WA:', e);
    }

    return new Response(JSON.stringify({ success: true, phone: cleanPhone }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('notify-coin-show-purchase error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
