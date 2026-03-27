
CREATE OR REPLACE FUNCTION public.cleanup_old_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.chat_messages WHERE created_at < now() - interval '30 days';
  DELETE FROM public.auth_metrics WHERE created_at < now() - interval '30 days';
  DELETE FROM public.security_events WHERE created_at < now() - interval '30 days';
  DELETE FROM public.suspicious_activity_log WHERE created_at < now() - interval '30 days';
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
END;
$$;
