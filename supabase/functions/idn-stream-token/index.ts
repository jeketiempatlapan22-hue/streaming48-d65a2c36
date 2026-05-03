// IDN Stream Token Generator
// Generates JWT (HS256) x-api-token server-side for the IDN proxy server
// Endpoint target: https://proxy.mediastream48.workers.dev/api/stream/v2/playback
//
// Auth: caller must be either
//   - logged-in (Bearer JWT in Authorization header), OR
//   - provide a valid `token_code` (validated via validate_active_live_token RPC).
//
// Returns the 4 headers (x-api-token, x-sec-key, x-token-id, x-showid).
// The Partner Secret is stored in HANABIRA_PARTNER_SECRET (Lovable Cloud secret).
//
// Algorithm (per playback_baru.txt):
//   secretBase = "{x-sec-key}:{x-token-id}:{PARTNER_SECRET}"
//   jwtKey     = lower-hex(SHA-256(secretBase))
//   payload    = { sid: externalShowId, tid: TOKEN_ID, exp: nowSec + 7200 }
//   token      = base64url(header) + "." + base64url(payload) + "." + base64url(HMAC-SHA256(jwtKey, signingInput))

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Constants per playback_baru.txt
const TOKEN_ID = "114e0e89-f8b4-44ee-9354-bb06805cc02f";
const SEC_KEY = "49c647f3-c84b-4b93-9b84-9d1ad158428e";
// Partner Secret per playback_baru.txt. Dapat dioverride via env HANABIRA_PARTNER_SECRET bila dirotasi.
const DEFAULT_PARTNER_SECRET = "Hanabirastream2026";
const JWT_TTL_SECONDS = 7200; // 2 hours

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- Crypto helpers ----------
const enc = new TextEncoder();

function bytesToHex(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = enc.encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa is available in Deno
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return bytesToHex(digest);
}

async function signJwtHs256(payload: Record<string, unknown>, secretKey: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  const sigB64 = base64UrlEncode(sigBuf);
  return `${signingInput}.${sigB64}`;
}

// ---------- Main handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const partnerSecret = Deno.env.get("HANABIRA_PARTNER_SECRET") || DEFAULT_PARTNER_SECRET;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return jsonResponse({ success: false, error: "Konfigurasi backend tidak lengkap" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const requestedShowId = typeof body?.show_id === "string" && body.show_id.trim() ? body.show_id.trim() : null;
    const tokenCode = typeof body?.token_code === "string" && body.token_code.trim() ? body.token_code.trim() : null;
    const restreamCode = typeof body?.restream_code === "string" && body.restream_code.trim() ? body.restream_code.trim() : null;

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ---- Auth: logged-in user OR valid token_code OR valid restream_code ----
    let authorized = false;
    let authMode: "user" | "token" | "restream" | null = null;

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

    if (jwt) {
      const { data: userRes } = await sb.auth.getUser(jwt);
      if (userRes?.user) {
        authorized = true;
        authMode = "user";
      }
    }

    if (!authorized && tokenCode) {
      if (tokenCode.length > 100) {
        return jsonResponse({ success: false, error: "Token format invalid" }, 400);
      }
      const { data: validation, error: valErr } = await sb.rpc("validate_active_live_token", { _code: tokenCode });
      if (!valErr && (validation as any)?.valid) {
        authorized = true;
        authMode = "token";
      }
    }

    if (!authorized && restreamCode) {
      if (restreamCode.length > 200) {
        return jsonResponse({ success: false, error: "Restream code format invalid" }, 400);
      }
      const { data: rsValidation, error: rsErr } = await sb.rpc("validate_restream_code", { _code: restreamCode });
      if (!rsErr && (rsValidation as any)?.valid) {
        authorized = true;
        authMode = "restream";
        // Best-effort touch usage timestamp
        try { await sb.rpc("touch_restream_code_usage", { _code: restreamCode }); } catch { /* silent */ }
      }
    }

    if (!authorized) {
      return jsonResponse(
        { success: false, error: "Anda harus login, memiliki token akses, atau kode restream yang valid" },
        401,
      );
    }

    // ---- Resolve external_show_id ----
    let externalShowId = requestedShowId;
    if (!externalShowId) {
      const { data: settings, error: settingsError } = await sb
        .from("site_settings")
        .select("value")
        .eq("key", "active_show_id")
        .single();
      if (settingsError || !settings?.value) {
        console.error("[idn-stream-token] active_show_id error", settingsError);
        return jsonResponse({ success: false, error: "Tidak ada show aktif" }, 404);
      }
      const { data: show, error: showError } = await sb
        .from("shows")
        .select("external_show_id")
        .eq("id", settings.value)
        .single();
      if (showError || !show?.external_show_id) {
        console.error("[idn-stream-token] external_show_id error", showError);
        return jsonResponse({ success: false, error: "Show aktif belum memiliki External Show ID" }, 404);
      }
      externalShowId = String(show.external_show_id).trim();
    }

    // ---- Generate JWT ----
    const secretBase = `${SEC_KEY}:${TOKEN_ID}:${partnerSecret}`;
    const jwtKey = await sha256Hex(secretBase); // lower-hex string per dokumentasi Langkah A
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + JWT_TTL_SECONDS;
    const payload = { sid: externalShowId, tid: TOKEN_ID, exp };
    const apiToken = await signJwtHs256(payload, jwtKey);

    console.log(
      `[idn-stream-token] issued via=${authMode} show=${externalShowId} exp=${exp}`,
    );

    return jsonResponse({
      success: true,
      headers: {
        "x-api-token": apiToken,
        "x-sec-key": SEC_KEY,
        "x-token-id": TOKEN_ID,
        "x-showid": externalShowId,
      },
      show_id: externalShowId,
      expires_at: exp,
    });
  } catch (err: any) {
    console.error("[idn-stream-token] fatal", err);
    return jsonResponse({ success: false, error: err?.message || "Terjadi kesalahan" }, 500);
  }
});
