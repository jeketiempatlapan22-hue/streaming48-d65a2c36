CREATE OR REPLACE FUNCTION public.validate_token(_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD;
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
  RETURN jsonb_build_object(
    'valid', true,
    'id', t.id,
    'code', t.code,
    'max_devices', t.max_devices,
    'expires_at', t.expires_at,
    'status', t.status,
    'show_id', t.show_id
  );
END;
$function$;