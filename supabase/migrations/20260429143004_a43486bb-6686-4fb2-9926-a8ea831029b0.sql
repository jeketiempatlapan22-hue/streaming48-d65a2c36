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
BEGIN
  base_validation := public.validate_token(_code);

  IF (base_validation->>'valid')::boolean IS DISTINCT FROM true THEN
    RETURN base_validation;
  END IF;

  SELECT t.code, t.show_id, t.is_public,
         s.is_subscription, s.is_bundle, s.is_replay, s.title,
         s.schedule_date, s.schedule_time
  INTO v_token
  FROM public.tokens t
  LEFT JOIN public.shows s ON s.id = t.show_id
  WHERE t.code = _code;

  -- Token universal / public / membership / bundle: lolos
  IF v_token.show_id IS NULL OR v_token.is_public = true THEN
    RETURN base_validation;
  END IF;

  IF COALESCE(v_token.is_subscription, false) OR COALESCE(v_token.is_bundle, false) THEN
    RETURN base_validation;
  END IF;

  IF COALESCE(v_token.is_replay, false) THEN
    RETURN base_validation;
  END IF;

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

  -- Show milik token belum dimulai / stream belum live
  IF v_active_show_id IS NULL OR v_is_live = false OR v_token.show_id <> v_active_show_id THEN
    SELECT title, schedule_date, schedule_time INTO v_active_show
    FROM public.shows WHERE id = v_active_show_id;

    -- Kalau show kamu beda dengan show aktif → mismatch
    IF v_active_show_id IS NOT NULL AND v_token.show_id <> v_active_show_id THEN
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

    -- Show kamu = show aktif tapi belum live, ATAU belum ada show aktif sama sekali
    RETURN jsonb_build_object(
      'valid', false,
      'token_not_started', true,
      'token_show_title', v_token.title,
      'token_show_date', COALESCE(v_token.schedule_date, ''),
      'token_show_time', COALESCE(v_token.schedule_time, ''),
      'error', format(
        'Show "%s" belum dimulai. Silakan kembali sesuai jadwal: %s %s',
        COALESCE(v_token.title, 'kamu'),
        COALESCE(v_token.schedule_date, ''),
        COALESCE(v_token.schedule_time, '')
      )
    );
  END IF;

  RETURN base_validation;
END;
$function$;