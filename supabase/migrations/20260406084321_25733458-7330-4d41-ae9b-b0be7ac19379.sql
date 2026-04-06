CREATE OR REPLACE FUNCTION public.get_safe_playlists()
RETURNS TABLE(id uuid, title text, type text, url text, is_active boolean, sort_order integer, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN QUERY SELECT p.id, p.title, p.type, p.url, p.is_active, p.sort_order, p.created_at
    FROM public.playlists p ORDER BY p.sort_order;
  ELSE
    RETURN QUERY SELECT p.id, p.title, p.type,
      CASE WHEN p.type = 'direct' THEN p.url ELSE p.id::text END AS url,
      p.is_active, p.sort_order, p.created_at
    FROM public.playlists p WHERE p.is_active = true ORDER BY p.sort_order;
  END IF;
END;
$$;