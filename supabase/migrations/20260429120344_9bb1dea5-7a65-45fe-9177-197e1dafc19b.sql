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
  _is_universal boolean := false;
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

  -- Token universal: tidak terikat pada satu show (membership/bundle/custom).
  _is_universal := (t.show_id IS NULL) OR (
    upper(coalesce(t.code, '')) LIKE 'MBR-%'
    OR upper(coalesce(t.code, '')) LIKE 'MRD-%'
    OR upper(coalesce(t.code, '')) LIKE 'BDL-%'
    OR upper(coalesce(t.code, '')) LIKE 'RT48-%'
  );

  IF t.show_id IS NOT NULL THEN
    SELECT is_replay, is_active, is_bundle INTO s FROM public.shows WHERE id = t.show_id;
    _is_bundle := COALESCE(s.is_bundle, false);
    -- Bundle/universal tokens boleh akses replay; token per-show non-bundle tidak.
    IF FOUND AND s.is_replay = true AND NOT _is_bundle AND NOT _is_universal THEN
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
    'is_bundle', _is_bundle OR _is_universal
  );
END;
$function$;