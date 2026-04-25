import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { message_id, message } = await req.json();
    if (!message_id || typeof message !== "string" || message.length === 0) {
      return new Response(JSON.stringify({ error: "invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (message.length > 500) {
      return new Response(JSON.stringify({ error: "message too long" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "missing key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Anda adalah moderator chat live streaming Indonesia. Klasifikasikan satu pesan chat menjadi salah satu kategori: question (pertanyaan ke host/admin), support (dukungan, cheer, pujian), spam (promosi, link mencurigakan, iklan), toxic (kasar, SARA, ujaran kebencian), normal (obrolan biasa). Berikan confidence 0-1." },
          { role: "user", content: message.slice(0, 500) },
        ],
        tools: [{
          type: "function",
          function: {
            name: "classify_message",
            description: "Klasifikasikan pesan chat",
            parameters: {
              type: "object",
              properties: {
                tag: { type: "string", enum: ["question", "support", "spam", "toxic", "normal"] },
                confidence: { type: "number" },
              },
              required: ["tag", "confidence"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "classify_message" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429 || aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "ai limit" }), { status: aiResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "ai error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await aiResp.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "no tool call" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const args = JSON.parse(toolCall.function.arguments);
    const tag = String(args.tag || "normal");
    const confidence = Math.max(0, Math.min(1, Number(args.confidence) || 0));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await supabase.from("chat_messages")
      .update({ ai_tag: tag, ai_tag_confidence: confidence })
      .eq("id", message_id);

    return new Response(JSON.stringify({ tag, confidence }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
