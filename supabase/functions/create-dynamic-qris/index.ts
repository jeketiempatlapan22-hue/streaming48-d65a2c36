import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const PAKASIR_API_KEY = Deno.env.get("PAKASIR_API_KEY");
    const PAKASIR_MERCHANT_CODE = Deno.env.get("PAKASIR_MERCHANT_CODE");
    if (!PAKASIR_API_KEY || !PAKASIR_MERCHANT_CODE) {
      return new Response(JSON.stringify({ error: "QRIS dinamis belum dikonfigurasi" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { show_id, amount, phone, email, order_type, package_id, coin_amount } = await req.json();

    // order_type: "regular" | "membership" | "coin"
    const isCoinOrder = order_type === "coin";

    if (!isCoinOrder && (!show_id || !amount)) {
      return new Response(JSON.stringify({ error: "show_id dan amount diperlukan" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (isCoinOrder && (!amount || !coin_amount)) {
      return new Response(JSON.stringify({ error: "amount dan coin_amount diperlukan untuk pembelian koin" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get user from auth header if present
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    let orderId: string;
    let shortId: string;
    let orderTable: string;

    if (isCoinOrder) {
      // Coin order — requires user
      if (!userId) {
        return new Response(JSON.stringify({ error: "Login diperlukan untuk pembelian koin" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

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
      // Show order (regular or membership)
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

    // Call Pak Kasir API
    const pakasirRes = await fetch("https://app.pakasir.com/api/transactioncreate/qris", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: PAKASIR_API_KEY,
        merchant_code: PAKASIR_MERCHANT_CODE,
        amount: Math.round(amount),
        order_id: shortId,
      }),
    });

    const pakasirData = await pakasirRes.json();

    if (!pakasirRes.ok || !pakasirData.qr_string) {
      // Delete the pending order if QRIS generation fails
      await supabase.from(orderTable).delete().eq("id", orderId);
      return new Response(JSON.stringify({ error: "Gagal generate QRIS: " + (pakasirData.message || "Unknown error") }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (isCoinOrder) {
      // Store QR data reference — coin_orders doesn't have qr_string column,
      // so we store as a site_settings entry or just return it
      // We'll use a lightweight approach: store in memory via the response
    } else {
      // Update subscription order with QR data
      await supabase
        .from("subscription_orders")
        .update({
          qr_string: pakasirData.qr_string,
          payment_gateway_order_id: pakasirData.transaction_id || shortId,
        })
        .eq("id", orderId);
    }

    return new Response(JSON.stringify({
      success: true,
      order_id: orderId,
      short_id: shortId,
      qr_string: pakasirData.qr_string,
      order_type: isCoinOrder ? "coin" : (order_type || "regular"),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
