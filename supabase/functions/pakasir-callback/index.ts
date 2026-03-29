import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { order_id, status, transaction_id } = body;

    if (!order_id) {
      return new Response(JSON.stringify({ error: "order_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find order by short_id or payment_gateway_order_id
    const { data: order } = await supabase
      .from("subscription_orders")
      .select("id, show_id, phone, email, status, payment_status, user_id")
      .or(`short_id.eq.${order_id},payment_gateway_order_id.eq.${order_id}`)
      .maybeSingle();

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Only process if currently pending
    if (order.payment_status === "paid" || order.status === "confirmed") {
      return new Response(JSON.stringify({ success: true, message: "Already processed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isPaid = status === "paid" || status === "success" || status === "settlement";

    if (isPaid) {
      // Update payment status
      await supabase
        .from("subscription_orders")
        .update({ payment_status: "paid" })
        .eq("id", order.id);

      // Auto-confirm the order via RPC
      const { data: confirmResult } = await supabase.rpc("confirm_regular_order", { _order_id: order.id });

      // Get show title for notification
      const { data: show } = await supabase
        .from("shows")
        .select("title, schedule_date, schedule_time, is_subscription")
        .eq("id", order.show_id)
        .maybeSingle();

      // Send Telegram notification
      const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
      const ADMIN_TELEGRAM_CHAT_ID = Deno.env.get("ADMIN_TELEGRAM_CHAT_ID");

      if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_CHAT_ID) {
        const tokenCode = (confirmResult as any)?.token_code || "-";
        const message = [
          `✅ *Pembayaran QRIS Otomatis Diterima*`,
          ``,
          `🎭 Show: ${show?.title || "-"}`,
          `📱 Phone: ${order.phone || "-"}`,
          `📧 Email: ${order.email || "-"}`,
          `🎫 Token: \`${tokenCode}\``,
          `💳 Metode: QRIS Dinamis (Pak Kasir)`,
          `🔖 Transaction: ${transaction_id || order_id}`,
        ].join("\n");

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: "Markdown",
          }),
        }).catch(() => {});
      }

      // Send WhatsApp to buyer if phone exists and FONNTE token available
      const FONNTE_API_TOKEN = Deno.env.get("FONNTE_API_TOKEN");
      if (FONNTE_API_TOKEN && order.phone) {
        const tokenCode = (confirmResult as any)?.token_code;
        let waMessage = `✅ Pembayaran berhasil!\n\n🎭 ${show?.title || "Show"}\n`;
        if (tokenCode) {
          waMessage += `\n🎫 Token akses: ${tokenCode}\n🔗 Link: ${Deno.env.get("SUPABASE_URL")?.replace(".supabase.co", ".lovable.app")}/live?t=${tokenCode}`;
        }
        waMessage += `\n\nTerima kasih telah membeli! 🙏`;

        await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { Authorization: FONNTE_API_TOKEN },
          body: new URLSearchParams({ target: order.phone, message: waMessage }),
        }).catch(() => {});
      }

      return new Response(JSON.stringify({ success: true, confirmed: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Not paid — update status
    await supabase
      .from("subscription_orders")
      .update({ payment_status: status || "failed" })
      .eq("id", order.id);

    return new Response(JSON.stringify({ success: true, status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
