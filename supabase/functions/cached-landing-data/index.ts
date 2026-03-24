import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// In-memory cache (edge function instances are reused for ~30s-5min)
let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 30_000; // 30 seconds

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Return cached data if fresh
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return new Response(JSON.stringify(cache.data), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=30" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Fetch all non-critical landing page data in parallel
    const [settingsRes, descRes, profileCountRes, streamRes] = await Promise.all([
      sb.from("site_settings").select("key, value"),
      sb.from("landing_descriptions").select("*").eq("is_active", true).order("sort_order"),
      sb.from("profiles").select("id", { count: "exact", head: true }),
      sb.from("streams").select("is_live").limit(1).single(),
    ]);

    const settings: Record<string, string> = {};
    (settingsRes.data || []).forEach((r: any) => {
      settings[r.key] = r.value;
    });

    const result = {
      settings,
      descriptions: descRes.data || [],
      userCount: profileCountRes.count ?? 0,
      isStreamLive: streamRes.data?.is_live ?? false,
    };

    cache = { data: result, ts: Date.now() };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=30" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
