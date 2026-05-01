CREATE OR REPLACE FUNCTION public.parse_show_datetime(_date text, _time text)
RETURNS timestamp with time zone
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _clean_date text;
  _clean_time text;
  _hour int := 0;
  _minute int := 0;
  _parts text[];
  _day int;
  _month int;
  _year int;
  _month_map jsonb := '{"januari":1,"februari":2,"maret":3,"april":4,"mei":5,"juni":6,"juli":7,"agustus":8,"september":9,"oktober":10,"november":11,"desember":12}';
  _result timestamptz;
BEGIN
  IF _date IS NULL OR btrim(_date) = '' OR _time IS NULL OR btrim(_time) = '' THEN
    RETURN NULL;
  END IF;

  -- Parse time first (supports "19:00", "19.00", "19.00 WIB", "19:00 wib")
  _clean_time := regexp_replace(btrim(_time), '\s*WIB\s*', '', 'i');
  _clean_time := replace(_clean_time, '.', ':');
  BEGIN
    _hour := split_part(_clean_time, ':', 1)::int;
    _minute := COALESCE(NULLIF(split_part(_clean_time, ':', 2), '')::int, 0);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  -- Normalize date: lower-case, strip optional Indonesian day-name prefix + comma,
  -- collapse multiple spaces.
  _clean_date := lower(btrim(_date));
  _clean_date := regexp_replace(
    _clean_date,
    '^(senin|selasa|rabu|kamis|jum''at|jumat|sabtu|minggu|ahad)\s*,?\s*',
    ''
  );
  _clean_date := regexp_replace(_clean_date, '\s+', ' ', 'g');
  _clean_date := btrim(_clean_date);

  -- Try ISO format YYYY-MM-DD
  BEGIN
    _result := (_clean_date || ' ' || lpad(_hour::text, 2, '0') || ':' || lpad(_minute::text, 2, '0') || ':00+07')::timestamptz;
    RETURN _result;
  EXCEPTION WHEN OTHERS THEN
    -- fall through to Indonesian format
  END;

  -- Try Indonesian format: "D[D] Bulan YYYY"
  _parts := string_to_array(_clean_date, ' ');
  IF array_length(_parts, 1) = 3 THEN
    BEGIN
      _day := _parts[1]::int;
      _month := (_month_map->>_parts[2])::int;
      _year := _parts[3]::int;
      IF _month IS NOT NULL THEN
        _result := make_timestamptz(_year, _month, _day, _hour, _minute, 0, 'Asia/Jakarta');
        RETURN _result;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END IF;

  RETURN NULL;
END;
$function$;