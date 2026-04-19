// Edge function: generate-replay-access
// Authenticated. Verifies user has replay access for a show, then creates
// a one-time access token (valid 5 minutes) that can be exchanged for the
// password by the replay site via verify-replay-access.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Tidak login" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { show_id } = await req.json();
    if (!show_id) {
      return new Response(JSON.stringify({ success: false, error: "show_id wajib" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use anon key client with user's JWT to verify access via RPC
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ success: false, error: "Sesi tidak valid" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: accessData, error: accessErr } = await userClient.rpc(
      "check_user_replay_access",
      { _show_id: show_id }
    );

    if (accessErr) {
      return new Response(JSON.stringify({ success: false, error: accessErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = accessData as { success: boolean; password?: string; error?: string };
    if (!result?.success || !result.password) {
      return new Response(JSON.stringify({ success: false, error: result?.error || "Tidak punya akses" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate cryptographically random one-time token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    // Store via service role (bypasses RLS)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: insertErr } = await adminClient.from("replay_access_tokens").insert({
      token,
      show_id,
      user_id: userData.user.id,
      password: result.password,
    });

    if (insertErr) {
      return new Response(JSON.stringify({ success: false, error: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, access_token: token, expires_in: 300 }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
