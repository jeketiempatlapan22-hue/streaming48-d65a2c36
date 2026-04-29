
-- Parser jadwal show: terima schedule_date (teks bebas Indonesia) + schedule_time + timezone
-- Returns timestamptz UTC, atau NULL bila tidak parsable.
CREATE OR REPLACE FUNCTION public.parse_show_schedule(
  _date text,
  _time text,
  _tz text DEFAULT 'WIB'
) RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_date text;
  v_time text;
  v_tz text;
  v_offset_min int;
  v_year int;
  v_month int;
  v_day int;
  v_hour int := 0;
  v_minute int := 0;
  v_zone_match text;
  v_clean_time text;
  v_iso text[];
  v_dmy text[];
  v_parts text[];
  v_month_token text;
  v_month_num int;
BEGIN
  IF _date IS NULL OR length(trim(_date)) = 0 THEN
    RETURN NULL;
  END IF;

  v_date := trim(_date);
  v_time := COALESCE(_time, '');
  v_tz := UPPER(COALESCE(_tz, 'WIB'));

  -- Override timezone bila terdapat di string waktu
  v_zone_match := (regexp_match(v_time, '\m(WIB|WITA|WIT)\M', 'i'))[1];
  IF v_zone_match IS NOT NULL THEN
    v_tz := UPPER(v_zone_match);
  END IF;

  -- Bersihkan time
  v_clean_time := regexp_replace(v_time, '\s*(WIB|WITA|WIT)\s*', '', 'gi');
  v_clean_time := regexp_replace(v_clean_time, '\.', ':', 'g');
  v_clean_time := trim(v_clean_time);

  IF v_clean_time = '' THEN
    v_hour := 0; v_minute := 0;
  ELSE
    DECLARE
      is_pm boolean := false;
      is_am boolean := false;
      tt text[];
    BEGIN
      IF v_clean_time ~* 'pm$' THEN is_pm := true; v_clean_time := trim(regexp_replace(v_clean_time, 'pm$', '', 'i')); END IF;
      IF v_clean_time ~* 'am$' THEN is_am := true; v_clean_time := trim(regexp_replace(v_clean_time, 'am$', '', 'i')); END IF;
      tt := regexp_split_to_array(v_clean_time, ':');
      BEGIN v_hour := tt[1]::int; EXCEPTION WHEN others THEN v_hour := 0; END;
      IF array_length(tt,1) >= 2 THEN
        BEGIN v_minute := tt[2]::int; EXCEPTION WHEN others THEN v_minute := 0; END;
      END IF;
      IF is_pm AND v_hour < 12 THEN v_hour := v_hour + 12; END IF;
      IF is_am AND v_hour = 12 THEN v_hour := 0; END IF;
    END;
  END IF;

  -- Strip leading day-of-week
  v_date := regexp_replace(v_date, '^(senin|selasa|rabu|kamis|jumat|jum''at|sabtu|minggu|mon|tue|wed|thu|fri|sat|sun)\.?\s*,?\s*', '', 'i');
  v_date := regexp_replace(v_date, '\s+', ' ', 'g');
  v_date := trim(v_date);

  -- ISO YYYY-MM-DD
  v_iso := regexp_match(v_date, '^(\d{4})-(\d{1,2})-(\d{1,2})');
  IF v_iso IS NOT NULL THEN
    v_year := v_iso[1]::int;
    v_month := v_iso[2]::int;
    v_day := v_iso[3]::int;
  ELSE
    -- DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    v_dmy := regexp_match(v_date, '^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})');
    IF v_dmy IS NOT NULL THEN
      v_day := v_dmy[1]::int;
      v_month := v_dmy[2]::int;
      v_year := v_dmy[3]::int;
      IF v_year < 100 THEN v_year := v_year + 2000; END IF;
    ELSE
      -- Textual: "7 Mei 2026"
      v_parts := regexp_split_to_array(lower(v_date), '\s+');
      IF array_length(v_parts,1) >= 3 THEN
        BEGIN v_day := v_parts[1]::int; EXCEPTION WHEN others THEN RETURN NULL; END;
        v_month_token := v_parts[2];
        v_month_num := CASE v_month_token
          WHEN 'januari' THEN 1 WHEN 'jan' THEN 1
          WHEN 'februari' THEN 2 WHEN 'feb' THEN 2
          WHEN 'maret' THEN 3 WHEN 'mar' THEN 3
          WHEN 'april' THEN 4 WHEN 'apr' THEN 4
          WHEN 'mei' THEN 5 WHEN 'may' THEN 5
          WHEN 'juni' THEN 6 WHEN 'jun' THEN 6
          WHEN 'juli' THEN 7 WHEN 'jul' THEN 7
          WHEN 'agustus' THEN 8 WHEN 'agu' THEN 8 WHEN 'aug' THEN 8
          WHEN 'september' THEN 9 WHEN 'sep' THEN 9
          WHEN 'oktober' THEN 10 WHEN 'okt' THEN 10 WHEN 'oct' THEN 10
          WHEN 'november' THEN 11 WHEN 'nov' THEN 11
          WHEN 'desember' THEN 12 WHEN 'des' THEN 12 WHEN 'dec' THEN 12
          ELSE NULL END;
        IF v_month_num IS NULL THEN RETURN NULL; END IF;
        v_month := v_month_num;
        BEGIN v_year := v_parts[3]::int; EXCEPTION WHEN others THEN RETURN NULL; END;
      ELSE
        RETURN NULL;
      END IF;
    END IF;
  END IF;

  IF v_year IS NULL OR v_month IS NULL OR v_day IS NULL THEN RETURN NULL; END IF;
  IF v_month < 1 OR v_month > 12 OR v_day < 1 OR v_day > 31 THEN RETURN NULL; END IF;
  IF v_hour < 0 OR v_hour > 23 OR v_minute < 0 OR v_minute > 59 THEN RETURN NULL; END IF;

  v_offset_min := CASE v_tz
    WHEN 'WIB' THEN 7*60
    WHEN 'WITA' THEN 8*60
    WHEN 'WIT' THEN 9*60
    ELSE 7*60
  END;

  RETURN make_timestamptz(v_year, v_month, v_day, v_hour, v_minute, 0, 'UTC')
       - (v_offset_min || ' minutes')::interval;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Update validate_active_live_token: izinkan akses jika
