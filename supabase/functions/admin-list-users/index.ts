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

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return ok({ success: false, error: "Unauthorized" });
    const token = authHeader.replace("Bearer ", "");
    const anon = createClient(SUPABASE_URL, ANON);
    const { data: { user }, error: authErr } = await anon.auth.getUser(token);
    if (authErr || !user) return ok({ success: false, error: "Unauthorized" });

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return ok({ success: false, error: "Forbidden" });

    // Fetch all auth users (paginated 1000 each)
    const allAuthUsers: Array<{ id: string; email: string | null; created_at: string; last_sign_in_at: string | null; phone: string | null }> = [];
    let page = 1;
    const perPage = 1000;
    while (true) {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
        headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
      });
      if (!res.ok) break;
      const body = await res.json();
      const list = body?.users || [];
      for (const u of list) {
        allAuthUsers.push({
          id: u.id,
          email: u.email || null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at || null,
          phone: u.phone || u?.user_metadata?.phone || null,
        });
      }
      if (list.length < perPage) break;
      page++;
      if (page > 20) break; // safety cap = 20k users
    }

    return ok({ success: true, users: allAuthUsers });
  } catch (e) {
    console.error("admin-list-users error:", e);
    return ok({ success: false, error: "Server error" });
  }
});
