
CREATE OR REPLACE FUNCTION public.auto_cleanup_chat()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.chat_messages
  WHERE is_pinned = false
    AND id NOT IN (
      SELECT id FROM public.chat_messages
      ORDER BY created_at DESC
      LIMIT 200
    );
END;
$$;
