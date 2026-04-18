-- Table to track unique IP visits per session
CREATE TABLE IF NOT EXISTS public.ip_visit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  user_agent text,
  user_id uuid,
  visit_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  path text,
  CONSTRAINT ip_visit_log_ip_unique UNIQUE (ip_address)
);

CREATE INDEX IF NOT EXISTS idx_ip_visit_log_last_seen ON public.ip_visit_log (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_ip_visit_log_visit_count ON public.ip_visit_log (visit_count DESC);

ALTER TABLE public.ip_visit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ip visit log"
  ON public.ip_visit_log
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can insert ip visits"
  ON public.ip_visit_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Daily reset function: delete all rows except those whose IP is currently blocked
CREATE OR REPLACE FUNCTION public.reset_ip_visit_log_daily()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted integer;
BEGIN
  DELETE FROM public.ip_visit_log
  WHERE ip_address NOT IN (
    SELECT ip_address FROM public.blocked_ips WHERE is_active = true
  );
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  INSERT INTO public.security_events (event_type, description, severity)
  VALUES ('ip_log_daily_reset', 'Reset ' || _deleted || ' IP visit entries (kept blocked IPs)', 'low');
END;
$$;

-- Schedule daily reset at 00:00 WIB (17:00 UTC previous day)
SELECT cron.unschedule('ip-visit-log-daily-reset')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ip-visit-log-daily-reset');

SELECT cron.schedule(
  'ip-visit-log-daily-reset',
  '0 17 * * *',
  $$ SELECT public.reset_ip_visit_log_daily(); $$
);