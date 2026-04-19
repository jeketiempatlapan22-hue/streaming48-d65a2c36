// Edge function: verify-replay-access
// PUBLIC (no JWT). Called by the replay project to exchange a one-time
// access_token for the show password. Marks token as used (single-use).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { access_token } = await req.json();
    if (!access_token || typeof access_token !== "string") {
      return new Response(JSON.stringify({ success: false, error: "access_token wajib" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: row, error: fetchErr } = await adminClient
      .from("replay_access_tokens")
      .select("id, password, show_id, used, expires_at")
      .eq("token", access_token)
      .maybeSingle();

    if (fetchErr || !row) {
      return new Response(JSON.stringify({ success: false, error: "Token tidak valid" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (row.used) {
      return new Response(JSON.stringify({ success: false, error: "Token sudah digunakan" }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ success: false, error: "Token kedaluwarsa" }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as used (single-use)
    await adminClient
      .from("replay_access_tokens")
      .update({ used: true, used_at: new Date().toISOString() })
      .eq("id", row.id);

    return new Response(JSON.stringify({
      success: true,
      password: row.password,
      show_id: row.show_id,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
