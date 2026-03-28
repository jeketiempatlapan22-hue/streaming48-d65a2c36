
-- Make viewer_heartbeat also clean stale entries (piggyback cleanup)
CREATE OR REPLACE FUNCTION public.viewer_heartbeat(_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.viewer_counts (viewer_key, last_seen_at)
  VALUES (_key, now())
  ON CONFLICT (viewer_key) DO UPDATE SET last_seen_at = now();
  -- Piggyback cleanup: remove stale viewers (>90s) on every heartbeat
  DELETE FROM public.viewer_counts WHERE last_seen_at < now() - interval '90 seconds';
END;
$$;

-- Also update cleanup_stale_viewers to match 90s threshold
CREATE OR REPLACE FUNCTION public.cleanup_stale_viewers()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.viewer_counts WHERE last_seen_at < now() - interval '90 seconds';
$$;
