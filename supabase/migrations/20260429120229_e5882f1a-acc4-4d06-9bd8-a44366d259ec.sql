-- Buka akses replay untuk user dengan token universal:
-- RPC ini juga mengembalikan password untuk show replay aktif.
CREATE OR REPLACE FUNCTION public.get_membership_show_passwords()
RETURNS TABLE(show_id uuid, access_password text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.id, COALESCE(NULLIF(s.access_password, ''), '__universal_access__')
  FROM public.shows s
  WHERE s.is_active = true;
$function$;