CREATE OR REPLACE FUNCTION public.validate_token(_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD;
  s RECORD;
  _is_bundle boolean := false;
BEGIN
  SELECT * INTO t FROM public.tokens WHERE code = _code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token tidak ditemukan');
  END IF;
  IF t.status = 'blocked' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token telah diblokir');
  END IF;
  IF t.status = 'expired' OR (t.expires_at IS NOT NULL AND t.expires_at < now()) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token telah kedaluwarsa');
  END IF;

  IF t.show_id IS NOT NULL THEN
    SELECT is_replay, is_active, is_bundle INTO s FROM public.shows WHERE id = t.show_id;
    _is_bundle := COALESCE(s.is_bundle, false);
    -- Bundle tokens should never be blocked by replay check
    IF FOUND AND s.is_replay = true AND NOT _is_bundle THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Show ini telah dijadikan replay. Akses streaming langsung tidak tersedia.');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'id', t.id,
    'code', t.code,
    'max_devices', t.max_devices,
    'expires_at', t.expires_at,
    'created_at', t.created_at,
    'status', t.status,
    'show_id', t.show_id,
    'is_bundle', _is_bundle
  );
END;
$function$;