--   1) sudah live, ATAU
--   2) waktu sekarang sudah masuk window 6 jam sebelum jadwal show milik token
-- (hanya berlaku untuk token reguler yang punya show_id; token universal/membership/bundle/replay tetap lolos)
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
  base_validation := public.validate_token(_code);

  IF (base_validation->>'valid')::boolean IS DISTINCT FROM true THEN
    RETURN base_validation;
  END IF;

  SELECT t.code, t.show_id, t.is_public,
         s.is_subscription, s.is_bundle, s.is_replay, s.title,
         s.schedule_date, s.schedule_time, s.schedule_timezone
  INTO v_token
  FROM public.tokens t
  LEFT JOIN public.shows s ON s.id = t.show_id
  WHERE t.code = _code;

  -- Token universal / public / membership / bundle / replay: lolos
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

  -- Hitung jadwal show milik token
  v_token_schedule := public.parse_show_schedule(
    v_token.schedule_date,
    v_token.schedule_time,
    COALESCE(v_token.schedule_timezone, 'WIB')
  );

  -- Mismatch: ada show aktif tapi BUKAN punya token ini
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

  -- Sudah live (dan show match / belum ada active_show_id) → lolos
  IF v_is_live AND (v_active_show_id IS NULL OR v_token.show_id = v_active_show_id) THEN
    RETURN base_validation;
  END IF;

  -- Belum live: izinkan kalau masih dalam window 6 jam sebelum jadwal
  IF v_token_schedule IS NOT NULL AND now() >= v_token_schedule - v_early_window THEN
    RETURN base_validation;
  END IF;

  -- Belum waktunya
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
