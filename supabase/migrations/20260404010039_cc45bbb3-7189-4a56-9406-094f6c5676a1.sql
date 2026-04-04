CREATE OR REPLACE FUNCTION public.auto_unblock_expired_ips()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count integer;
BEGIN
  UPDATE public.blocked_ips
  SET is_active = false,
      unblocked_at = now(),
      unblocked_by = 'system_auto_unblock_24h'
  WHERE is_active = true
    AND auto_blocked = true
    AND blocked_at < now() - interval '24 hours';

  GET DIAGNOSTICS _count = ROW_COUNT;

  IF _count > 0 THEN
    INSERT INTO public.security_events (event_type, description, severity)
    VALUES ('auto_unblock', 'Auto-unblocked ' || _count || ' IP(s) after 24 hours', 'low');
  END IF;
END;
$$;