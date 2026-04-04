
CREATE OR REPLACE FUNCTION public.auto_unblock_expired_ips()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _count integer;
  _hours integer;
  _hours_text text;
BEGIN
  SELECT value INTO _hours_text FROM public.site_settings WHERE key = 'auto_unblock_hours';
  _hours := COALESCE(NULLIF(_hours_text, '')::integer, 24);
  IF _hours < 1 THEN _hours := 24; END IF;

  UPDATE public.blocked_ips
  SET is_active = false,
      unblocked_at = now(),
      unblocked_by = 'system_auto_unblock_' || _hours || 'h'
  WHERE is_active = true
    AND auto_blocked = true
    AND blocked_at < now() - (_hours || ' hours')::interval;

  GET DIAGNOSTICS _count = ROW_COUNT;

  IF _count > 0 THEN
    INSERT INTO public.security_events (event_type, description, severity)
    VALUES ('auto_unblock', 'Auto-unblocked ' || _count || ' IP(s) after ' || _hours || ' hours', 'low');
  END IF;
END;
$function$;
