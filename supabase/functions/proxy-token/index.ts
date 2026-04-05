import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// In-memory token cache: { [showId]: { headers, fetchedAt } }
const tokenCache = new Map<string, { headers: Record<string, string>; fetchedAt: number }>();
const CACHE_TTL = 4 * 60 * 1000; // 4 minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { show_id: explicitShowId } = await req.json().catch(() => ({}));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    let externalShowId = explicitShowId;

    // If no explicit show_id, resolve from active show
    if (!externalShowId) {
      const { data: settings } = await sb
        .from("site_settings")
        .select("value")
        .eq("key", "active_show_id")
        .single();

      if (!settings?.value) {
        return new Response(
          JSON.stringify({ success: false, error: "Tidak ada show aktif" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: show } = await sb
        .from("shows")
        .select("external_show_id")
        .eq("id", settings.value)
        .single();

      if (!show?.external_show_id) {
        return new Response(
          JSON.stringify({ success: false, error: "Show tidak memiliki External Show ID" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      externalShowId = show.external_show_id;
    }

    // Check cache
    const cached = tokenCache.get(externalShowId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      console.log(`[proxy-token] Cache hit for ${externalShowId}`);
      return new Response(
        JSON.stringify({ success: true, headers: cached.headers, cached: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch token from hanabira48
    console.log(`[proxy-token] Fetching token for showId=${externalShowId}`);
    const tokenRes = await fetch(
      `https://hanabira48.com/api/stream-token?showId=${encodeURIComponent(externalShowId)}`
    );

    if (!tokenRes.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `Token API error: ${tokenRes.status}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData = await tokenRes.json();
    console.log(`[proxy-token] Token response keys:`, Object.keys(tokenData));

    // Build headers map
    const headers: Record<string, string> = {};
    
    // Try standard names first, then alternative names
    const mapping: [string, string[]][] = [
      ["x-api-token", ["x-api-token", "xapi", "apiToken", "api_token"]],
      ["x-sec-key", ["x-sec-key", "xsec", "secKey", "sec_key"]],
      ["x-showid", ["x-showid", "xshowid", "showId", "show_id"]],
      ["x-token-id", ["x-token-id", "xtoken", "tokenId", "token_id"]],
    ];

    for (const [headerName, keys] of mapping) {
      for (const key of keys) {
        if (tokenData[key]) {
          headers[headerName] = tokenData[key];
          break;
        }
      }
    }

    if (Object.keys(headers).length === 0) {
      // If no known keys found, pass all non-standard keys as-is
      for (const [k, v] of Object.entries(tokenData)) {
        if (typeof v === "string" && v.length > 0) {
          headers[k] = v;
        }
      }
    }

    // Cache it
    tokenCache.set(externalShowId, { headers, fetchedAt: Date.now() });

    return new Response(
      JSON.stringify({ success: true, headers, show_id: externalShowId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[proxy-token] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
