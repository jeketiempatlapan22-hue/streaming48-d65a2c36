-- Perketat validasi token live: token regular hanya boleh dipakai
-- kalau show-nya yang sedang dipilih admin sebagai active_show_id
-- DAN stream sedang live. Membership/Bundle/Custom/Replay token
-- tidak terpengaruh (tetap fleksibel sesuai aturan masing-masing).

CREATE OR REPLACE FUNCTION public.validate_active_live_token(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  base_validation jsonb;
  v_token RECORD;
  v_active_show_id uuid;
  v_is_live boolean;
  v_token_show RECORD;
  v_active_show RECORD;
BEGIN
  -- 1) Validasi dasar (exists, expiry, status, replay-rules, dll.)
  base_validation := public.validate_token(_code);

  -- Kalau dasar gagal, kembalikan langsung.
  IF (base_validation->>'valid')::boolean IS DISTINCT FROM true THEN
    RETURN base_validation;
  END IF;

  -- 2) Ambil token + flag tipe khusus
  SELECT t.code, t.show_id, t.is_public,
         s.is_subscription, s.is_bundle, s.is_replay, s.title, s.schedule_date
  INTO v_token
  FROM public.tokens t
  LEFT JOIN public.shows s ON s.id = t.show_id
  WHERE t.code = _code;

  -- Token "ALL show" (tanpa show_id) atau token public → biarkan lolos.
  IF v_token.show_id IS NULL OR v_token.is_public = true THEN
    RETURN base_validation;
  END IF;

  -- Membership / Bundle: tidak terikat satu show live tertentu.
  IF COALESCE(v_token.is_subscription, false) OR COALESCE(v_token.is_bundle, false) THEN
    RETURN base_validation;
  END IF;

  -- Token replay tidak boleh masuk live (sudah dicek di validate_token, defensive return).
  IF COALESCE(v_token.is_replay, false) THEN
    RETURN base_validation;
  END IF;

  -- 3) Ambil active_show_id + status stream.
  SELECT (value)::uuid INTO v_active_show_id
  FROM public.site_settings
  WHERE key = 'active_show_id'
  LIMIT 1;

  SELECT is_live INTO v_is_live
  FROM public.streams
  WHERE is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  v_is_live := COALESCE(v_is_live, false);

  -- 4) Hard-block: belum ada show aktif ATAU stream belum live.
  IF v_active_show_id IS NULL OR v_is_live = false THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', format(
        'Show "%s" (%s) belum dimulai. Token hanya berlaku saat show kamu sedang live sesuai jadwal.',
        COALESCE(v_token.title, 'token'),
        COALESCE(v_token.schedule_date, 'jadwal belum diatur')
      )
    );
  END IF;

  -- 5) Hard-block: show token berbeda dengan show aktif.
  IF v_token.show_id <> v_active_show_id THEN
    SELECT title, schedule_date INTO v_active_show
    FROM public.shows WHERE id = v_active_show_id;

    RETURN jsonb_build_object(
      'valid', false,
      'error', format(
        'Token kamu untuk "%s" (%s), bukan untuk show yang sedang live ("%s"). Silakan kembali sesuai jadwal show kamu.',
        COALESCE(v_token.title, 'show kamu'),
        COALESCE(v_token.schedule_date, '-'),
        COALESCE(v_active_show.title, 'show lain')
      )
    );
  END IF;

  -- Lolos semua cek.
  RETURN base_validation;
END;
$function$;