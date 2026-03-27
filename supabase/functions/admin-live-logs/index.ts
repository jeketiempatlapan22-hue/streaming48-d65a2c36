import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify user by passing token directly
    const token = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: userError } = await authClient.auth.getUser(token);
    if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = user.id;

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return new Response(JSON.stringify({ error: "Not admin" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Gather data
    const [botState, coinOrders, subOrders, secEvents, telegramMsgs] = await Promise.all([
      supabase.from("telegram_bot_state").select("*").eq("id", 1).single(),
      supabase.from("coin_orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("subscription_orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("security_events").select("*").order("created_at", { ascending: false }).limit(30),
      supabase.from("telegram_messages").select("*").order("created_at", { ascending: false }).limit(20),
    ]);

    const now = new Date();
    const lastPoll = botState.data?.updated_at;
    const ageSeconds = lastPoll ? Math.round((now.getTime() - new Date(lastPoll).getTime()) / 1000) : null;

    // Build log entries from various sources
    const logs: any[] = [];

    // Security events as logs
    (secEvents.data || []).forEach((e: any) => {
      logs.push({
        timestamp: e.created_at,
        source: "security",
        level: e.severity === "critical" || e.severity === "high" ? "error" : e.severity === "medium" ? "warn" : "info",
        message: `[${e.event_type}] ${e.description}${e.ip_address ? ` (IP: ${e.ip_address})` : ""}`,
      });
    });

    // Telegram messages as logs
    (telegramMsgs.data || []).forEach((m: any) => {
      logs.push({
        timestamp: m.created_at,
        source: "telegram-poll",
        level: "info",
        message: `Chat ${m.chat_id}: ${m.text || "(no text)"}${m.processed ? "" : " [unprocessed]"}`,
      });
    });

    // Sort by timestamp desc
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const result = {
      telegram: {
        healthy: ageSeconds !== null && ageSeconds < 300,
        lastPoll,
        ageSeconds,
        offset: botState.data?.update_offset ?? 0,
        unprocessedCount: (telegramMsgs.data || []).filter((m: any) => !m.processed).length,
      },
      orders: {
        coinPending: coinOrders.count ?? 0,
        subPending: subOrders.count ?? 0,
      },
      logs: logs.slice(0, 50),
    };

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
