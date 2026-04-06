import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = "https://realtime48stream.my.id";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const rlMap = new Map<string, { count: number; resetAt: number }>();

function edgeRL(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (rlMap.size > 500) {
    for (const [k, v] of rlMap) {
      if (now > v.resetAt) rlMap.delete(k);
    }
  }

  const existing = rlMap.get(key);
  if (!existing || now > existing.resetAt) {
    rlMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= max) return false;
  existing.count += 1;
  return true;
}

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(raw: string | null | undefined) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  else if (!digits.startsWith("62")) digits = `62${digits}`;
  return digits;
}

async function pickRecentPhone(
  supabase: ReturnType<typeof createClient>,
  table: "password_reset_requests" | "coin_orders" | "subscription_orders",
  userId: string,
) {
  const { data } = await supabase
    .from(table)
    .select("phone")
    .eq("user_id", userId)
    .not("phone", "is", null)
    .neq("phone", "")
    .order("created_at", { ascending: false })
    .limit(5);

  for (const row of data || []) {
    const normalized = normalizePhone(row.phone);
    if (normalized) return normalized;
  }

  return "";
}

async function resolvePhone(
  supabase: ReturnType<typeof createClient>,
  request: { user_id: string; phone: string | null; identifier: string },
) {
  const immediateCandidates = [
    request.phone,
    request.identifier.endsWith("@rt48.user") ? request.identifier.replace("@rt48.user", "") : "",
  ];

  for (const candidate of immediateCandidates) {
    const normalized = normalizePhone(candidate);
    if (normalized) return normalized;
  }

  const tables: Array<"password_reset_requests" | "coin_orders" | "subscription_orders"> = [
    "password_reset_requests",
    "coin_orders",
    "subscription_orders",
  ];

  for (const table of tables) {
    const phone = await pickRecentPhone(supabase, table, request.user_id);
    if (phone) return phone;
  }

  return "";
}

async function sendWhatsApp(target: string, message: string, token: string) {
  const response = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { Authorization: token },
    body: new URLSearchParams({ target, message }),
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  const providerAccepted =
    response.ok &&
    payload.status !== false &&
    payload.ok !== false &&
    payload.success !== false;

  if (!providerAccepted) {
    return {
      success: false,
      error:
        String(payload.reason || payload.message || payload.detail || payload.error || "Gagal mengirim WhatsApp"),
    };
  }

  return { success: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!edgeRL(`process_reset:${ip}`, 10, 60_000)) {
    return ok({ success: false, error: "Terlalu banyak permintaan. Coba lagi sebentar." });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const FONNTE_TOKEN = Deno.env.get("FONNTE_API_TOKEN");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY || !FONNTE_TOKEN) {
      return ok({ success: false, error: "Konfigurasi backend reset password belum lengkap." });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return ok({ success: false, error: "Unauthorized" });
    }

    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return ok({ success: false, error: "Unauthorized" });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: isAdmin } = await adminClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) {
      return ok({ success: false, error: "Forbidden" });
    }

    const { request_id, action } = await req.json();
    if (!request_id || typeof request_id !== "string") {
      return ok({ success: false, error: "ID permintaan tidak valid." });
    }

    if (!["approve", "reject", "resend"].includes(action)) {
      return ok({ success: false, error: "Aksi tidak valid." });
    }

    const { data: request, error: requestError } = await adminClient
      .from("password_reset_requests")
      .select("id, user_id, identifier, phone, short_id, secure_token, status, processed_at")
      .eq("id", request_id)
      .maybeSingle();

    if (requestError || !request) {
      return ok({ success: false, error: "Permintaan reset tidak ditemukan." });
    }

    if (action === "reject") {
      if (!["pending", "approved"].includes(request.status)) {
        return ok({ success: false, error: "Permintaan ini sudah tidak bisa ditolak." });
      }

      const { error } = await adminClient
        .from("password_reset_requests")
        .update({ status: "rejected", processed_at: new Date().toISOString() })
        .eq("id", request.id);

      if (error) {
        return ok({ success: false, error: "Gagal menolak permintaan reset." });
      }

      return ok({ success: true });
    }

    if (action === "approve" && request.status !== "pending") {
      return ok({ success: false, error: "Permintaan ini sudah diproses." });
    }

    if (action === "resend" && request.status !== "approved") {
      return ok({ success: false, error: "Hanya permintaan yang sudah disetujui yang bisa dikirim ulang." });
    }

    if (!request.secure_token) {
      return ok({ success: false, error: "Token reset tidak tersedia untuk permintaan ini." });
    }

    const targetPhone = await resolvePhone(adminClient, request);
    if (!targetPhone) {
      return ok({ success: false, error: "Nomor WhatsApp user tidak ditemukan. Minta user isi nomor WhatsApp aktif saat reset password." });
    }

    const nextProcessedAt = new Date().toISOString();
    const previousProcessedAt = request.processed_at;

    const { error: approveError } = await adminClient
      .from("password_reset_requests")
      .update({
        status: "approved",
        processed_at: nextProcessedAt,
        phone: targetPhone,
      })
      .eq("id", request.id);

    if (approveError) {
      return ok({ success: false, error: "Gagal menyiapkan link reset password." });
    }

    const resetLink = `${APP_URL}/reset-password?token=${request.secure_token}`;
    const message =
      `🔑 *Reset Password Disetujui*\n\n` +
      `Klik link berikut untuk membuat password baru:\n${resetLink}\n\n` +
      `⏰ Link berlaku 2 jam.\n\n` +
      `Jika link tidak bisa langsung dibuka, salin lalu tempel di browser.`;

    const waResult = await sendWhatsApp(targetPhone, message, FONNTE_TOKEN);
    if (!waResult.success) {
      const rollbackPayload = action === "approve"
        ? { status: "pending", processed_at: null, phone: targetPhone }
        : { status: "approved", processed_at: previousProcessedAt, phone: targetPhone };

      await adminClient
        .from("password_reset_requests")
        .update(rollbackPayload)
        .eq("id", request.id);

      return ok({ success: false, error: waResult.error });
    }

    return ok({ success: true, target: targetPhone });
  } catch (error) {
    console.error("process-password-reset-request error:", error);
    return ok({ success: false, error: "Terjadi kesalahan server." });
  }
});