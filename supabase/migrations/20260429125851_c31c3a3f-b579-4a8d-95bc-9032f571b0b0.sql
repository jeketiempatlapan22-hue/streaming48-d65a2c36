CREATE OR REPLACE FUNCTION public.get_active_show_minimal(p_show_id uuid)
RETURNS TABLE(
  id uuid,
  title text,
  schedule_date text,
  schedule_time text,
  background_image_url text,
  team text,
  external_show_id text,
  is_replay boolean,
  is_active boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.id, s.title, s.schedule_date, s.schedule_time,
         s.background_image_url, s.team, s.external_show_id, s.is_replay, s.is_active
  FROM public.shows s
  WHERE s.id = p_show_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_show_minimal(uuid) TO anon, authenticated;