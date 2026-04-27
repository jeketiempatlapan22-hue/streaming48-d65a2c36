import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompressor";

export interface UploadProofResult {
  path: string;
  bucket: string;
  signed_url: string | null;
}

/**
 * Upload a payment proof via the `upload-payment-proof` edge function.
 * Works for BOTH authenticated and anonymous users (guest QRIS dynamic flow).
 *
 * The edge function uses the service role to bypass storage RLS, so the file
 * is always written to the correct folder (uid/ for auth, guest/ for anon)
 * — this is the only path that does not get blocked by RLS for guest checkouts.
 */
export async function uploadPaymentProof(
  rawFile: File,
  opts: { type?: "show" | "coin"; show_id?: string | null; compress?: boolean } = {}
): Promise<UploadProofResult> {
  if (!rawFile || rawFile.size === 0) throw new Error("File kosong");
  if (rawFile.size > 5 * 1024 * 1024) throw new Error("File terlalu besar (maks 5MB)");

  let file: File = rawFile;
  if (opts.compress !== false) {
    try { file = await compressImage(rawFile); } catch { /* fall back to raw */ }
  }

  const fd = new FormData();
  fd.append("file", file);
  if (opts.show_id) fd.append("show_id", opts.show_id);
  if (opts.type) fd.append("type", opts.type);

  // Pass auth header when available so file lands in the user's folder & rate-limit
  // counts per user instead of per IP.
  const headers: Record<string, string> = {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  } catch { /* anon */ }

  const { data, error } = await supabase.functions.invoke("upload-payment-proof", {
    body: fd,
    headers,
  });

  if (error) {
    // Try to surface the server-side message
    const ctx: any = (error as any).context;
    let serverMsg: string | null = null;
    try {
      if (ctx?.json) serverMsg = (await ctx.json())?.error || null;
      else if (ctx?.text) serverMsg = await ctx.text();
    } catch { /* ignore */ }
    throw new Error(serverMsg || error.message || "Upload gagal");
  }

  const result = data as UploadProofResult | { error?: string };
  if (!result || (result as any).error || !(result as any).path) {
    throw new Error(((result as any)?.error) || "Upload gagal");
  }
  return result as UploadProofResult;
}
