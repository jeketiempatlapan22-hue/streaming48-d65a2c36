import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results = { coin_proofs_deleted: 0, payment_proofs_deleted: 0, errors: [] as string[] };

    // 1. Clean confirmed coin_orders with payment proofs (older than 7 days)
    const { data: coinOrders } = await supabase
      .from("coin_orders")
      .select("id, payment_proof_url")
      .eq("status", "confirmed")
      .not("payment_proof_url", "is", null)
      .lt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (coinOrders?.length) {
      for (const order of coinOrders) {
        try {
          // Extract file path from URL
          const filePath = extractFilePath(order.payment_proof_url, "coin-proofs");
          if (filePath) {
            const { error: delErr } = await supabase.storage.from("coin-proofs").remove([filePath]);
            if (!delErr) {
              await supabase.from("coin_orders").update({ payment_proof_url: null }).eq("id", order.id);
              results.coin_proofs_deleted++;
            } else {
              results.errors.push(`coin ${order.id}: ${delErr.message}`);
            }
          }
        } catch (e) {
          results.errors.push(`coin ${order.id}: ${e.message}`);
        }
      }
    }

    // 2. Clean confirmed/rejected subscription_orders with payment proofs (older than 7 days)
    const { data: subOrders } = await supabase
      .from("subscription_orders")
      .select("id, payment_proof_url")
      .in("status", ["confirmed", "rejected"])
      .not("payment_proof_url", "is", null)
      .lt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (subOrders?.length) {
      for (const order of subOrders) {
        try {
          const filePath = extractFilePath(order.payment_proof_url, "payment-proofs");
          if (filePath) {
            const { error: delErr } = await supabase.storage.from("payment-proofs").remove([filePath]);
            if (!delErr) {
              await supabase.from("subscription_orders").update({ payment_proof_url: null }).eq("id", order.id);
              results.payment_proofs_deleted++;
            } else {
              results.errors.push(`sub ${order.id}: ${delErr.message}`);
            }
          }
        } catch (e) {
          results.errors.push(`sub ${order.id}: ${e.message}`);
        }
      }
    }

    console.log("Cleanup results:", results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function extractFilePath(url: string | null, bucket: string): string | null {
  if (!url) return null;
  // Handle signed URLs: extract path after /object/sign/{bucket}/ or /object/public/{bucket}/
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split(`/${bucket}/`);
    if (pathParts.length > 1) {
      // Remove query params from path
      return pathParts[1].split("?")[0];
    }
  } catch {
    // If not a full URL, treat as direct file path
    return url;
  }
  return url;
}
