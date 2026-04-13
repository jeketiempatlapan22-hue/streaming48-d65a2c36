import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!edgeRL(`pakasir:${ip}`, 30, 60_000)) {
    return new Response(JSON.stringify({ error: "Rate limited" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    console.log("Pakasir callback received:", JSON.stringify(body));

    const orderId = body.order_id;
    const status = body.status;

    if (!orderId) {
      return new Response(JSON.stringify({ error: "order_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: dbAllowed } = await supabase.rpc("check_rate_limit", {
      _key: "pakasir_ip:" + ip, _max_requests: 60, _window_seconds: 3600,
    });
    if (dbAllowed === false) {
      return new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subOrder } = await supabase
      .from("subscription_orders")
      .select("id, show_id, phone, email, status, payment_status, user_id")
      .or(`short_id.eq.${orderId},payment_gateway_order_id.eq.${orderId}`)
      .maybeSingle();

    const { data: coinOrder } = await supabase
      .from("coin_orders")
      .select("id, user_id, coin_amount, phone, status, package_id, price, short_id")
      .or(`short_id.eq.${orderId},payment_gateway_order_id.eq.${orderId}`)
      .maybeSingle();

    if (!subOrder && !coinOrder) {
      return new Response(JSON.stringify({ error: "Order not found", order_id: orderId }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isPaid = status === "completed" || status === "paid" || status === "success" || status === "settlement";

    // ===== COIN ORDER =====
    if (coinOrder) {
      // Already confirmed
      if (coinOrder.status === "confirmed") {
        console.log("Coin order already confirmed:", coinOrder.id);
        return new Response(JSON.stringify({ success: true, message: "Already confirmed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!isPaid) {
        await supabase.from("coin_orders").update({ status: status || "failed" }).eq("id", coinOrder.id);
        return new Response(JSON.stringify({ success: true, status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Confirm the coin order - this adds coins to user balance
      const { data: confirmResult, error: confirmErr } = await supabase.rpc("confirm_coin_order", { _order_id: coinOrder.id });
      console.log("Coin confirm result:", JSON.stringify(confirmResult), "error:", confirmErr?.message);

      if (confirmErr || !(confirmResult as any)?.success) {
        console.error("Failed to confirm coin order:", confirmErr?.message || (confirmResult as any)?.error);
        // Still return 200 so Pakasir doesn't retry endlessly
        return new Response(JSON.stringify({ success: false, error: "Confirm failed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const newBalance = (confirmResult as any)?.new_balance || 0;

      // Send Telegram notification to admin
      const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
      const ADMIN_TELEGRAM_CHAT_ID = Deno.env.get("ADMIN_TELEGRAM_CHAT_ID");

      if (TELEGRAM_BOT_TOKEN && ADMIN_TELEGRAM_CHAT_ID) {
        const message = `✅ *Pembelian Koin QRIS Otomatis*\n\n🪙 Jumlah: ${coinOrder.coin_amount} koin\n💰 Harga: ${coinOrder.price || "-"}\n📱 Phone: ${coinOrder.phone || "-"}\n💳 Metode: QRIS Dinamis (Pak Kasir)\n🔖 Order ID: ${coinOrder.short_id || orderId}\n💎 Saldo baru: ${newBalance} koin`;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: ADMIN_TELEGRAM_CHAT_ID, text: message, parse_mode: "Markdown" }),
        }).catch((e) => console.error("Telegram error:", e));
      }

      // Send WhatsApp notification to buyer
      if (coinOrder.phone) {
        await sendBuyerWhatsApp(coinOrder.phone,
          `━━━━━━━━━━━━━━━━━━\n✅ *Pembelian Koin Berhasil!*\n━━━━━━━━━━━━━━━━━━\n\n🪙 Jumlah: *${coinOrder.coin_amount} koin*\n💎 Saldo saat ini: *${newBalance} koin*\n\n🛒 Koin dapat digunakan untuk membeli akses show di halaman utama atau halaman jadwal.\n\n_Terima kasih atas pembelian Anda!_ 🙏\n━━━━━━━━━━━━━━━━━━`
        );
      } else {
        console.log("No phone number for coin order, skipping WhatsApp notification");
      }

      return new Response(JSON.stringify({ success: true, confirmed: true, type: "coin", new_balance: newBalance }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ===== SUBSCRIPTION / SHOW ORDER =====
    if (subOrder) {
      if (subOrder.payment_status === "paid" || subOrder.status === "confirmed") {
        return new Response(JSON.stringify({ success: true, message: "Already processed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!isPaid) {
        await supabase.from("subscription_orders").update({ payment_status: status || "failed" }).eq("id", subOrder.id);
        return new Response(JSON.stringify({ success: true, status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Update payment status
      await supabase.from("subscription_orders").update({ payment_status: "paid" }).eq("id", subOrder.id);

      // Get show details
      const { data: show } = await supabase
        .from("shows")
        .select("title, schedule_date, schedule_time, is_subscription, is_replay, access_password, group_link, membership_duration_days, is_bundle, bundle_replay_passwords, bundle_replay_info")
        .eq("id", subOrder.show_id)
        .maybeSingle();

      let tokenCode: string | null = null;
      let expiresAt: string | null = null;
      let durationDays: number | null = null;

      // Use membership-specific confirmation for subscription shows
      if (show?.is_subscription) {
        const { data: confirmResult, error: confirmErr } = await supabase.rpc("confirm_membership_order", { _order_id: subOrder.id });
        console.log("Membership confirm result:", JSON.stringify(confirmResult), "error:", confirmErr?.message);
        tokenCode = (confirmResult as any)?.token_code || null;
        expiresAt = (confirmResult as any)?.expires_at || null;
        durationDays = (confirmResult as any)?.duration_days || null;
      } else {
        const { data: confirmResult, error: confirmErr } = await supabase.rpc("confirm_regular_order", { _order_id: subOrder.id });
        console.log("Show confirm result:", JSON.stringify(confirmResult), "error:", confirmErr?.message);
        tokenCode = (confirmResult as any)?.token_code || null;
      }

      const siteUrl = "realtime48stream.my.id";

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
          durationDays ? `⏰ Durasi: ${durationDays} hari` : null,
          `📦 Tipe: ${orderType}`,
          `💳 Metode: QRIS Dinamis`,
          `👤 User: ${subOrder.user_id ? "Login" : "Guest"}`,
        ].filter(Boolean).join("\n");

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: ADMIN_TELEGRAM_CHAT_ID, text: message, parse_mode: "Markdown" }),
        }).catch((e) => console.error("Telegram error:", e));
      }

      // Send WhatsApp to buyer
      if (subOrder.phone) {
        let waMessage = `━━━━━━━━━━━━━━━━━━\n✅ *Pembayaran Berhasil!*\n━━━━━━━━━━━━━━━━━━\n\n🎭 Show: *${show?.title || "Show"}*\n`;

        if (show?.is_subscription) {
          waMessage += `📦 Tipe: *Membership*\n`;
          if (durationDays) {
            waMessage += `⏰ Durasi: *${durationDays} hari*\n`;
          }
          if (tokenCode) {
            waMessage += `\n🎫 *Token Membership:* ${tokenCode}\n`;
            waMessage += `📺 *Link Nonton:*\nhttps://${siteUrl}/live?t=${tokenCode}\n`;
          }
          if (show.group_link) {
            waMessage += `\n🔗 *Link Grup:*\n${show.group_link}\n`;
          }
          // Include replay info for membership
          waMessage += `\n🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app\n`;
          if (show.access_password) {
            waMessage += `🔑 Sandi Replay: ${show.access_password}\n`;
          }
        } else if (show?.is_replay) {
          waMessage += `📦 Tipe: *Replay*\n`;
          waMessage += `\n🔗 *Link Replay:*\nhttps://replaytime.lovable.app\n`;
          if (show.access_password) {
            waMessage += `🔐 *Sandi Replay:* ${show.access_password}\n`;
          }
        } else {
          if (tokenCode) {
            waMessage += `\n🎫 *Token Akses:* ${tokenCode}\n`;
            waMessage += `📺 *Link Nonton:*\nhttps://${siteUrl}/live?t=${tokenCode}\n`;
          }
          if (show?.access_password) {
            waMessage += `🔑 *Sandi:* ${show.access_password}\n`;
          }
          if (show?.schedule_date) {
            waMessage += `📅 *Jadwal:* ${show.schedule_date} ${show.schedule_time || ""}\n`;
          }
          waMessage += `\n🔄 *Info Replay:*\n🔗 Link: https://replaytime.lovable.app\n`;
          if (show?.access_password) {
            waMessage += `🔑 Sandi Replay: ${show.access_password}\n`;
          }
        }

        waMessage += `\n⚠️ _Jangan bagikan token/link ini ke orang lain._\n━━━━━━━━━━━━━━━━━━\n_Terima kasih telah membeli!_ 🙏`;
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
