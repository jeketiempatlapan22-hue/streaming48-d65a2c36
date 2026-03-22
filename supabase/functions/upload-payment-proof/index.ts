import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // For non-coin uploads, validate show_id
    if (uploadType !== "coin") {
      if (!showId) {
        return new Response(
          JSON.stringify({ error: "show_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: show, error: showError } = await supabase
        .from("shows")
        .select("id")
        .eq("id", showId)
        .eq("is_active", true)
        .single();

      if (showError || !show) {
        return new Response(
          JSON.stringify({ error: "Show tidak ditemukan atau tidak aktif." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "jpg", "image/heif": "jpg" };
    const ext = extMap[fileType] || "jpg";
    const bucketName = uploadType === "coin" ? "coin-proofs" : "payment-proofs";
    const fileName = `${crypto.randomUUID()}.${ext}`;
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

    return new Response(
      JSON.stringify({ path: fileName }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Upload failed:", err);
    return new Response(JSON.stringify({ error: "Upload failed: " + (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
