import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return ok({ success: false, error: "Unauthorized" });
    const token = authHeader.replace("Bearer ", "");
    const anon = createClient(SUPABASE_URL, ANON);
    const { data: { user }, error: authErr } = await anon.auth.getUser(token);
    if (authErr || !user) return ok({ success: false, error: "Unauthorized" });

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return ok({ success: false, error: "Forbidden" });

    const { user_id } = await req.json();
    if (!user_id) return ok({ success: false, error: "user_id required" });

    // Fetch auth user info
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
      headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    });
    const authUser = authRes.ok ? await authRes.json() : null;

    // Fetch token usage (which shows == watched live)
    const { data: userTokens } = await admin
      .from("tokens")
      .select("id, code, show_id, created_at, status, expires_at")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(50);

    const tokenIds = (userTokens || []).map((t: any) => t.id);
    let sessionCount = 0;
    if (tokenIds.length > 0) {
      const { count } = await admin
        .from("token_sessions")
        .select("*", { count: "exact", head: true })
        .in("token_id", tokenIds);
      sessionCount = count || 0;
    }

    // Fetch reset password history
    const { data: resetReqs } = await admin
      .from("password_reset_requests")
      .select("id, identifier, status, created_at, processed_at")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(20);

    return ok({
      success: true,
      activity: {
        last_sign_in_at: authUser?.last_sign_in_at || null,
        email: authUser?.email || null,
        email_confirmed_at: authUser?.email_confirmed_at || null,
        phone_from_auth: authUser?.phone || null,
        created_at: authUser?.created_at || null,
        tokens: userTokens || [],
        token_count: (userTokens || []).length,
        device_session_count: sessionCount,
        reset_requests: resetReqs || [],
      },
    });
  } catch (e) {
    console.error("admin-user-activity error:", e);
    return ok({ success: false, error: "Server error" });
  }
});
