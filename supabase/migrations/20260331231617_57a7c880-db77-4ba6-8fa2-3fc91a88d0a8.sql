SELECT cron.schedule(
  'cleanup-stale-viewers',
  '*/2 * * * *',
  $$SELECT public.cleanup_stale_viewers();$$
);