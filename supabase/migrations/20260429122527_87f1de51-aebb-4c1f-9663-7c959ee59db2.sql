
-- 1) RPC: set_membership_pause (admin only)
CREATE OR REPLACE FUNCTION public.set_membership_pause(_paused boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _affected integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Akses ditolak');
  END IF;

  INSERT INTO public.site_settings (key, value)
  VALUES ('membership_paused', CASE WHEN _paused THEN 'true' ELSE 'false' END)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  IF _paused THEN
    UPDATE public.token_sessions ts
    SET is_active = false
    FROM public.tokens t
    WHERE ts.token_id = t.id
      AND ts.is_active = true
      AND (upper(t.code) LIKE 'MBR-%' OR upper(t.code) LIKE 'MRD-%');
    GET DIAGNOSTICS _affected = ROW_COUNT;

    INSERT INTO public.admin_notifications (title, message, type)
    VALUES (
      '⏸️ Akses Membership Dijeda',
      format('Admin menjeda akses membership. %s sesi aktif diputus.', _affected),
      'membership_pause'
    );
  ELSE
    INSERT INTO public.admin_notifications (title, message, type)
    VALUES (
      '▶️ Akses Membership Diaktifkan',
      'Admin mengaktifkan kembali akses membership.',
      'membership_resume'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'paused', _paused, 'affected_sessions', _affected);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_membership_pause(boolean) TO authenticated;

-- 2) Helper: cek apakah membership sedang dijeda
CREATE OR REPLACE FUNCTION public.is_membership_paused()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value = 'true' FROM public.site_settings WHERE key = 'membership_paused' LIMIT 1),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_membership_paused() TO anon, authenticated;

-- 3) Update validate_token: tolak token membership saat dijeda
CREATE OR REPLACE FUNCTION public.validate_token(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  s RECORD;
  _is_bundle boolean := false;
  _is_universal boolean := false;
  _is_membership boolean := false;
  _normalized_code text;
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

  RETURN jsonb_build_object(
    'valid', true,
    'id', t.id,
    'code', t.code,
    'max_devices', t.max_devices,
    'expires_at', t.expires_at,
    'created_at', t.created_at,
    'status', t.status,
    'show_id', t.show_id,
    'is_bundle', _is_bundle OR _is_universal,
    'is_membership', _is_membership
  );
END;
$$;

-- 4) Update get_membership_show_passwords: kosong saat dijeda
CREATE OR REPLACE FUNCTION public.get_membership_show_passwords(_token_code text)
RETURNS TABLE(show_id uuid, password text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  _normalized text;
  _is_membership boolean;
BEGIN
  SELECT * INTO t FROM public.tokens WHERE code = _token_code;
  IF NOT FOUND OR t.status != 'active' OR (t.expires_at IS NOT NULL AND t.expires_at < now()) THEN
    RETURN;
  END IF;

  _normalized := upper(coalesce(t.code, ''));
  _is_membership := _normalized LIKE 'MBR-%' OR _normalized LIKE 'MRD-%';

  -- Saat membership dijeda, token membership tidak menerima password universal apa pun
  IF _is_membership AND public.is_membership_paused() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.id AS show_id,
         COALESCE(NULLIF(s.access_password, ''), '__universal_access__') AS password
  FROM public.shows s
  WHERE s.is_active = true;
END;
$$;
