import { supabase } from "@/integrations/supabase/client";
import { buildReplayAccessUrl, buildReplayUrl, REPLAY_URL } from "@/lib/appConfig";

/**
 * Open the replay site for a given show with one-time access token.
 * Falls back to URL with password if user not logged in or token gen fails.
 *
 * @param showId  The show id to request access for
 * @param fallbackPassword  Plain password to use if the token flow fails
 * @returns       true if a window/tab was opened
 */
export async function openReplayWithAccess(
  showId: string,
  fallbackPassword?: string | null
): Promise<boolean> {
  // Open a placeholder tab synchronously to avoid popup blockers, then update its URL.
  const newTab = window.open("about:blank", "_blank");

  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session) {
      // Not logged in — fallback to legacy URL
      const url = fallbackPassword ? buildReplayUrl(fallbackPassword) : REPLAY_URL;
      if (newTab) newTab.location.href = url;
      return !!newTab;
    }

    const { data, error } = await supabase.functions.invoke("generate-replay-access", {
      body: { show_id: showId },
    });

    const result = data as { success?: boolean; access_token?: string; error?: string } | null;
    if (error || !result?.success || !result.access_token) {
      // Fallback to plain password URL
      const url = fallbackPassword ? buildReplayUrl(fallbackPassword) : REPLAY_URL;
      if (newTab) newTab.location.href = url;
      return !!newTab;
    }

    const url = buildReplayAccessUrl(result.access_token);
    if (newTab) newTab.location.href = url;
    return !!newTab;
  } catch {
    const url = fallbackPassword ? buildReplayUrl(fallbackPassword) : REPLAY_URL;
    if (newTab) newTab.location.href = url;
    return !!newTab;
  }
}
