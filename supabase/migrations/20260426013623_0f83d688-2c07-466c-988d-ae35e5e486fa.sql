CREATE OR REPLACE FUNCTION public.get_active_show_external_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.external_show_id
  FROM site_settings ss
  JOIN shows s ON s.id::text = ss.value
  WHERE ss.key = 'active_show_id'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_show_external_id() TO anon, authenticated;