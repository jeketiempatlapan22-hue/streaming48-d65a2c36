import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

    const ADMIN_CHAT_ID = Deno.env.get('ADMIN_TELEGRAM_CHAT_ID');
    if (!ADMIN_CHAT_ID) throw new Error('ADMIN_TELEGRAM_CHAT_ID is not configured');

    const { order_id, show_title, phone, email, proof_file_path, proof_bucket, order_type } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const table = order_type === 'replay' ? 'subscription_orders' : 'subscription_orders';
    const { data: orderData } = await supabase
      .from('subscription_orders')
      .select('short_id')
      .eq('id', order_id)
      .single();

    const shortId = orderData?.short_id || order_id;
    const typeLabel = order_type === 'replay' ? 'REPLAY' : 'MEMBERSHIP';
    const emoji = order_type === 'replay' ? '🔄' : '🎬';

    const caption = `${emoji} *Order ${escapeMarkdown(typeLabel)} Baru\\!*\n\n🎭 Show: ${escapeMarkdown(show_title)}\n📱 Phone: ${escapeMarkdown(phone || '-')}\n📧 Email: ${escapeMarkdown(email || '-')}\n🆔 ID: \`${escapeMarkdown(shortId)}\`\n\n✅ Balas *YA ${escapeMarkdown(shortId)}* untuk konfirmasi\n❌ Balas *TIDAK ${escapeMarkdown(shortId)}* untuk tolak`;

    const waText = `${emoji} *Order ${typeLabel} Baru!*\n\n🎭 Show: ${show_title}\n📱 Phone: ${phone || '-'}\n📧 Email: ${email || '-'}\n🆔 ID: ${shortId}\n\n✅ Balas *YA ${shortId}* untuk konfirmasi\n❌ Balas *TIDAK ${shortId}* untuk tolak`;

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
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: caption, parse_mode: 'MarkdownV2' }),
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
