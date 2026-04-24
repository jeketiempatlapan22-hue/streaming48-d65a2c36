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

    // Verify signature (optional but recommended)
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const signature = req.headers.get("x-twilio-signature") || "";
    if (TWILIO_AUTH_TOKEN && signature) {
      // Twilio signs the public URL it called. Reconstruct from x-forwarded-* headers.
      const proto = req.headers.get("x-forwarded-proto") || "https";
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
      const url = `${proto}://${host}${new URL(req.url).pathname}${new URL(req.url).search}`;

      const ok = await validateTwilioSignature(TWILIO_AUTH_TOKEN, signature, url, paramsObj);
      if (!ok) {
        console.warn("twilio-webhook: invalid signature for url:", url);
        return new Response("Forbidden: invalid Twilio signature", {
          status: 403,
          headers: corsHeaders,
        });
      }
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
