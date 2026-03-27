
-- Create get_stream_status RPC for non-admin users to check live status
CREATE OR REPLACE FUNCTION public.get_stream_status()
RETURNS TABLE(
  is_live boolean,
  title text,
  description text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT s.is_live, s.title, s.description
  FROM public.streams s
  WHERE s.is_active = true
  LIMIT 1;
$$;
