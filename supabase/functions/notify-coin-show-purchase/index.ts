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

    const body = await req.json();
    const { user_id, show_id, token_code, access_password, show_title, purchase_type, phone: provided_phone } = body;
    if (!user_id || !show_id) {
      return new Response(JSON.stringify({ error: 'Missing user_id or show_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve phone number
    let phone: string | null = provided_phone || null;

    if (!phone) {
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

    // Get show details
    const { data: show } = await supabase
      .from('shows')
      .select('title, access_password, group_link, is_subscription, is_replay, membership_duration_days, schedule_date, schedule_time, is_bundle, bundle_replay_passwords, bundle_replay_info, bundle_duration_days, replay_m3u8_url, replay_youtube_url')
      .eq('id', show_id)
      .maybeSingle();

    let title = show_title || '';
    let replayPassword = access_password || '';
    let groupLink = '';
    let isSubscription = false;
    let isReplay = false;
    let membershipDays = 30;
    let scheduleDate = '';
    let scheduleTime = '';
    let isBundle = false;
    let bundleReplayPasswords: any[] = [];
    let bundleReplayInfo = '';
    let bundleDurationDays = 30;

    if (show) {
      title = title || show.title;
      replayPassword = replayPassword || show.access_password || '';
      groupLink = show.group_link || '';
      isSubscription = show.is_subscription;
      isReplay = show.is_replay;
      membershipDays = show.membership_duration_days || 30;
      scheduleDate = show.schedule_date || '';
      scheduleTime = show.schedule_time || '';
      isBundle = show.is_bundle || false;
      bundleReplayPasswords = Array.isArray(show.bundle_replay_passwords) ? show.bundle_replay_passwords : [];
      bundleReplayInfo = show.bundle_replay_info || '';
      bundleDurationDays = show.bundle_duration_days || 30;
    }

    const siteUrl = 'realtime48stream.my.id';
    const hasReplayMedia = !!(show?.replay_m3u8_url || show?.replay_youtube_url);
    const replayLinkFor = (code?: string | null) =>
      hasReplayMedia && code
        ? `https://${siteUrl}/replay-play?token=${code}`
        : 'https://replaytime.lovable.app';
    let message = '';

    if (purchase_type === 'bundle' || isBundle) {
      // ===== BUNDLE SHOW =====
      message = `━━━━━━━━━━━━━━━━━━\n📦 *Pembelian Bundle Berhasil!*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Paket: *${title}*\n💳 Metode: *Koin*\n⏰ Durasi Token: *${bundleDurationDays} hari*\n`;

      if (token_code) {
        message += `\n🎫 *Token Akses:* ${token_code}\n📺 *Link Nonton:*\nhttps://${siteUrl}/live?t=${token_code}\n`;
      }

      if (scheduleDate) {
        message += `📅 *Jadwal:* ${scheduleDate} ${scheduleTime}\n`;
      }

      // Bundle replay passwords
      if (bundleReplayPasswords.length > 0) {
        message += `\n📦 *Sandi Replay Bundle:*\n`;
        for (const entry of bundleReplayPasswords) {
          if (entry.show_name && entry.password) {
            message += `  🎭 ${entry.show_name}: *${entry.password}*\n`;
          }
        }
      }

      // Bundle replay info
      if (bundleReplayInfo) {
        message += `\n🎬 *Info Replay:*\n🔗 ${bundleReplayInfo}\n`;
      } else {
        message += `\n🎬 *Link Replay:*\n🔗 ${replayLinkFor(token_code)}\n`;
      }

      // Single access password if exists
      if (replayPassword) {
        message += `🔑 Sandi Akses: *${replayPassword}*\n`;
      }

    } else if (purchase_type === 'membership' || isSubscription) {
      message = `━━━━━━━━━━━━━━━━━━\n✅ *Pembelian Membership Berhasil!*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${title}*\n📦 Tipe: *Membership*\n💳 Metode: *Koin*\n⏰ Durasi: *${membershipDays} hari*\n`;
      if (token_code) {
        message += `\n🎫 *Token Membership:* ${token_code}\n📺 *Link Nonton:*\nhttps://${siteUrl}/live?t=${token_code}\n`;
      }
      if (groupLink) {
        message += `\n🔗 *Link Grup:*\n${groupLink}\n`;
      }
      message += `\n🔄 *Info Replay:*\n🔗 Link: ${replayLinkFor(token_code)}\n`;
      if (replayPassword) {
        message += `🔑 Sandi Replay: ${replayPassword}\n`;
      }
    } else if (purchase_type === 'replay' || isReplay) {
      message = `━━━━━━━━━━━━━━━━━━\n✅ *Pembelian Replay Berhasil!*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${title}*\n📦 Tipe: *Replay*\n💳 Metode: *Koin*\n`;
      message += `\n🔗 *Link Replay:*\n${replayLinkFor(token_code)}\n`;
      if (token_code && hasReplayMedia) {
        message += `🎫 *Token Replay:* ${token_code}\n`;
      }
      if (replayPassword) {
        message += `🔐 *Sandi Replay:* ${replayPassword}\n`;
      }
    } else {
      // Regular show — format standar baru
      const schedule = scheduleDate ? `${scheduleDate}${scheduleTime ? " " + scheduleTime : ""}` : "-";
      // Ambil max_devices aktual dari token
      let maxDev = 1;
      if (token_code) {
        const { data: tokRow } = await supabase
          .from('tokens')
          .select('max_devices')
          .eq('code', token_code)
          .maybeSingle();
        maxDev = tokRow?.max_devices ?? 1;
      }
      message = `━━━━━━━━━━━━━━━━━━\n\n✅ *Token Berhasil Dibuat!*\n\n━━━━━━━━━━━━━━━━━━\n\n\n\n🎬 Show: *${title}*\n\n📅 Jadwal: ${schedule}\n\n📱 Max Device: *${maxDev}*\n\n\n\n📺 *Link Nonton LIVE & REPLAY:*\n\nhttps://${siteUrl}/live?t=${token_code}\n\n\n\n🔄 *Info Replay:*\n\n\n\n  *Dapat gunakan link live diatas kembali untuk mengakses replay ketika show telah menjadi replay dengan batas waktu 14 hari*\n\n\n\n> ATAU GUNAKAN :\n\n> 🔗 Link: https://replaytime.lovable.app`;
      if (replayPassword) {
        message += `\n\n> 🔐 Sandi Replay: ${replayPassword}`;
      }
      message += `\n\n━━━━━━━━━━━━━━━━━━`;
      // Kirim langsung & skip footer default
      let cleanPhoneR = phone.replace(/[^0-9]/g, '');
      if (cleanPhoneR.startsWith('0')) cleanPhoneR = '62' + cleanPhoneR.slice(1);
      if (!cleanPhoneR.startsWith('62')) cleanPhoneR = '62' + cleanPhoneR;
      try {
        await fetch('https://api.fonnte.com/send', {
          method: 'POST',
          headers: { 'Authorization': FONNTE_TOKEN },
          body: new URLSearchParams({ target: cleanPhoneR, message }),
        });
      } catch (e) {
        console.error('Failed to send WA:', e);
      }
      return new Response(JSON.stringify({ success: true, phone: cleanPhoneR }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
