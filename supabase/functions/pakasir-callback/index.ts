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
    console.log("Pakasir callback received:", JSON.stringify(body));

    // Pak Kasir webhook format: { amount, order_id, project, status, payment_method, completed_at }
    const orderId = body.order_id;
    const status = body.status;
    const transactionId = body.transaction_id || body.completed_at || orderId;

    if (!orderId) {
      return new Response(JSON.stringify({ error: "order_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find order by short_id or payment_gateway_order_id
    const { data: subOrder } = await supabase
      .from("subscription_orders")
      .select("id, show_id, phone, email, status, payment_status, user_id")
      .or(`short_id.eq.${orderId},payment_gateway_order_id.eq.${orderId}`)
      .maybeSingle();

    const { data: coinOrder } = await supabase
      .from("coin_orders")
      .select("id, user_id, coin_amount, phone, status, package_id, price, short_id")
      .eq("short_id", orderId)
      .maybeSingle();

    console.log("Found subOrder:", JSON.stringify(subOrder));
    console.log("Found coinOrder:", JSON.stringify(coinOrder));

    if (!subOrder && !coinOrder) {
      return new Response(JSON.stringify({ error: "Order not found", order_id: orderId }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pak Kasir sends status "completed" on successful payment
    const isPaid = status === "completed" || status === "paid" || status === "success" || status === "settlement";
    console.log(`Payment status: ${status}, isPaid: ${isPaid}`);

    // ===== COIN ORDER =====
    if (coinOrder && coinOrder.status === "pending") {
      if (!isPaid) {
        await supabase.from("coin_orders").update({ status: status || "failed" }).eq("id", coinOrder.id);
        return new Response(JSON.stringify({ success: true, status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Auto-confirm coin order
      const { data: confirmResult, error: confirmErr } = await supabase.rpc("confirm_coin_order", { _order_id: coinOrder.id });
      console.log("Coin confirm result:", JSON.stringify(confirmResult), "error:", confirmErr?.message);

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
          `🔖 Order ID: ${coinOrder.short_id || orderId}`,
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
        }).catch((e) => console.error("Telegram error:", e));
      }

      // Send WhatsApp to buyer
      await sendBuyerWhatsApp(coinOrder.phone, 
        `✅ Pembelian ${coinOrder.coin_amount} koin berhasil!\n\n💎 Saldo koin Anda sekarang: ${(confirmResult as any)?.new_balance || 0}\n\nTerima kasih! 🙏`
      );

      return new Response(JSON.stringify({ success: true, confirmed: true, type: "coin" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ===== SUBSCRIPTION / SHOW ORDER =====
    if (subOrder) {
      // Already processed
      if (subOrder.payment_status === "paid" || subOrder.status === "confirmed") {
        console.log("Order already processed:", subOrder.id);
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
      const { data: confirmResult, error: confirmErr } = await supabase.rpc("confirm_regular_order", { _order_id: subOrder.id });
      console.log("Show confirm result:", JSON.stringify(confirmResult), "error:", confirmErr?.message);

      // Get show details for notification
      const { data: show } = await supabase
        .from("shows")
        .select("title, schedule_date, schedule_time, is_subscription, is_replay, access_password, group_link")
        .eq("id", subOrder.show_id)
        .maybeSingle();

      const tokenCode = (confirmResult as any)?.token_code || null;
      const siteUrl = "realtime48show.my.id";

      // Send Telegram notification
      const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
      const ADMIN_TELEGRAM_CHAT_ID = Deno.env.get("ADMIN_TELEGRAM_CHAT_ID");

      if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_CHAT_ID) {
        const orderType = show?.is_subscription ? "Membership" : (show?.is_replay ? "Replay" : "Regular");
        const message = [
          `✅ *Pembayaran QRIS Otomatis Diterima*`,
          ``,
          `🎭 Show: ${show?.title || "-"}`,
          `📱 Phone: ${subOrder.phone || "-"}`,
          `📧 Email: ${subOrder.email || "-"}`,
          tokenCode ? `🎫 Token: \`${tokenCode}\`` : null,
          `📦 Tipe: ${orderType}`,
          `💳 Metode: QRIS Dinamis`,
          `👤 User: ${subOrder.user_id ? "Login" : "Guest"}`,
        ].filter(Boolean).join("\n");

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: "Markdown",
          }),
        }).catch((e) => console.error("Telegram error:", e));
      }

      // Send comprehensive WhatsApp to buyer
      if (subOrder.phone) {
        let waMessage = `✅ Pembayaran berhasil!\n\n🎭 ${show?.title || "Show"}\n`;
        
        if (show?.is_subscription) {
          // Membership — send group link
          waMessage += `\n📦 Tipe: Membership`;
          if (show.group_link) {
            waMessage += `\n🔗 Link Grup: ${show.group_link}`;
          }
        } else if (show?.is_replay) {
          // Replay — send access password
          waMessage += `\n📦 Tipe: Replay`;
          if (show.access_password) {
            waMessage += `\n🔑 Password Akses: ${show.access_password}`;
          }
          waMessage += `\n🔗 Link Replay: https://replaytime.lovable.app`;
        } else {
          // Regular show — send token + link
          if (tokenCode) {
            waMessage += `\n🎫 Token akses: ${tokenCode}`;
            waMessage += `\n🔗 Link: https://${siteUrl}/live?t=${tokenCode}`;
          }
          if (show?.access_password) {
            waMessage += `\n🔑 Password: ${show.access_password}`;
          }
          if (show?.schedule_date) {
            waMessage += `\n📅 Jadwal: ${show.schedule_date} ${show.schedule_time || ""}`;
          }
        }
        
        waMessage += `\n\nTerima kasih telah membeli! 🙏`;
        await sendBuyerWhatsApp(subOrder.phone, waMessage);
      }

      return new Response(JSON.stringify({ success: true, confirmed: true, type: "show", token_code: tokenCode }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, status: "no_action" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("pakasir-callback error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function sendBuyerWhatsApp(phone: string | null, message: string) {
  if (!phone) return;
  const FONNTE_API_TOKEN = Deno.env.get("FONNTE_API_TOKEN");
  if (!FONNTE_API_TOKEN) return;
  
  // Clean phone number
  let cleanPhone = phone.replace(/[^0-9]/g, "");
  if (cleanPhone.startsWith("0")) cleanPhone = "62" + cleanPhone.slice(1);
  if (!cleanPhone.startsWith("62")) cleanPhone = "62" + cleanPhone;

  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: FONNTE_API_TOKEN },
      body: new URLSearchParams({ target: cleanPhone, message }),
    });
    const resText = await res.text();
    console.log("Fonnte send result:", resText);
  } catch (e) {
    console.error("WhatsApp send error:", e);
  }
}
