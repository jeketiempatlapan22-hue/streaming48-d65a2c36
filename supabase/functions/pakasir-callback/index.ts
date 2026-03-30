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

    // Try to find as subscription order first
    const { data: subOrder } = await supabase
      .from("subscription_orders")
      .select("id, show_id, phone, email, status, payment_status, user_id")
      .or(`short_id.eq.${order_id},payment_gateway_order_id.eq.${order_id}`)
      .maybeSingle();

    // Try to find as coin order
    const { data: coinOrder } = await supabase
      .from("coin_orders")
      .select("id, user_id, coin_amount, phone, status, package_id, price")
      .or(`short_id.eq.${order_id}`)
      .maybeSingle();

    if (!subOrder && !coinOrder) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isPaid = status === "paid" || status === "success" || status === "settlement";

    // ===== COIN ORDER =====
    if (coinOrder && coinOrder.status === "pending") {
      if (!isPaid) {
        await supabase.from("coin_orders").update({ status: status || "failed" }).eq("id", coinOrder.id);
        return new Response(JSON.stringify({ success: true, status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Auto-confirm coin order
      const { data: confirmResult } = await supabase.rpc("confirm_coin_order", { _order_id: coinOrder.id });

      // Send Telegram notification
      const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
      const ADMIN_TELEGRAM_CHAT_ID = Deno.env.get("ADMIN_TELEGRAM_CHAT_ID");

      if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_CHAT_ID) {
        const newBalance = (confirmResult as any)?.new_balance || "-";
        const message = [
          `✅ *Pembelian Koin QRIS Otomatis*`,
          ``,
          `🪙 Jumlah: ${coinOrder.coin_amount} koin`,
          `💰 Harga: ${coinOrder.price || "-"}`,
          `📱 Phone: ${coinOrder.phone || "-"}`,
          `💳 Metode: QRIS Dinamis (Pak Kasir)`,
          `🔖 Transaction: ${transaction_id || order_id}`,
          `💎 Saldo baru: ${newBalance} koin`,
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

      // Send WhatsApp to buyer
      const FONNTE_API_TOKEN = Deno.env.get("FONNTE_API_TOKEN");
      if (FONNTE_API_TOKEN && coinOrder.phone) {
        const newBalance = (confirmResult as any)?.new_balance || 0;
        const waMessage = `✅ Pembelian ${coinOrder.coin_amount} koin berhasil!\n\n💎 Saldo koin Anda sekarang: ${newBalance}\n\nTerima kasih! 🙏`;
        await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { Authorization: FONNTE_API_TOKEN },
          body: new URLSearchParams({ target: coinOrder.phone, message: waMessage }),
        }).catch(() => {});
      }

      return new Response(JSON.stringify({ success: true, confirmed: true, type: "coin" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ===== SUBSCRIPTION / SHOW ORDER =====
    if (subOrder) {
      // Already processed
      if (subOrder.payment_status === "paid" || subOrder.status === "confirmed") {
        return new Response(JSON.stringify({ success: true, message: "Already processed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!isPaid) {
        await supabase.from("subscription_orders").update({ payment_status: status || "failed" }).eq("id", subOrder.id);
        return new Response(JSON.stringify({ success: true, status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Update payment status
      await supabase
        .from("subscription_orders")
        .update({ payment_status: "paid" })
        .eq("id", subOrder.id);

      // Auto-confirm: creates NEW unique token via confirm_regular_order RPC
      const { data: confirmResult } = await supabase.rpc("confirm_regular_order", { _order_id: subOrder.id });

      // Get show title for notification
      const { data: show } = await supabase
        .from("shows")
        .select("title, schedule_date, schedule_time, is_subscription")
        .eq("id", subOrder.show_id)
        .maybeSingle();

      // Send Telegram notification
      const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
      const ADMIN_TELEGRAM_CHAT_ID = Deno.env.get("ADMIN_TELEGRAM_CHAT_ID");

      if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_CHAT_ID) {
        const tokenCode = (confirmResult as any)?.token_code || "-";
        const orderType = show?.is_subscription ? "Membership" : "Regular";
        const message = [
          `✅ *Pembayaran QRIS Otomatis Diterima*`,
          ``,
          `🎭 Show: ${show?.title || "-"}`,
          `📱 Phone: ${subOrder.phone || "-"}`,
          `📧 Email: ${subOrder.email || "-"}`,
          `🎫 Token: \`${tokenCode}\``,
          `📦 Tipe: ${orderType}`,
          `💳 Metode: QRIS Dinamis (Pak Kasir)`,
          `🔖 Transaction: ${transaction_id || order_id}`,
          `👤 User: ${subOrder.user_id ? "Login" : "Guest"}`,
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

      // Send WhatsApp to buyer if phone exists
      const FONNTE_API_TOKEN = Deno.env.get("FONNTE_API_TOKEN");
      if (FONNTE_API_TOKEN && subOrder.phone) {
        const tokenCode = (confirmResult as any)?.token_code;
        const siteUrl = "realtime48show.my.id";
        let waMessage = `✅ Pembayaran berhasil!\n\n🎭 ${show?.title || "Show"}\n`;
        if (tokenCode) {
          waMessage += `\n🎫 Token akses: ${tokenCode}\n🔗 Link: https://${siteUrl}/live?t=${tokenCode}`;
        }
        waMessage += `\n\nTerima kasih telah membeli! 🙏`;

        await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { Authorization: FONNTE_API_TOKEN },
          body: new URLSearchParams({ target: subOrder.phone, message: waMessage }),
        }).catch(() => {});
      }

      return new Response(JSON.stringify({ success: true, confirmed: true, type: "show" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, status: "no_action" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
