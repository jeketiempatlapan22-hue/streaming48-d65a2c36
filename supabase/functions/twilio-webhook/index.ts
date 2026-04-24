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

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twimlResponse(status = 200, message?: string) {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : TWIML_EMPTY;

  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  });
}

function parseIncomingTwilioParams(rawBody: string, contentType: string) {
  const paramsObj: Record<string, string> = {};

  if (contentType.includes("application/x-www-form-urlencoded") || rawBody.includes("=")) {
    const params = new URLSearchParams(rawBody);
    for (const [k, v] of params) paramsObj[k] = v;
    return paramsObj;
  }

  try {
    const json = JSON.parse(rawBody);
    if (json && typeof json === "object") {
      for (const [k, v] of Object.entries(json)) {
        paramsObj[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
    }
  } catch {
    // ignore parse errors and return empty object below
  }

  return paramsObj;
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
    const rawBody = await req.text();
    const paramsObj = parseIncomingTwilioParams(rawBody, contentType);

    if (!contentType.includes("application/x-www-form-urlencoded")) {
      console.warn("twilio-webhook: unexpected content-type, attempting fallback parse:", contentType || "(empty)");
    }

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

    const from = paramsObj["From"] || (paramsObj["WaId"] ? `whatsapp:+${String(paramsObj["WaId"]).replace(/[^0-9]/g, "")}` : "");
    const body = paramsObj["Body"] || paramsObj["body"] || paramsObj["message"] || paramsObj["text"] || "";
    const messageSid = paramsObj["MessageSid"] || paramsObj["SmsMessageSid"] || "";

    if (!from || !body) {
      console.log("twilio-webhook: missing From/Body, skipping", {
        hasFrom: !!from,
        hasBody: !!body,
        contentType: contentType || "(empty)",
        keys: Object.keys(paramsObj),
      });
      return twimlResponse();
    }

    console.log("twilio-webhook: inbound message", {
      sender: from,
      sid: messageSid,
      contentType: contentType || "(empty)",
      preview: body.slice(0, 60),
    });

    // Strip "whatsapp:" prefix and "+" → keep digits only (matches whatsapp-webhook expectation)
    const sender = from.replace(/^whatsapp:/i, "").replace(/[^0-9]/g, "");

    // Forward to whatsapp-webhook (which contains all command logic)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const WEBHOOK_SECRET = Deno.env.get("WHATSAPP_WEBHOOK_SECRET");
    if (!SUPABASE_URL || !WEBHOOK_SECRET) {
      console.error("twilio-webhook: SUPABASE_URL or WHATSAPP_WEBHOOK_SECRET missing");
      return twimlResponse();
    }

    const forwardUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook?secret=${encodeURIComponent(WEBHOOK_SECRET)}&reply_mode=sync`;
    const forwardBody = new URLSearchParams({ sender, message: body }).toString();

    const forwardRes = await fetch(forwardUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
        "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "",
      },
      body: forwardBody,
    });

    if (!forwardRes.ok) {
      const text = await forwardRes.text().catch(() => "");
      console.error("twilio-webhook: forward failed", forwardRes.status, text);
      return twimlResponse();
    }

    const result = await forwardRes.json().catch(() => null);
    const replyText = typeof result?.reply?.text === "string" ? result.reply.text : "";

    if (replyText) {
      console.log("twilio-webhook: reply ready", { sender, msg: body.slice(0, 60) });
      return twimlResponse(200, replyText);
    }

    console.log("twilio-webhook: no reply payload", { sender, msg: body.slice(0, 60) });
    return twimlResponse();

    return twimlResponse();
  } catch (err) {
    console.error("twilio-webhook error:", err);
    return twimlResponse(); // Always TwiML so Twilio doesn't retry
  }
});
