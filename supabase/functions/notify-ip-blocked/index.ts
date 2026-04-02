import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { ip_address, reason, violation_count } = await req.json();
    if (!ip_address) {
      return new Response(JSON.stringify({ error: "Missing ip_address" }), { status: 400, headers: corsHeaders });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("ADMIN_TELEGRAM_CHAT_ID");

    if (!botToken || !chatId) {
      console.log("Telegram not configured, skipping alert");
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const message = `🚨 <b>IP Auto-Blocked</b>\n\n` +
      `<b>IP:</b> <code>${ip_address}</code>\n` +
      `<b>Alasan:</b> ${reason || "Rate limit exceeded"}\n` +
      `<b>Jumlah Pelanggaran:</b> ${violation_count || "N/A"}\n` +
      `<b>Waktu:</b> ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}\n\n` +
      `Buka admin panel untuk mengonfirmasi atau unblock IP ini.`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
    });

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
