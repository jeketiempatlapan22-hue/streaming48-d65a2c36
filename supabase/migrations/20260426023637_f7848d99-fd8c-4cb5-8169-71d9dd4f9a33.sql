-- Cleanup replay tokens & sessions yang sudah usang
CREATE OR REPLACE FUNCTION public.cleanup_replay_artifacts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted_tokens integer := 0;
  _deleted_sessions integer := 0;
BEGIN
  -- Hapus replay_tokens yang sudah expired lebih dari 7 hari
  DELETE FROM public.replay_tokens
  WHERE expires_at IS NOT NULL
    AND expires_at < (now() - interval '7 days');
  GET DIAGNOSTICS _deleted_tokens = ROW_COUNT;

  -- Nonaktifkan sesi replay yang last_seen-nya >24 jam,
  -- lalu hapus sesi non-aktif >7 hari.
  UPDATE public.replay_token_sessions
     SET is_active = false
   WHERE is_active = true
     AND last_seen_at < (now() - interval '24 hours');

  DELETE FROM public.replay_token_sessions
  WHERE is_active = false
    AND last_seen_at < (now() - interval '7 days');
  GET DIAGNOSTICS _deleted_sessions = ROW_COUNT;

  INSERT INTO public.security_events (event_type, description, severity)
  VALUES (
    'replay_cleanup',
    'Cleanup replay: ' || _deleted_tokens || ' tokens removed, ' || _deleted_sessions || ' sessions purged',
    'low'
  );
END;
$$;

-- Pastikan cron extensions ada (idempoten)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Reschedule cleanup (jalan tiap hari 18:00 UTC = 01:00 WIB)
SELECT cron.unschedule('replay-cleanup-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'replay-cleanup-daily');

SELECT cron.schedule(
  'replay-cleanup-daily',
  '0 18 * * *',
  $$ SELECT public.cleanup_replay_artifacts(); $$
);