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

    const { show_id, amount, phone, email, order_type } = await req.json();
    if (!show_id || !amount) {
      return new Response(JSON.stringify({ error: "show_id dan amount diperlukan" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // Create order first to get order ID
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

    const orderId = orderData.id;
    const shortId = orderData.short_id || orderId;

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
      await supabase.from("subscription_orders").delete().eq("id", orderId);
      return new Response(JSON.stringify({ error: "Gagal generate QRIS: " + (pakasirData.message || "Unknown error") }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Update order with QR data
    await supabase
      .from("subscription_orders")
      .update({
        qr_string: pakasirData.qr_string,
        payment_gateway_order_id: pakasirData.transaction_id || shortId,
      })
      .eq("id", orderId);

    return new Response(JSON.stringify({
      success: true,
      order_id: orderId,
      short_id: shortId,
      qr_string: pakasirData.qr_string,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
