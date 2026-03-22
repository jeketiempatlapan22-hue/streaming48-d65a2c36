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

    const { order_id, username, package_name, coin_amount, price, payment_proof_url } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: orderData } = await supabase
      .from('coin_orders')
      .select('short_id')
      .eq('id', order_id)
      .single();

    const shortId = orderData?.short_id || order_id;
    const priceFormatted = escapeMarkdown(Number(price).toLocaleString('id-ID'));
    const caption = `🪙 *Order Koin Baru\\!*\n\n👤 User: ${escapeMarkdown(username)}\n📦 Paket: ${escapeMarkdown(package_name)}\n💰 Jumlah: ${coin_amount} koin\n💵 Harga: Rp ${priceFormatted}\n🆔 ID: \`${escapeMarkdown(shortId)}\`\n\n✅ Balas *YA ${escapeMarkdown(shortId)}* untuk approve\n❌ Balas *TIDAK ${escapeMarkdown(shortId)}* untuk reject`;

    if (payment_proof_url) {
      try {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('payment-proofs')
          .download(payment_proof_url);

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
          if (photoResult.ok) {
            return new Response(JSON.stringify({ success: true }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      } catch (e) {
        console.warn('Photo upload error:', e instanceof Error ? e.message : e);
      }
    }

    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: caption, parse_mode: 'MarkdownV2' }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`Telegram API error [${response.status}]: ${JSON.stringify(data)}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('notify-coin-order error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function escapeMarkdown(text: string): string {
  return String(text || '').replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}