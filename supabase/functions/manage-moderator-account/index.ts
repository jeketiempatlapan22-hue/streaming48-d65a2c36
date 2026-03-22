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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify caller is admin
    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: { user } } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return new Response(JSON.stringify({ error: "Not admin" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { action } = body;

    if (action === "create") {
      const { email, password, username } = body;
      if (!email || !password || !username) {
        return new Response(JSON.stringify({ error: "Email, password, dan username wajib diisi" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Create user via admin API
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username },
      });

      if (createErr) {
        return new Response(JSON.stringify({ error: createErr.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Add moderator role
      await supabase.from("user_roles").insert({ user_id: newUser.user!.id, role: "user" });

      // Add to moderators table
      await supabase.from("moderators").insert({
        user_id: newUser.user!.id,
        username,
        is_active: true,
      });

      // Create profile
      await supabase.from("profiles").upsert({
        id: newUser.user!.id,
        username,
      }, { onConflict: "id" });

      return new Response(JSON.stringify({ success: true, user_id: newUser.user!.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else if (action === "delete") {
      const { user_id } = body;
      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id wajib diisi" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Delete from moderators table
      await supabase.from("moderators").delete().eq("user_id", user_id);
      // Delete user roles
      await supabase.from("user_roles").delete().eq("user_id", user_id);
      // Delete auth user
      await supabase.auth.admin.deleteUser(user_id);

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else {
      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
