// Twilio WhatsApp sender — pengganti Fonnte
// Mengirim pesan WhatsApp via Twilio API Gateway (Lovable Connector)
// Hanya admin yang dapat memanggil endpoint ini.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

// In-memory rate limiter
const rlMap = new Map<string, { count: number; resetAt: number }>();
function edgeRL(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rlMap.get(key);
  if (!entry || entry.resetAt < now) {
    rlMap.set(key, { count: 1, resetAt: now + windowMs });
    if (rlMap.size > 500) {
      for (const [k, v] of rlMap) if (v.resetAt < now) rlMap.delete(k);
    }
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

// Normalize ke format E.164 untuk Indonesia (+62...)
function normalizePhoneE164(raw: string): string {
  let n = (raw || "").replace(/\D/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  else if (n.startsWith("8")) n = "62" + n;
  else if (!n.startsWith("62")) n = "62" + n;
  return "+" + n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    if (!edgeRL(`twilio_wa:${ip}`, 10, 60_000)) {
      return new Response(
        JSON.stringify({ success: false, error: "Rate limit exceeded" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
    const TWILIO_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM");

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY belum dikonfigurasi");
    if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY belum dikonfigurasi (sambungkan Twilio connector)");
    if (!TWILIO_FROM) throw new Error("TWILIO_WHATSAPP_FROM belum dikonfigurasi");

    // Auth: validasi JWT user dan cek role admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace("Bearer ", "");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: isAdmin } = await adminClient.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden: admin only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse body
    const body = await req.json().catch(() => ({}));
    const target = String(body.target || "").trim();
    const message = String(body.message || "").trim();
    const mediaUrl = body.mediaUrl ? String(body.mediaUrl) : undefined;

    if (!target || !message) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing target or message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const toE164 = normalizePhoneE164(target);
    const toWa = `whatsapp:${toE164}`;
    const fromWa = TWILIO_FROM.startsWith("whatsapp:") ? TWILIO_FROM : `whatsapp:${TWILIO_FROM}`;

    const params = new URLSearchParams({ To: toWa, From: fromWa, Body: message });
    if (mediaUrl) params.append("MediaUrl", mediaUrl);

    const twilioRes = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const data = await twilioRes.json().catch(() => ({}));
    if (!twilioRes.ok) {
      console.error("Twilio error", twilioRes.status, data);
      return new Response(
        JSON.stringify({
          success: false,
          error: data?.message || `Twilio API error [${twilioRes.status}]`,
          details: data,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, sid: data?.sid, status: data?.status, to: toWa }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("send-whatsapp-twilio error:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
