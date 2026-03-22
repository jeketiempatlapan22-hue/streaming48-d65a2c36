
-- Rate limiting table
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key TEXT NOT NULL PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits (window_start);

-- Rate limit checker function
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _key TEXT, _max_requests INTEGER, _window_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _now TIMESTAMPTZ := now(); _window_start TIMESTAMPTZ; _count INTEGER;
BEGIN
  SELECT window_start, request_count INTO _window_start, _count FROM public.rate_limits WHERE key = _key;
  IF NOT FOUND THEN
    INSERT INTO public.rate_limits (key, window_start, request_count) VALUES (_key, _now, 1)
    ON CONFLICT (key) DO UPDATE SET window_start = _now, request_count = 1;
    RETURN TRUE;
  END IF;
  IF _now > _window_start + (_window_seconds || ' seconds')::interval THEN
    UPDATE public.rate_limits SET window_start = _now, request_count = 1 WHERE key = _key;
    RETURN TRUE;
  END IF;
  IF _count >= _max_requests THEN RETURN FALSE; END IF;
  UPDATE public.rate_limits SET request_count = request_count + 1 WHERE key = _key;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_rate_limits() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 hour'; $$;

-- Password reset requests table
CREATE SEQUENCE IF NOT EXISTS public.password_reset_requests_short_id_seq START 1;

CREATE TABLE public.password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id text NOT NULL DEFAULT ('r' || nextval('password_reset_requests_short_id_seq'::regclass)),
  user_id uuid NOT NULL,
  identifier text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  new_password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create reset request"
  ON public.password_reset_requests FOR INSERT TO public
  WITH CHECK (status = 'pending');

CREATE POLICY "Admins can manage reset requests"
  ON public.password_reset_requests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Request password reset RPC
CREATE OR REPLACE FUNCTION public.request_password_reset(_identifier text, _new_password text DEFAULT NULL::text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _user_id uuid; _phone text; _username text; _short_id text;
  _normalized text; _email_lookup text; _allowed boolean;
BEGIN
  _normalized := trim(_identifier);
  IF _normalized = '' THEN RETURN json_build_object('success', false, 'error', 'Masukkan nomor HP atau email'); END IF;

  SELECT public.check_rate_limit('pw_reset:' || _normalized, 3, 600) INTO _allowed;
  IF NOT _allowed THEN
    RETURN json_build_object('success', false, 'error', 'Terlalu banyak percobaan. Tunggu beberapa menit.');
  END IF;

  IF _normalized ~ '^[0-9]' THEN
    _email_lookup := regexp_replace(_normalized, '[^0-9]', '', 'g') || '@rt48.user';
  ELSE
    _email_lookup := _normalized;
  END IF;

  SELECT id INTO _user_id FROM auth.users WHERE email = _email_lookup;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Akun tidak ditemukan');
  END IF;

  IF EXISTS (SELECT 1 FROM public.password_reset_requests WHERE user_id = _user_id AND status = 'pending' AND created_at > now() - interval '1 hour') THEN
    RETURN json_build_object('success', false, 'error', 'Sudah ada permintaan reset yang belum diproses. Tunggu admin mengkonfirmasi.');
  END IF;

  SELECT username INTO _username FROM public.profiles WHERE id = _user_id;

  IF _normalized ~ '^[0-9]' THEN
    _phone := regexp_replace(_normalized, '[^0-9]', '', 'g');
  ELSE
    _phone := '';
  END IF;

  INSERT INTO public.password_reset_requests (user_id, identifier, phone, new_password)
  VALUES (_user_id, _normalized, _phone, NULL)
  RETURNING short_id INTO _short_id;

  RETURN json_build_object('success', true, 'short_id', _short_id, 'username', COALESCE(_username, ''));
END;
$$;

-- Get my password reset status RPC
CREATE OR REPLACE FUNCTION public.get_my_password_reset_status()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _result record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('has_reset', false); END IF;
  SELECT id, status, processed_at INTO _result
  FROM public.password_reset_requests
  WHERE user_id = auth.uid() AND status IN ('approved', 'completed')
    AND processed_at IS NOT NULL AND processed_at > now() - interval '24 hours'
  ORDER BY processed_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('has_reset', false); END IF;
  RETURN json_build_object('has_reset', true, 'status', _result.status, 'processed_at', _result.processed_at);
END;
$$;

-- Helper function to parse Indonesian date/time strings
CREATE OR REPLACE FUNCTION public.parse_show_datetime(_date text, _time text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $$
DECLARE
  _clean_time text; _hour int; _minute int; _parts text[];
  _day int; _month int; _year int;
  _month_map jsonb := '{"januari":1,"februari":2,"maret":3,"april":4,"mei":5,"juni":6,"juli":7,"agustus":8,"september":9,"oktober":10,"november":11,"desember":12}';
  _result timestamptz;
BEGIN
  IF _date IS NULL OR _date = '' OR _time IS NULL OR _time = '' THEN RETURN NULL; END IF;
  _clean_time := regexp_replace(trim(_time), '\s*WIB\s*', '', 'i');
  _clean_time := replace(_clean_time, '.', ':');
  _hour := split_part(_clean_time, ':', 1)::int;
  _minute := COALESCE(NULLIF(split_part(_clean_time, ':', 2), '')::int, 0);
  BEGIN
    _result := (_date || ' ' || lpad(_hour::text, 2, '0') || ':' || lpad(_minute::text, 2, '0') || ':00+07')::timestamptz;
    RETURN _result;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  _parts := string_to_array(lower(trim(_date)), ' ');
  IF array_length(_parts, 1) = 3 THEN
    _day := _parts[1]::int;
    _month := (_month_map->>_parts[2])::int;
    _year := _parts[3]::int;
    IF _month IS NOT NULL THEN
      _result := make_timestamptz(_year, _month, _day, _hour, _minute, 0, 'Asia/Jakarta');
      RETURN _result;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
