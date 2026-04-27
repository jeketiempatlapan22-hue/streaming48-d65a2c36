import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!edgeRL(`upload:${ip}`, 15, 60_000)) {
    return new Response(JSON.stringify({ error: "Terlalu banyak upload. Tunggu sebentar." }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auth is OPTIONAL: guest checkout (QRIS dinamis & anonim) must work.
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const anonClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: { user } } = await anonClient.auth.getUser();
        if (user) userId = user.id;
      } catch (_e) { /* ignore — treat as guest */ }
    }

    // Per-identity rate limit (user OR ip): 15 uploads / hour
    const rlKey = userId ? `upload:user:${userId}` : `upload:ip:${ip}`;
    const { data: allowed } = await supabaseAdmin.rpc("check_rate_limit", {
      _key: rlKey,
      _max_requests: 15,
      _window_seconds: 3600,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: "Terlalu banyak upload. Coba lagi nanti." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (e) {
      console.error("Failed to parse formData:", e);
      return new Response(JSON.stringify({ error: "Invalid form data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const file = formData.get("file") as File | null;
    const showId = formData.get("show_id") as string | null;
    const uploadType = formData.get("type") as string | null;

    if (!file || file.size === 0) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine file type - mobile browsers sometimes don't set type
    let fileType = file.type?.toLowerCase() || "";
    if (!fileType || fileType === "application/octet-stream") {
      const name = file.name?.toLowerCase() || "";
      if (name.endsWith(".jpg") || name.endsWith(".jpeg")) fileType = "image/jpeg";
      else if (name.endsWith(".png")) fileType = "image/png";
      else if (name.endsWith(".webp")) fileType = "image/webp";
      else if (name.endsWith(".heic") || name.endsWith(".heif")) fileType = "image/jpeg";
      else fileType = "image/jpeg";
    }

    if (fileType === "image/jpg") fileType = "image/jpeg";

    if (!ALLOWED_TYPES.includes(fileType) && fileType !== "image/heic" && fileType !== "image/heif") {
      return new Response(
        JSON.stringify({ error: "Format file tidak didukung. Gunakan JPEG, PNG, atau WebP." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (file.size > MAX_SIZE) {
      return new Response(
        JSON.stringify({ error: "File terlalu besar. Maksimal 5 MB." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = supabaseAdmin;

    // For non-coin uploads, validate show_id (when provided)
    if (uploadType !== "coin" && showId) {
      const { data: show, error: showError } = await supabase
        .from("shows")
        .select("id")
        .eq("id", showId)
        .eq("is_active", true)
        .maybeSingle();

      if (showError || !show) {
        return new Response(
          JSON.stringify({ error: "Show tidak ditemukan atau tidak aktif." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Coin proofs require an authenticated user (real account is needed to credit balance).
    if (uploadType === "coin" && !userId) {
      return new Response(JSON.stringify({ error: "Login diperlukan untuk membeli koin." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "jpg", "image/heif": "jpg" };
    const ext = extMap[fileType] || "jpg";
    const bucketName = uploadType === "coin" ? "coin-proofs" : "payment-proofs";
    // Folder convention matches storage RLS: <uid>/ for auth users, guest/ for anon.
    const folder = userId ? userId : "guest";
    const fileName = `${folder}/${crypto.randomUUID()}.${ext}`;
    const contentType = (fileType === "image/heic" || fileType === "image/heif") ? "image/jpeg" : fileType;

    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, arrayBuffer, { contentType });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return new Response(JSON.stringify({ error: uploadError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return both raw path and signed URL — callers usually need both.
    const { data: signed } = await supabase.storage.from(bucketName).createSignedUrl(fileName, 86400);

    return new Response(
      JSON.stringify({ path: fileName, bucket: bucketName, signed_url: signed?.signedUrl || null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Upload failed:", err);
    return new Response(JSON.stringify({ error: "Upload failed: " + (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
