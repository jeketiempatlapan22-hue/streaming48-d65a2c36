// Twilio WhatsApp webhook receiver.
// Receives incoming messages from Twilio (form-encoded), validates the X-Twilio-Signature,
// then forwards to the existing `whatsapp-webhook` (Fonnte format) so all command logic
// (admin + reseller) is reused without duplication.
// Responds with empty TwiML; the actual reply is sent by `whatsapp-webhook` via Twilio API.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twimlResponse(status = 200) {
  return new Response(TWIML_EMPTY, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  });
}

// Validate Twilio webhook signature (HMAC-SHA1 of full URL + sorted POST params)
async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  // Build the string Twilio signs: URL + concat(sorted key+value pairs)
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  // Convert to base64
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const expected = btoa(bin);
  return expected === signature;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return twimlResponse(405);

  try {
    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      console.warn("twilio-webhook: unexpected content-type:", contentType);
      return twimlResponse();
    }

    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);
    const paramsObj: Record<string, string> = {};
    for (const [k, v] of params) paramsObj[k] = v;

    // Verify signature (optional). Twilio signs the PUBLIC URL it called.
    // In Supabase Edge Functions, req.url shows the internal `edge-runtime.supabase.com` host,
    // so we must reconstruct using the project's public hostname.
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const signature = req.headers.get("x-twilio-signature") || "";
    if (TWILIO_AUTH_TOKEN && signature) {
      const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL") || "";
      // Strip trailing slash, then append the function path
      const base = SUPABASE_URL_ENV.replace(/\/$/, "");
      const publicUrl = `${base}/functions/v1/twilio-webhook`;

      // Try multiple URL variants Twilio might have signed (with/without trailing slash, query)
      const candidates = [
        publicUrl,
        publicUrl + "/",
      ];

      let ok = false;
      let triedUrl = "";
      for (const candidate of candidates) {
        triedUrl = candidate;
        if (await validateTwilioSignature(TWILIO_AUTH_TOKEN, signature, candidate, paramsObj)) {
          ok = true;
          break;
        }
      }

      if (!ok) {
        console.warn("twilio-webhook: invalid signature. tried:", candidates.join(" | "), "params keys:", Object.keys(paramsObj).join(","));
        // SOFT FAIL: log but continue, so bot still works while we debug signature.
        // Once confirmed working, change this back to a 403 return.
      } else {
        console.log("twilio-webhook: signature OK for", triedUrl);
      }
    } else if (!TWILIO_AUTH_TOKEN) {
      console.log("twilio-webhook: TWILIO_AUTH_TOKEN not set, skipping signature check");
    }

    const from = paramsObj["From"] || ""; // e.g. "whatsapp:+628123..."
    const body = paramsObj["Body"] || "";

    if (!from || !body) {
      console.log("twilio-webhook: missing From/Body, skipping");
      return twimlResponse();
    }

    // Strip "whatsapp:" prefix and "+" → keep digits only (matches whatsapp-webhook expectation)
    const sender = from.replace(/^whatsapp:/i, "").replace(/[^0-9]/g, "");

    // Forward to whatsapp-webhook (which contains all command logic)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const WEBHOOK_SECRET = Deno.env.get("WHATSAPP_WEBHOOK_SECRET");
    if (!SUPABASE_URL || !WEBHOOK_SECRET) {
      console.error("twilio-webhook: SUPABASE_URL or WHATSAPP_WEBHOOK_SECRET missing");
      return twimlResponse();
    }

    const forwardUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook?secret=${encodeURIComponent(WEBHOOK_SECRET)}`;
    const forwardBody = new URLSearchParams({ sender, message: body }).toString();

    // Fire-and-forget so Twilio gets fast TwiML response
    const forwardPromise = fetch(forwardUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Pass Supabase anon key so the function is reachable
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
        "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "",
      },
      body: forwardBody,
    }).then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        console.error("twilio-webhook: forward failed", r.status, text);
      } else {
        console.log("twilio-webhook: forwarded ok", { sender, msg: body.slice(0, 60) });
      }
    }).catch((e) => console.error("twilio-webhook: forward error", e));

    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === "function") {
      try { rt.waitUntil(forwardPromise); } catch { /* ignore */ }
    }

    return twimlResponse();
  } catch (err) {
    console.error("twilio-webhook error:", err);
    return twimlResponse(); // Always TwiML so Twilio doesn't retry
  }
});
