import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "cron";
  if (!edgeRL(`auto_live:${ip}`, 3, 60_000)) {
    return new Response(JSON.stringify({ error: "Rate limited" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Persistent DB-level rate limit: 10 toggles per hour per IP
    const { data: dbAllowed } = await supabase.rpc("check_rate_limit", {
      _key: "auto_live_ip:" + ip, _max_requests: 10, _window_seconds: 3600,
    });
    if (dbAllowed === false) {
      return new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get auto-live settings
    const { data: settings } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", ["auto_live_enabled", "auto_live_on_time", "auto_live_off_time"]);

    const settingsMap: Record<string, string> = {};
    (settings || []).forEach((s: any) => { settingsMap[s.key] = s.value; });

    if (settingsMap["auto_live_enabled"] !== "true") {
      return new Response(JSON.stringify({ skipped: true, reason: "Auto-live disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const onTime = settingsMap["auto_live_on_time"] || "";
    const offTime = settingsMap["auto_live_off_time"] || "";

    if (!onTime && !offTime) {
      return new Response(JSON.stringify({ skipped: true, reason: "No times configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get current WIB time (UTC+7)
    const now = new Date();
    const wibOffset = 7 * 60; // minutes
    const wibTime = new Date(now.getTime() + (wibOffset + now.getTimezoneOffset()) * 60000);
    const currentHH = String(wibTime.getHours()).padStart(2, "0");
    const currentMM = String(wibTime.getMinutes()).padStart(2, "0");
    const currentTime = `${currentHH}:${currentMM}`;

    // Get current stream status
    const { data: streamData } = await supabase
      .from("streams")
      .select("id, is_live")
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!streamData) {
      return new Response(JSON.stringify({ skipped: true, reason: "No active stream" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let action: string | null = null;

    // Check if current time matches ON time and stream is off
    if (onTime && currentTime === onTime && !streamData.is_live) {
      await supabase.from("streams").update({ is_live: true }).eq("id", streamData.id);
      action = "turned_on";
    }
    // Check if current time matches OFF time and stream is on
    else if (offTime && currentTime === offTime && streamData.is_live) {
      await supabase.from("streams").update({ is_live: false }).eq("id", streamData.id);
      action = "turned_off";
    }

    return new Response(JSON.stringify({ 
      success: true, 
      action: action || "no_change",
      currentTime,
      onTime,
      offTime,
      wasLive: streamData.is_live,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
