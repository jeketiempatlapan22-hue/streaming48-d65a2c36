
-- Test RPC: cek apakah token tertentu (MBR/MRD/BDL/RT48 atau lainnya) bisa akses show eksklusif/non-eksklusif
CREATE OR REPLACE FUNCTION public.test_token_show_access(_token_code text, _show_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _normalized text;
  _token record;
  _show record;
  _is_universal boolean;
  _is_specific_to_show boolean;
  _can_access boolean;
  _reason text;
BEGIN
  _normalized := upper(trim(coalesce(_token_code, '')));

  IF _normalized = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token code kosong');
  END IF;

  SELECT * INTO _token
  FROM public.tokens
  WHERE upper(code) = _normalized
  LIMIT 1;

  IF _token.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token tidak ditemukan');
  END IF;

  SELECT id, title, short_id, exclude_from_membership, is_active, is_replay
  INTO _show
  FROM public.shows
  WHERE id = _show_id
  LIMIT 1;

  IF _show.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Show tidak ditemukan');
  END IF;

  _is_universal := _normalized LIKE 'MBR-%'
                OR _normalized LIKE 'MRD-%'
                OR _normalized LIKE 'BDL-%'
                OR _normalized LIKE 'RT48-%';

  _is_specific_to_show := (_token.show_id IS NOT DISTINCT FROM _show.id);

  -- Token harus aktif & belum expired
  IF _token.status <> 'active' THEN
    _can_access := false;
    _reason := format('Token status = %s (bukan active)', _token.status);
  ELSIF _token.expires_at IS NOT NULL AND _token.expires_at <= now() THEN
    _can_access := false;
    _reason := format('Token expired pada %s', _token.expires_at);
  ELSIF COALESCE(_show.exclude_from_membership, false) = true THEN
    -- Show eksklusif: hanya boleh diakses oleh token spesifik untuk show ini
    IF _is_universal OR NOT _is_specific_to_show THEN
      _can_access := false;
      _reason := 'Show EKSKLUSIF: token universal/membership/bundle ditolak. Wajib token spesifik untuk show ini.';
    ELSE
      _can_access := true;
      _reason := 'Show eksklusif: token spesifik untuk show ini diterima.';
    END IF;
  ELSE
    -- Show non-eksklusif
    IF _is_universal THEN
      _can_access := true;
      _reason := format('Show non-eksklusif: token universal (%s) diterima sesuai durasi membership.', split_part(_normalized, '-', 1));
    ELSIF _is_specific_to_show THEN
      _can_access := true;
      _reason := 'Show non-eksklusif: token spesifik diterima.';
    ELSIF _token.show_id IS NULL THEN
      _can_access := true;
      _reason := 'Show non-eksklusif: token tanpa show_id (global) diterima.';
    ELSE
      _can_access := false;
      _reason := 'Token terikat ke show lain.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'can_access', _can_access,
    'reason', _reason,
    'token', jsonb_build_object(
      'code', _token.code,
      'status', _token.status,
      'expires_at', _token.expires_at,
      'show_id', _token.show_id,
      'is_universal_prefix', _is_universal,
      'prefix', split_part(_normalized, '-', 1)
    ),
    'show', jsonb_build_object(
      'id', _show.id,
      'title', _show.title,
      'short_id', _show.short_id,
      'exclude_from_membership', COALESCE(_show.exclude_from_membership, false),
      'is_active', _show.is_active,
      'is_replay', _show.is_replay
    )
  );
END;
$$;

-- Helper: cek 1 token terhadap SEMUA show aktif sekaligus (matrix lengkap)
CREATE OR REPLACE FUNCTION public.test_token_all_shows(_token_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _results jsonb := '[]'::jsonb;
  _show record;
  _check jsonb;
BEGIN
  FOR _show IN
    SELECT id FROM public.shows WHERE is_active = true ORDER BY exclude_from_membership DESC, created_at DESC
  LOOP
    _check := public.test_token_show_access(_token_code, _show.id);
    _results := _results || jsonb_build_array(_check);
  END LOOP;

  RETURN jsonb_build_object('results', _results);
END;
$$;

GRANT EXECUTE ON FUNCTION public.test_token_show_access(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_token_all_shows(text) TO anon, authenticated;
