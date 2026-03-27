
-- Function to clean up old data (older than 30 days)
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
END;
$$;
