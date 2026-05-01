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
  v_active_show RECORD;
  v_token_schedule timestamptz;
  v_early_window interval := interval '6 hours';
BEGIN
  SELECT t.code, t.show_id, t.status, t.expires_at, t.is_public,
         s.is_subscription, s.is_bundle, s.is_replay, s.title,
         s.schedule_date, s.schedule_time, s.schedule_timezone
  INTO v_token
  FROM public.tokens t
  LEFT JOIN public.shows s ON s.id = t.show_id
  WHERE t.code = _code
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN public.validate_token(_code);
  END IF;

  -- If the token belongs to a show that has become replay, do not let /live accept it.
  -- LivePage will call validate_replay_access and replace the URL with /replay-play?token=...
  -- This covers regular, reseller, membership, bundle, and custom show-bound tokens.
  IF COALESCE(v_token.is_replay, false)
     AND v_token.status IN ('active', 'archived')
     AND (v_token.expires_at IS NULL OR v_token.expires_at > now()) THEN
    RETURN jsonb_build_object(
      'valid', false,
      'replay_redirect', true,
      'token_code', v_token.code,
      'show_id', v_token.show_id,
      'show_title', COALESCE(v_token.title, 'Show'),
      'error', 'Show ini sudah menjadi replay. Mengalihkan ke halaman replay.'
    );
  END IF;

  base_validation := public.validate_token(_code);

  IF (base_validation->>'valid')::boolean IS DISTINCT FROM true THEN
    RETURN base_validation;
  END IF;

  -- Token universal / public / membership / bundle: lolos untuk live aktif.
  IF v_token.show_id IS NULL OR v_token.is_public = true THEN
    RETURN base_validation;
  END IF;
  IF COALESCE(v_token.is_subscription, false) OR COALESCE(v_token.is_bundle, false) THEN
    RETURN base_validation;
  END IF;

  SELECT NULLIF(value, '')::uuid INTO v_active_show_id
  FROM public.site_settings
  WHERE key = 'active_show_id'
  LIMIT 1;

  SELECT is_live INTO v_is_live
  FROM public.streams
  WHERE is_active = true
  ORDER BY created_at DESC
  LIMIT 1;
  v_is_live := COALESCE(v_is_live, false);

  -- Hitung jadwal show milik token.
  v_token_schedule := public.parse_show_schedule(
    v_token.schedule_date,
    v_token.schedule_time,
    COALESCE(v_token.schedule_timezone, 'WIB')
  );

  -- Mismatch: ada show aktif tapi BUKAN punya token ini.
  IF v_active_show_id IS NOT NULL AND v_token.show_id <> v_active_show_id THEN
    SELECT title, schedule_date, schedule_time INTO v_active_show
    FROM public.shows WHERE id = v_active_show_id;

    -- Tetap izinkan kalau token milik show yang akan datang (≤6 jam dari sekarang)
    -- agar user bisa tunggu di halaman live sampai show-nya benar-benar dimulai.
    IF v_token_schedule IS NOT NULL
       AND now() >= v_token_schedule - v_early_window
       AND now() <= v_token_schedule + interval '6 hours' THEN
      RETURN base_validation;
    END IF;

    RETURN jsonb_build_object(
      'valid', false,
      'show_mismatch', true,
      'token_show_title', v_token.title,
      'token_show_date', COALESCE(v_token.schedule_date, ''),
      'token_show_time', COALESCE(v_token.schedule_time, ''),
      'active_show_title', COALESCE(v_active_show.title, 'Show Lain'),
      'error', format(
        'Token kamu untuk "%s", bukan untuk show yang sedang live ("%s"). Silakan kembali sesuai jadwal show kamu.',
        COALESCE(v_token.title, 'show kamu'),
        COALESCE(v_active_show.title, 'show lain')
      )
    );
  END IF;

  -- Sudah live (dan show match / belum ada active_show_id) → lolos.
  IF v_is_live AND (v_active_show_id IS NULL OR v_token.show_id = v_active_show_id) THEN
    RETURN base_validation;
  END IF;

  -- Belum live: izinkan kalau masih dalam window 6 jam sebelum jadwal.
  IF v_token_schedule IS NOT NULL AND now() >= v_token_schedule - v_early_window THEN
    RETURN base_validation;
  END IF;

  -- Belum waktunya.
  RETURN jsonb_build_object(
    'valid', false,
    'token_not_started', true,
    'token_show_title', v_token.title,
    'token_show_date', COALESCE(v_token.schedule_date, ''),
    'token_show_time', COALESCE(v_token.schedule_time, ''),
    'early_access_hours', 6,
    'error', format(
      'Show "%s" belum dimulai. Akses dibuka 6 jam sebelum jadwal: %s %s',
      COALESCE(v_token.title, 'kamu'),
      COALESCE(v_token.schedule_date, ''),
      COALESCE(v_token.schedule_time, '')
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.validate_active_live_token(text) TO anon, authenticated, service_role;