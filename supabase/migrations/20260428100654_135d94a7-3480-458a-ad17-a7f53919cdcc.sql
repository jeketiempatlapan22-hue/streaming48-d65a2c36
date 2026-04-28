ALTER TABLE public.shows
ADD COLUMN IF NOT EXISTS exclude_from_membership boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.get_membership_show_passwords()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result json;
  _has_universal boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.tokens
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
      AND (code ILIKE 'MBR-%' OR code ILIKE 'MRD-%' OR code ILIKE 'BDL-%' OR code ILIKE 'RT48-%')
  ) INTO _has_universal;

  IF NOT _has_universal THEN
    RETURN '{}'::json;
  END IF;

  SELECT json_object_agg(s.id::text, s.access_password) INTO _result
  FROM public.shows s
  WHERE s.is_active = true
    AND s.access_password IS NOT NULL
    AND s.access_password != ''
    AND COALESCE(s.exclude_from_membership, false) = false;

  RETURN COALESCE(_result, '{}'::json);
END;
$function$;