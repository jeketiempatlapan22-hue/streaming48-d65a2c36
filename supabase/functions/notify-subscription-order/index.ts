import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Rate limit: 10 notifications per minute per IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!edgeRL(`notify_sub:${ip}`, 10, 60_000)) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

    const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID');
    if (!ADMIN_CHAT_ID) throw new Error('ADMIN_TELEGRAM_CHAT_ID is not configured');

    const { order_id, show_title, phone, email, proof_file_path, proof_bucket, order_type, schedule_date, schedule_time, is_confirmation } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Persistent DB-level rate limit: 30 notifications per hour per IP
    const { data: dbAllowed } = await supabase.rpc("check_rate_limit", {
      _key: "notify_sub_ip:" + ip, _max_requests: 30, _window_seconds: 3600,
    });
    if (dbAllowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limited' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let shortId = order_id;
    if (order_id && !String(order_id).startsWith('manual_')) {
      // Try subscription_orders first
      const { data: subData } = await supabase
        .from('subscription_orders')
        .select('short_id')
        .eq('id', order_id)
        .single();
      if (subData?.short_id) {
        shortId = subData.short_id;
      } else {
        // Fallback: try coin_orders
        const { data: coinData } = await supabase
          .from('coin_orders')
          .select('short_id')
          .eq('id', order_id)
          .single();
        shortId = coinData?.short_id || order_id;
      }
    }
    const typeLabel = order_type === 'replay' ? 'REPLAY' : order_type === 'show' ? 'SHOW' : 'MEMBERSHIP';
    const emoji = is_confirmation ? '✅' : order_type === 'replay' ? '🔄' : order_type === 'show' ? '🎫' : '🎬';
    const actionLabel = is_confirmation ? 'Dikonfirmasi' : 'Baru';

    const scheduleInfo = schedule_date ? `\n📅 Jadwal: ${escapeMarkdown(schedule_date)}${schedule_time ? ' ' + escapeMarkdown(schedule_time) : ''}` : '';
    const caption = `${emoji} *Order ${escapeMarkdown(typeLabel)} ${escapeMarkdown(actionLabel)}\\!*\n\n🎭 Show: ${escapeMarkdown(show_title)}${scheduleInfo}\n📱 Phone: ${escapeMarkdown(phone || '-')}\n📧 Email: ${escapeMarkdown(email || '-')}\n🆔 ID: \`${escapeMarkdown(shortId)}\``;

    const inline_keyboard = is_confirmation ? [] : [[
      { text: '✅ Konfirmasi', callback_data: `approve_sub_${shortId}` },
      { text: '❌ Tolak', callback_data: `reject_sub_${shortId}` },
    ]];

    const waScheduleInfo = schedule_date ? `\n📅 Jadwal: ${schedule_date}${schedule_time ? ' ' + schedule_time : ''}` : '';
    const waText = is_confirmation
      ? `${emoji} *Order ${typeLabel} ${actionLabel}!*\n\n🎭 Show: ${show_title}${waScheduleInfo}\n📱 Phone: ${phone || '-'}\n📧 Email: ${email || '-'}\n🆔 ID: ${shortId}`
      : `${emoji} *Order ${typeLabel} ${actionLabel}!*\n\n🎭 Show: ${show_title}${waScheduleInfo}\n📱 Phone: ${phone || '-'}\n📧 Email: ${email || '-'}\n🆔 ID: ${shortId}\n\n✅ Balas *YA ${shortId}* untuk konfirmasi\n❌ Balas *TIDAK ${shortId}* untuk tolak`;

    const bucket = proof_bucket || 'payment-proofs';
    let photoSent = false;

    // Try sending photo to Telegram
    if (proof_file_path) {
      try {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from(bucket)
          .download(proof_file_path);

        if (!downloadError && fileData) {
          const formData = new FormData();
          formData.append('chat_id', ADMIN_CHAT_ID);
          formData.append('caption', caption);
          formData.append('parse_mode', 'MarkdownV2');
          if (inline_keyboard.length > 0) {
            formData.append('reply_markup', JSON.stringify({ inline_keyboard }));
          }
          formData.append('photo', fileData, 'payment-proof.jpg');

          const photoResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
            method: 'POST',
            body: formData,
          });

          const photoResult = await photoResponse.json();
          photoSent = photoResult.ok === true;
        }
      } catch (e) {
        console.warn('Photo upload to Telegram error:', e instanceof Error ? e.message : e);
      }
    }

    // Fallback: send text only to Telegram
    if (!photoSent) {
      const msgPayload: any = { chat_id: ADMIN_CHAT_ID, text: caption, parse_mode: 'MarkdownV2' };
      if (inline_keyboard.length > 0) {
        msgPayload.reply_markup = { inline_keyboard };
      }
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msgPayload),
      });
    }

    // Send WhatsApp notification to admin
    try {
      const FONNTE_TOKEN = Deno.env.get('FONNTE_API_TOKEN');
      if (FONNTE_TOKEN) {
        const { data: adminWaSetting } = await supabase
          .from('site_settings')
          .select('value')
          .eq('key', 'whatsapp_number')
          .single();

        const adminWa = adminWaSetting?.value;
        if (adminWa) {
          let finalWaText = waText;
          if (proof_file_path) {
            const { data: signedData } = await supabase.storage
              .from(bucket)
              .createSignedUrl(proof_file_path, 86400);
            if (signedData?.signedUrl) {
              finalWaText += `\n\n📎 Bukti: ${signedData.signedUrl}`;
            }
          }

          await fetch('https://api.fonnte.com/send', {
            method: 'POST',
            headers: { 'Authorization': FONNTE_TOKEN },
            body: new URLSearchParams({ target: adminWa, message: finalWaText }),
          });
        }
      }
    } catch (e) {
      console.warn('WhatsApp notification error:', e instanceof Error ? e.message : e);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('notify-subscription-order error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function escapeMarkdown(text: string): string {
  return String(text || '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
