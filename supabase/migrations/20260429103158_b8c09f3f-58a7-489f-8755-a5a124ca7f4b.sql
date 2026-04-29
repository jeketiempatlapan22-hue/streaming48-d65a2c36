CREATE OR REPLACE FUNCTION public.validate_active_live_token(_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD;
  active_show RECORD;
  active_show_id uuid;
  normalized_code text;
  is_universal_token boolean := false;
  base_validation jsonb;
BEGIN
  base_validation := public.validate_token(_code);
  IF COALESCE((base_validation ->> 'valid')::boolean, false) = false THEN
    RETURN base_validation;
  END IF;

  SELECT * INTO t
  FROM public.tokens
  WHERE code = _code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token tidak ditemukan');
  END IF;

  SELECT value::uuid INTO active_show_id
  FROM public.site_settings
  WHERE key = 'active_show_id'
    AND value IS NOT NULL
    AND value <> ''
    AND value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  LIMIT 1;

  IF active_show_id IS NULL THEN
    RETURN base_validation;
  END IF;

  SELECT id, title, exclude_from_membership
  INTO active_show
  FROM public.shows
  WHERE id = active_show_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN base_validation;
  END IF;

  normalized_code := upper(coalesce(t.code, ''));
  is_universal_token :=
    normalized_code LIKE 'MBR-%'
    OR normalized_code LIKE 'MRD-%'
    OR normalized_code LIKE 'BDL-%'
    OR normalized_code LIKE 'RT48-%';

  IF COALESCE(active_show.exclude_from_membership, false) = true THEN
    IF is_universal_token OR t.show_id IS DISTINCT FROM active_show.id THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Show ini eksklusif dan tidak termasuk membership/bundle/custom. Silakan beli show ini secara satuan.',
        'exclusive', true,
        'active_show_id', active_show.id,
        'active_show_title', active_show.title
      );
    END IF;
  END IF;

  RETURN base_validation || jsonb_build_object(
    'active_show_id', active_show.id,
    'active_show_exclusive', COALESCE(active_show.exclude_from_membership, false)
  );
END;
$function$;