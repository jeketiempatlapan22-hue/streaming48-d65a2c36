import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// In-memory caches (edge function instances are reused for ~30s-5min)
let landingCache: { data: any; ts: number } | null = null;
let showsCache: { data: any; ts: number } | null = null;
let statsCache: { data: any; ts: number } | null = null;
const LANDING_TTL = 30_000;
const SHOWS_TTL = 20_000;
const STATS_TTL = 60_000;

// In-memory rate limiter
const rlMap = new Map<string, { count: number; resetAt: number }>();
function edgeRL(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const e = rlMap.get(key);
  if (rlMap.size > 2000) { for (const [k, v] of rlMap) { if (now > v.resetAt) rlMap.delete(k); } }
  if (!e || now > e.resetAt) { rlMap.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++;
  return true;
}

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function getLandingData(sb: any) {
  if (landingCache && Date.now() - landingCache.ts < LANDING_TTL) return landingCache.data;

  const [settingsRes, descRes, streamRes] = await Promise.all([
    withTimeout(sb.from("site_settings").select("key, value"), 5000, { data: [] } as any),
    withTimeout(sb.from("landing_descriptions").select("id, title, content, icon, image_url, text_align, sort_order").eq("is_active", true).order("sort_order"), 5000, { data: [] } as any),
    withTimeout(sb.from("streams").select("is_live").limit(1).single(), 3000, { data: null } as any),
  ]);

  const settings: Record<string, string> = {};
  (settingsRes.data || []).forEach((r: any) => { settings[r.key] = r.value; });

  const data = {
    settings,
    descriptions: descRes.data || [],
    isStreamLive: streamRes.data?.is_live ?? false,
  };
  landingCache = { data, ts: Date.now() };
  return data;
}

// Minimal show fields needed by landing page cards
const SHOW_CARD_FIELDS = "id,title,price,lineup,schedule_date,schedule_time,background_image_url,is_subscription,max_subscribers,is_order_closed,category,category_member,coin_price,replay_coin_price,is_replay,is_active,qris_image_url,subscription_benefits,group_link,qris_price,membership_duration_days,team,is_bundle,bundle_description,bundle_duration_days,bundle_replay_info,bundle_replay_passwords,replay_qris_price,short_id,exclude_from_membership";

async function getPublicShows(sb: any) {
  if (showsCache && Date.now() - showsCache.ts < SHOWS_TTL) return showsCache.data;

  const { data } = await withTimeout(
    sb.from("shows").select(SHOW_CARD_FIELDS).eq("is_active", true).order("created_at", { ascending: false }),
    5000,
    { data: showsCache?.data ?? [] } as any
  );
  // Strip access_password from response (security + smaller payload)
  const shows = (data || []).map((s: any) => ({ ...s, access_password: null }));
  showsCache = { data: shows, ts: Date.now() };
  return shows;
}

async function getStats(sb: any) {
  if (statsCache && Date.now() - statsCache.ts < STATS_TTL) return statsCache.data;

  const profileCountRes = await withTimeout(
    sb.from("profiles").select("id", { count: "exact", head: true }),
    6000,
    { count: statsCache?.data?.userCount ?? 0 } as any
  );

  // Keep stats endpoint lightweight: avoid scanning all balance rows on every refresh.
  const totalCoins = statsCache?.data?.totalCoins ?? 0;
  const data = {
    userCount: profileCountRes.count ?? 0,
    totalCoins,
  };
  statsCache = { data, ts: Date.now() };
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Rate limit: max 60 requests per minute per IP (generous for page loads + API calls)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!edgeRL(`landing:${ip}`, 60, 60_000)) {
      return new Response(JSON.stringify({ error: 'Rate limited' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '10' },
      });
    }

    const url = new URL(req.url);
    const endpoint = url.searchParams.get("type") || "landing";
    const sb = getSupabase();

    let result: any;

    switch (endpoint) {
      case "shows":
        result = await getPublicShows(sb);
        break;
      case "stats":
        result = await getStats(sb);
        break;
      case "all": {
        // Combined endpoint: returns everything in one call
        const [landing, shows, stats] = await Promise.all([
          getLandingData(sb),
          getPublicShows(sb),
          getStats(sb),
        ]);
        result = { ...landing, shows, ...stats };
        break;
      }
      default:
        result = await getLandingData(sb);
    }

    return new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=25, stale-while-revalidate=60",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
