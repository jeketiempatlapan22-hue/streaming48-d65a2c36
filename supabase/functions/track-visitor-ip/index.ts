import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
    const userAgent = req.headers.get("user-agent") || "";
    if (ip === "unknown") {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* noop */ }
    const path = typeof body?.path === "string" ? body.path.slice(0, 100) : null;
    const userId = typeof body?.user_id === "string" ? body.user_id : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if IP is blocked → return signal so client can react
    const { data: blocked } = await supabase
      .from("blocked_ips")
      .select("id")
      .eq("ip_address", ip)
      .eq("is_active", true)
      .maybeSingle();

    if (blocked) {
      return new Response(JSON.stringify({ ok: false, blocked: true }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upsert visit row
    const { data: existing } = await supabase
      .from("ip_visit_log")
      .select("id, visit_count")
      .eq("ip_address", ip)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("ip_visit_log")
        .update({
          visit_count: (existing.visit_count || 0) + 1,
          last_seen_at: new Date().toISOString(),
          user_agent: userAgent.slice(0, 300),
          user_id: userId,
          path,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("ip_visit_log").insert({
        ip_address: ip,
        user_agent: userAgent.slice(0, 300),
        user_id: userId,
        path,
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
