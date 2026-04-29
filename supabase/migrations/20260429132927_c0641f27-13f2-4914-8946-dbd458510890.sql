CREATE OR REPLACE FUNCTION public.validate_token(_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD;
  s RECORD;
  active_s RECORD;
  _is_bundle boolean := false;
  _is_universal boolean := false;
  _is_membership boolean := false;
  _normalized_code text;
  _active_show_id uuid;
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

  _normalized_code := upper(coalesce(t.code, ''));
  _is_membership := _normalized_code LIKE 'MBR-%' OR _normalized_code LIKE 'MRD-%';

  -- BLOK: jika membership sedang dijeda, tolak token MBR-/MRD-
  IF _is_membership AND public.is_membership_paused() THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Akses membership sedang dijeda admin. Silakan coba beberapa saat lagi.',
      'membership_paused', true
    );
  END IF;

  -- Universal tokens (membership, bundle, custom bot, atau token tanpa show_id)
  -- boleh mengakses show apa pun yang sedang live.
  _is_universal := (t.show_id IS NULL) OR (
    _normalized_code LIKE 'MBR-%'
    OR _normalized_code LIKE 'MRD-%'
    OR _normalized_code LIKE 'BDL-%'
    OR _normalized_code LIKE 'RT48-%'
  );

  IF t.show_id IS NOT NULL THEN
    SELECT is_replay, is_active, is_bundle INTO s FROM public.shows WHERE id = t.show_id;
    _is_bundle := COALESCE(s.is_bundle, false);
    IF FOUND AND s.is_replay = true AND NOT _is_bundle AND NOT _is_universal THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Show ini telah dijadikan replay. Akses streaming langsung tidak tersedia.');
    END IF;
  END IF;

  -- HARD-BLOCK SERVER-SIDE: Token non-universal hanya boleh mengakses show
  -- yang aktif sesuai jadwalnya. Jika admin sedang menayangkan show lain,
  -- tolak akses agar token tidak bisa dipakai untuk show yang bukan miliknya.
  IF NOT _is_universal AND t.show_id IS NOT NULL THEN
    SELECT NULLIF(value, '')::uuid INTO _active_show_id
    FROM public.site_settings
    WHERE key = 'active_show_id'
    LIMIT 1;

    IF _active_show_id IS NOT NULL AND _active_show_id <> t.show_id THEN
      SELECT title, schedule_date, schedule_time INTO active_s
      FROM public.shows WHERE id = _active_show_id;

      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Token ini tidak berlaku untuk show yang sedang tayang. Token Anda hanya berlaku untuk show sesuai jadwal pembelian.',
        'show_mismatch', true,
        'token_show_id', t.show_id,
        'active_show_id', _active_show_id,
        'active_show_title', COALESCE(active_s.title, ''),
        'token_show_title', COALESCE((SELECT title FROM public.shows WHERE id = t.show_id), '')
      );
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
    -- Hanya benar-benar bundle bila show flagged is_bundle. Token universal lain
    -- (membership/RT48) memiliki flag-nya sendiri di is_membership / kode prefix.
    'is_bundle', _is_bundle,
    'is_membership', _is_membership,
    'is_universal', _is_universal
  );
END;
$function$;