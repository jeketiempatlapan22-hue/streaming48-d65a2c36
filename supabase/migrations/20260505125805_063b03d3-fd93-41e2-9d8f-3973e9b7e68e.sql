
-- 1. Get chat leaderboard via RPC (avoids client-side full table scan)
CREATE OR REPLACE FUNCTION public.get_chat_leaderboard(_limit int DEFAULT 10)
RETURNS TABLE(username text, message_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT username, COUNT(*)::bigint AS message_count
  FROM public.chat_messages
  WHERE is_deleted = false
    AND is_admin = false
    AND created_at > now() - interval '24 hours'
  GROUP BY username
  ORDER BY message_count DESC
  LIMIT GREATEST(1, LEAST(_limit, 50));
$$;

GRANT EXECUTE ON FUNCTION public.get_chat_leaderboard(int) TO anon, authenticated;

-- 2. Index for leaderboard performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_username_recent
ON public.chat_messages (username, created_at DESC)
WHERE is_deleted = false AND is_admin = false;

-- 3. Loosen viewer-aktif window to match new 120s heartbeat (180s grace)
CREATE OR REPLACE FUNCTION public.get_viewer_count()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::integer FROM public.viewer_counts
  WHERE last_seen_at > now() - interval '180 seconds';
$$;

CREATE OR REPLACE FUNCTION public.cleanup_stale_viewers()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.viewer_counts WHERE last_seen_at < now() - interval '180 seconds';
$$;

-- 4. Schedule cleanup every 2 minutes (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-stale-viewers-2m');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-stale-viewers-2m',
  '*/2 * * * *',
  $$SELECT public.cleanup_stale_viewers();$$
);

-- 5. ANALYZE hot tables
ANALYZE public.viewer_counts;
ANALYZE public.chat_messages;
