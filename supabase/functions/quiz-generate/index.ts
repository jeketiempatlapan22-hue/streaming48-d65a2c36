import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth: hanya admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const theme = String(body.theme || "JKT48").slice(0, 80);
    const difficulty = ["mudah", "sedang", "sulit"].includes(body.difficulty) ? body.difficulty : "sedang";
    // Naikkan batas dari 5 ke 15 agar admin punya banyak pilihan
    const count = Math.max(1, Math.min(15, Number(body.count) || 10));
    const customPrompt = body.custom_prompt ? String(body.custom_prompt).slice(0, 300) : "";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return new Response(JSON.stringify({ error: "missing key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const isJKT48 = /jkt\s*48/i.test(theme);
    const jkt48Hint = isJKT48
      ? `Fokus pada JKT48 (idol grup Indonesia): nama member aktif & alumni, lagu/single (contoh: River, Heavy Rotation, Refrain Penuh Harapan, Rapsodi, Indahnya Senyum Manismu Itu, Pajama Drive, Saikou Kayo), generasi (Gen 1-13), kapten/wakil kapten, theater Senayan City, single ke berapa, MV, formasi senbatsu, sister group (AKB48/SNH48/BNK48/MNL48), kepanjangan JKT48, tahun debut (2011), oshi, handshake, sousenkyo, graduation, dll. Gunakan trivia BERAGAM agar tidak monoton dan menarik untuk fans.`
      : "";

    const sys = `Anda adalah generator pertanyaan quiz live streaming Bahasa Indonesia. Buat pertanyaan SINGKAT (maks 120 karakter) dengan jawaban SATU KATA atau frasa pendek (maks 30 karakter) yang mudah diketik di chat. Berikan 2-5 variasi jawaban valid (singkatan, sinonim, alternatif penulisan, dengan/tanpa kapital). Tema: ${theme}. Tingkat kesulitan: ${difficulty}. ${jkt48Hint} ${customPrompt ? `Instruksi tambahan: ${customPrompt}` : ""} Hindari pertanyaan dengan jawaban panjang/kalimat. Jangan ulangi tipe pertanyaan yang sama, variasikan: trivia, tebak lagu, tebak member, tebak tahun, tebak kepanjangan, dll.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Buat ${count} pertanyaan quiz.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "make_quiz",
            description: "Hasilkan pertanyaan quiz",
            parameters: {
              type: "object",
              properties: {
                questions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      question: { type: "string" },
                      answers: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
                    },
                    required: ["question", "answers"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["questions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "make_quiz" } },
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status === 429 || aiResp.status === 402 ? aiResp.status : 500;
      const msg = aiResp.status === 429 ? "Rate limit AI tercapai, coba lagi sebentar." : aiResp.status === 402 ? "Kredit AI workspace habis." : "AI error";
      return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await aiResp.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return new Response(JSON.stringify({ error: "no result" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const args = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ questions: args.questions || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
