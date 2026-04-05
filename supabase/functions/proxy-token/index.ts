import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const tokenCache = new Map<string, { headers: Record<string, string>; fetchedAt: number }>();
const CACHE_TTL = 4 * 60 * 1000;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildProxyHeaders(tokenResponse: any): Record<string, string> | null {
  const source = tokenResponse?.data && typeof tokenResponse.data === "object"
    ? tokenResponse.data
    : tokenResponse;

  const apiToken = source?.apiToken ?? source?.api_token ?? source?.["x-api-token"] ?? source?.xapi;
  const secKey = source?.secKey ?? source?.sec_key ?? source?.["x-sec-key"] ?? source?.xsec;
  const showId = source?.showId ?? source?.show_id ?? source?.["x-showid"] ?? source?.xshowid;
  const tokenId = source?.tokenId ?? source?.token_id ?? source?.["x-token-id"] ?? source?.xtoken ?? source?.x;

  if (!apiToken || !secKey || !showId || !tokenId) {
    return null;
  }

  return {
    "x-api-token": String(apiToken),
    "x-sec-key": String(secKey),
    "x-showid": String(showId),
    "x-token-id": String(tokenId),
    xapi: String(apiToken),
    xsec: String(secKey),
    xshowid: String(showId),
    x: String(tokenId),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const requestedShowId = typeof body?.show_id === "string" && body.show_id.trim()
      ? body.show_id.trim()
      : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ success: false, error: "Konfigurasi backend tidak lengkap" });
    }

    const sb = createClient(supabaseUrl, serviceKey);
    let externalShowId = requestedShowId;

    if (!externalShowId) {
      const { data: settings, error: settingsError } = await sb
        .from("site_settings")
        .select("value")
        .eq("key", "active_show_id")
        .single();

      if (settingsError || !settings?.value) {
        console.error("[proxy-token] active_show_id error", settingsError);
        return jsonResponse({ success: false, error: "Tidak ada show aktif" });
      }

      const { data: show, error: showError } = await sb
        .from("shows")
        .select("external_show_id")
        .eq("id", settings.value)
        .single();

      if (showError || !show?.external_show_id) {
        console.error("[proxy-token] external_show_id error", showError);
        return jsonResponse({ success: false, error: "Show aktif belum memiliki External Show ID" });
      }

      externalShowId = String(show.external_show_id).trim();
    }

    const cached = tokenCache.get(externalShowId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      console.log(`[proxy-token] cache hit: ${externalShowId}`);
      return jsonResponse({ success: true, headers: cached.headers, show_id: externalShowId, cached: true });
    }

    console.log(`[proxy-token] fetching hanabira token for ${externalShowId}`);
    const tokenRes = await fetch(
      `https://hanabira48.com/api/stream-token?showId=${encodeURIComponent(externalShowId)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
        },
      }
    );

    const tokenPayload = await tokenRes.json().catch(() => null);

    if (!tokenRes.ok) {
      console.error("[proxy-token] hanabira error", tokenRes.status, tokenPayload);
      return jsonResponse({ success: false, error: `Token API error: ${tokenRes.status}` });
    }

    const headers = buildProxyHeaders(tokenPayload);
    if (!headers) {
      console.error("[proxy-token] invalid token payload", tokenPayload);
      return jsonResponse({
        success: false,
        error: "Format respons token tidak valid",
        keys: Object.keys(tokenPayload || {}),
        nested_keys: Object.keys(tokenPayload?.data || {}),
      });
    }

    tokenCache.set(externalShowId, { headers, fetchedAt: Date.now() });
    console.log(`[proxy-token] token ready for ${externalShowId}`);

    return jsonResponse({ success: true, headers, show_id: externalShowId });
  } catch (err: any) {
    console.error("[proxy-token] fatal", err);
    return jsonResponse({ success: false, error: err?.message || "Terjadi kesalahan" });
  }
});
