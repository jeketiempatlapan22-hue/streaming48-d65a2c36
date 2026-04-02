import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// In-memory rate limiter
const rlMap = new Map<string, { count: number; resetAt: number }>();
function edgeRL(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (rlMap.size > 500) { for (const [k, v] of rlMap) { if (now > v.resetAt) rlMap.delete(k); } }
  const e = rlMap.get(key);
  if (!e || now > e.resetAt) { rlMap.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++;
  return true;
}

// Helper: always return 200 with JSON so supabase.functions.invoke can parse the body
function jsonResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  // Check if IP is blocked
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: ipBlocked } = await supabaseAdmin.rpc("is_ip_blocked", { _ip: ip });
  if (ipBlocked === true) {
    return jsonResponse({ success: false, error: 'Akses ditolak.' });
  }

  if (!edgeRL(`signup:${ip}`, 5, 60_000)) {
    // Record violation and auto-block if threshold met
    const { data: vResult } = await supabaseAdmin.rpc("record_rate_limit_violation", {
      _ip: ip, _endpoint: "signup-simple", _violation_key: `signup:${ip}`,
    });
    if (vResult?.auto_blocked) {
      // Send Telegram alert
      try {
        await fetch(`${supabaseUrl}/functions/v1/notify-ip-blocked`, {
          method: "POST",
          headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ip_address: ip, reason: "Rate limit signup-simple", violation_count: vResult.violation_count }),
        });
      } catch { /* best effort */ }
    }
    return jsonResponse({ success: false, error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }

  try {
    const { email, password, username } = await req.json();

    if (!email || !password) {
      return jsonResponse({ success: false, error: "Email dan password wajib diisi" });
    }

    if (password.length < 6) {
      return jsonResponse({ success: false, error: "Password minimal 6 karakter" });
    }

    // DB-level rate limit: 20 signups per hour per IP
    const { data: dbAllowed } = await supabaseAdmin.rpc("check_rate_limit", {
      _key: "signup_ip:" + ip, _max_requests: 20, _window_seconds: 3600,
    });
    if (dbAllowed === false) {
      return jsonResponse({ success: false, error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
    }

    // Check if user already exists using Admin API with email filter
    const lookupRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&page=1&per_page=1`,
      { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } }
    );

    if (lookupRes.ok) {
      const lookupData = await lookupRes.json();
      const users = lookupData?.users || [];
      const exactMatch = users.find((u: any) => u.email === email);
      if (exactMatch) {
        return jsonResponse({ success: false, error: "User already registered" });
      }
    }

    // Create user with admin API (bypasses weak password check + auto-confirms)
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: username || email.split("@")[0] },
    });

    if (error) {
      console.error("Admin createUser error:", error.message);
      return jsonResponse({ success: false, error: error.message });
    }

    return jsonResponse({ success: true, user_id: data.user?.id });
  } catch (err) {
    console.error("signup-simple error:", err);
    return jsonResponse({ success: false, error: "Server error" });
  }
});
