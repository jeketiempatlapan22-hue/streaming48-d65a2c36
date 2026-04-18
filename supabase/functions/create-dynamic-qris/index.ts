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
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Quick blocked IP check
  const { data: ipBlocked } = await supabase.rpc("is_ip_blocked", { _ip: ip });
  if (ipBlocked === true) {
    return new Response(JSON.stringify({ error: "Akses ditolak." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!edgeRL(`qris:${ip}`, 10, 60_000)) {
    await supabase.rpc("record_rate_limit_violation", { _ip: ip, _endpoint: "create-dynamic-qris", _violation_key: `qris:${ip}` });
    return new Response(JSON.stringify({ error: "Terlalu banyak permintaan. Tunggu sebentar." }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const PAKASIR_API_KEY = Deno.env.get("PAKASIR_API_KEY");
    const PAKASIR_MERCHANT_CODE = Deno.env.get("PAKASIR_MERCHANT_CODE");
    if (!PAKASIR_API_KEY || !PAKASIR_MERCHANT_CODE) {
      return new Response(JSON.stringify({ error: "QRIS dinamis belum dikonfigurasi" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { show_id, amount, phone, email, order_type, package_id, coin_amount } = await req.json();

    const isCoinOrder = order_type === "coin";

    if (!isCoinOrder && (!show_id || !amount)) {
      return new Response(JSON.stringify({ error: "show_id dan amount diperlukan" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (isCoinOrder && (!amount || !coin_amount)) {
      return new Response(JSON.stringify({ error: "amount dan coin_amount diperlukan untuk pembelian koin" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    // Persistent DB-level rate limit: 30 QRIS requests per hour per IP
    const { data: dbAllowed } = await supabase.rpc("check_rate_limit", {
      _key: "qris_ip:" + ip, _max_requests: 30, _window_seconds: 3600,
    });
    if (dbAllowed === false) {
      return new Response(JSON.stringify({ error: "Terlalu banyak permintaan. Tunggu sebentar." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For show orders, check if show has a separate qris_price (to absorb fees)
    let finalAmount = Math.round(amount);
    if (!isCoinOrder && show_id) {
      const { data: showData } = await supabase
        .from("shows")
        .select("qris_price, is_subscription, max_subscribers")
        .eq("id", show_id)
        .maybeSingle();
      if (showData?.qris_price && showData.qris_price > 0) {
        finalAmount = showData.qris_price;
      }
      // Check membership quota before generating QRIS
      if (showData?.is_subscription && showData.max_subscribers > 0) {
        const { data: confirmedCount } = await supabase.rpc("get_order_count", { _show_id: show_id });
        if ((confirmedCount as number) >= showData.max_subscribers) {
          return new Response(JSON.stringify({ error: "Kuota membership sudah penuh. QRIS tidak dapat dibuat." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      try {
        const { data: { user } } = await supabase.auth.getUser(token);
        userId = user?.id || null;
      } catch {
        userId = null;
      }
    }
    // Coin orders REQUIRE auth (must credit balance to a user).
    // Regular & subscription orders accept anon (guest checkout via QRIS).
    if (isCoinOrder && !userId) {
      return new Response(JSON.stringify({ error: "Login diperlukan untuk pembelian koin" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let orderId: string;
    let shortId: string;
    let orderTable: string;

    if (isCoinOrder) {
      // userId already validated above

      const { data: orderData, error: orderErr } = await supabase
        .from("coin_orders")
        .insert({
          user_id: userId,
          package_id: package_id || null,
          coin_amount: coin_amount,
          phone: phone || null,
          price: `Rp ${Math.round(amount).toLocaleString("id-ID")}`,
          status: "pending",
        })
        .select("id, short_id")
        .single();

      if (orderErr) {
        return new Response(JSON.stringify({ error: "Gagal membuat pesanan koin: " + orderErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      orderId = orderData.id;
      shortId = orderData.short_id || orderId;
      orderTable = "coin_orders";
    } else {
      const { data: orderData, error: orderErr } = await supabase
        .from("subscription_orders")
        .insert({
          show_id,
          user_id: userId,
          phone: phone || null,
          email: email || null,
          payment_method: "qris_dynamic",
          status: "pending",
          payment_status: "pending",
        })
        .select("id, short_id")
        .single();

      if (orderErr) {
        return new Response(JSON.stringify({ error: "Gagal membuat pesanan: " + orderErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      orderId = orderData.id;
      shortId = orderData.short_id || orderId;
      orderTable = "subscription_orders";
    }

    // Call Pak Kasir API — uses "project" field (not "merchant_code")
    const pakasirRes = await fetch("https://app.pakasir.com/api/transactioncreate/qris", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: PAKASIR_API_KEY,
        project: PAKASIR_MERCHANT_CODE,
        amount: finalAmount,
        order_id: shortId,
      }),
    });

    const pakasirData = await pakasirRes.json();
    console.log("Pakasir response:", JSON.stringify(pakasirData));

    // Extract QR string from response — Pakasir returns it in payment.payment_number
    const qrString = pakasirData?.payment?.payment_number || pakasirData?.qr_string || pakasirData?.payment?.qr_string || null;
    const transactionId = pakasirData?.payment?.order_id || pakasirData?.transaction_id || shortId;

    if (!pakasirRes.ok || !qrString) {
      await supabase.from(orderTable).delete().eq("id", orderId);
      const errMsg = pakasirData?.message || pakasirData?.error || JSON.stringify(pakasirData);
      return new Response(JSON.stringify({ error: "Gagal generate QRIS: " + errMsg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Generate QR image URL for external use (WhatsApp, etc.)
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrString)}`;

    if (isCoinOrder) {
      await supabase
        .from("coin_orders")
        .update({
          payment_gateway_order_id: transactionId,
        })
        .eq("id", orderId);
    } else {
      await supabase
        .from("subscription_orders")
        .update({
          qr_string: qrString,
          payment_gateway_order_id: transactionId,
        })
        .eq("id", orderId);
    }

    return new Response(JSON.stringify({
      success: true,
      order_id: orderId,
      short_id: shortId,
      qr_string: qrString,
      qr_image_url: qrImageUrl,
      order_type: isCoinOrder ? "coin" : (order_type || "regular"),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("create-dynamic-qris error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
