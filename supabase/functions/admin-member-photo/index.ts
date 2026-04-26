import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const safeFileBase = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "member";

const objectPathFromPublicUrl = (url?: string | null) => {
  if (!url) return null;
  const marker = "/member-photos/";
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.slice(index + marker.length));
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) return json({ success: false, error: "Unauthorized" }, 401);

    const anon = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await anon.auth.getUser();
    if (authError || !user) return json({ success: false, error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return json({ success: false, error: "Forbidden" }, 403);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const memberId = String(formData.get("member_id") || "").trim() || null;
    const memberName = String(formData.get("member_name") || "").trim();

    if (!file || file.size === 0) return json({ success: false, error: "File tidak ditemukan" }, 400);
    if (!memberName && !memberId) return json({ success: false, error: "Data member tidak lengkap" }, 400);
    if (file.size > MAX_SIZE) return json({ success: false, error: "File terlalu besar. Maksimal 5 MB." }, 400);

    let contentType = file.type?.toLowerCase() || "";
    if (contentType === "image/jpg") contentType = "image/jpeg";
    if (!contentType || contentType === "application/octet-stream") {
      const lower = file.name.toLowerCase();
      contentType = lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg";
    }
    if (!ALLOWED_TYPES.has(contentType)) return json({ success: false, error: "Format file tidak didukung" }, 400);

    const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const filePath = `${safeFileBase(memberName || memberId || "member")}/${crypto.randomUUID()}.${ext}`;

    let oldPhotoUrl: string | null = null;
    if (memberId) {
      const { data: existing } = await admin.from("member_photos").select("photo_url").eq("id", memberId).maybeSingle();
      oldPhotoUrl = existing?.photo_url ?? null;
    } else if (memberName) {
      const { data: existing } = await admin.from("member_photos").select("photo_url").eq("name", memberName).maybeSingle();
      oldPhotoUrl = existing?.photo_url ?? null;
    }

    const { error: uploadError } = await admin.storage
      .from("member-photos")
      .upload(filePath, file, { contentType, upsert: false, cacheControl: "3600" });
    if (uploadError) return json({ success: false, error: uploadError.message }, 500);

    const { data: publicData } = admin.storage.from("member-photos").getPublicUrl(filePath);
    const photoUrl = publicData.publicUrl;

    const query = memberId
      ? admin.from("member_photos").update({ photo_url: photoUrl }).eq("id", memberId).select().single()
      : admin.from("member_photos").upsert({ name: memberName, photo_url: photoUrl }, { onConflict: "name" }).select().single();
    const { data: member, error: saveError } = await query;

    if (saveError || !member) {
      await admin.storage.from("member-photos").remove([filePath]);
      return json({ success: false, error: saveError?.message || "Gagal menyimpan data member" }, 500);
    }

    const oldPath = objectPathFromPublicUrl(oldPhotoUrl);
    if (oldPath && oldPath !== filePath) await admin.storage.from("member-photos").remove([oldPath]);

    return json({ success: true, member, photo_url: photoUrl, size: file.size });
  } catch (err) {
    console.error("admin-member-photo error:", err);
    return json({ success: false, error: "Upload gagal diproses" }, 500);
  }
});