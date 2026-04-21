-- Enable pgcrypto for digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================
-- RESELLER SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS public.resellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  wa_command_prefix text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  notes text DEFAULT '',
  session_token text,
  session_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prefix_format CHECK (wa_command_prefix ~ '^[A-Za-z]{1,3}$')
);

ALTER TABLE public.resellers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage resellers"
  ON public.resellers FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anon cannot read resellers"
  ON public.resellers FOR SELECT TO anon USING (false);

CREATE INDEX IF NOT EXISTS idx_resellers_phone ON public.resellers(phone);
CREATE INDEX IF NOT EXISTS idx_resellers_session ON public.resellers(session_token) WHERE session_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resellers_prefix ON public.resellers(lower(wa_command_prefix));

ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS reseller_id uuid REFERENCES public.resellers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tokens_reseller ON public.tokens(reseller_id) WHERE reseller_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_resellers_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_resellers_updated_at ON public.resellers;
CREATE TRIGGER trg_resellers_updated_at BEFORE UPDATE ON public.resellers
  FOR EACH ROW EXECUTE FUNCTION public.update_resellers_updated_at();

-- Hash helper using extensions.digest
CREATE OR REPLACE FUNCTION public.hash_reseller_password(_password text, _salt text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT encode(extensions.digest(_salt || ':' || _password, 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.reseller_login(_phone text, _password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  _reseller record; _normalized_phone text; _new_token text; _expires timestamptz;
BEGIN
  _normalized_phone := regexp_replace(_phone, '\D', '', 'g');
  IF _normalized_phone LIKE '0%' THEN
    _normalized_phone := '62' || substring(_normalized_phone from 2);
  ELSIF _normalized_phone LIKE '8%' THEN
    _normalized_phone := '62' || _normalized_phone;
  END IF;

  SELECT * INTO _reseller FROM public.resellers
  WHERE phone = _normalized_phone AND is_active = true LIMIT 1;

  IF _reseller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nomor HP atau sandi salah');
  END IF;
  IF public.hash_reseller_password(_password, _reseller.password_salt) <> _reseller.password_hash THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nomor HP atau sandi salah');
  END IF;

  _new_token := encode(extensions.gen_random_bytes(32), 'hex');
  _expires := now() + interval '30 days';

  UPDATE public.resellers SET session_token = _new_token, session_expires_at = _expires
  WHERE id = _reseller.id;

  RETURN jsonb_build_object(
    'success', true, 'reseller_id', _reseller.id, 'name', _reseller.name,
    'phone', _reseller.phone, 'prefix', _reseller.wa_command_prefix,
    'session_token', _new_token, 'expires_at', _expires
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_reseller_session(_session_token text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _reseller_id uuid;
BEGIN
  IF _session_token IS NULL OR length(_session_token) < 32 THEN RETURN NULL; END IF;
  SELECT id INTO _reseller_id FROM public.resellers
  WHERE session_token = _session_token AND session_expires_at > now() AND is_active = true LIMIT 1;
  RETURN _reseller_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reseller_create_token(
  _session_token text, _show_id uuid, _max_devices integer DEFAULT 1, _duration_days integer DEFAULT 7
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  _reseller_id uuid; _reseller record; _show record;
  _new_code text; _new_token_id uuid; _expires timestamptz; _attempts int := 0; _rate_ok boolean;
BEGIN
  _reseller_id := public.validate_reseller_session(_session_token);
  IF _reseller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid, silakan login ulang');
  END IF;
  SELECT * INTO _reseller FROM public.resellers WHERE id = _reseller_id;

  IF _max_devices < 1 OR _max_devices > 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Jumlah device harus 1-10');
  END IF;
  IF _duration_days < 1 OR _duration_days > 90 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Durasi harus 1-90 hari');
  END IF;

  SELECT * INTO _show FROM public.shows WHERE id = _show_id AND is_active = true LIMIT 1;
  IF _show IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan atau tidak aktif');
  END IF;

  SELECT public.check_rate_limit('reseller_token:' || _reseller_id::text, 50, 3600) INTO _rate_ok;
  IF NOT _rate_ok THEN
    RETURN jsonb_build_object('success', false, 'error', 'Batas 50 token/jam tercapai. Coba lagi nanti.');
  END IF;

  LOOP
    _new_code := 'RSL-' || upper(_reseller.wa_command_prefix) || '-' || upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tokens WHERE code = _new_code);
    _attempts := _attempts + 1;
    IF _attempts > 10 THEN RETURN jsonb_build_object('success', false, 'error', 'Gagal generate kode unik'); END IF;
  END LOOP;

  _expires := now() + (_duration_days || ' days')::interval;

  INSERT INTO public.tokens (code, show_id, status, max_devices, expires_at, duration_type, reseller_id, is_public)
  VALUES (_new_code, _show_id, 'active', _max_devices, _expires, 'custom', _reseller_id, false)
  RETURNING id INTO _new_token_id;

  RETURN jsonb_build_object(
    'success', true, 'token_id', _new_token_id, 'code', _new_code,
    'show_title', _show.title, 'expires_at', _expires, 'max_devices', _max_devices
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reseller_list_my_tokens(_session_token text, _limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _reseller_id uuid; _result jsonb;
BEGIN
  _reseller_id := public.validate_reseller_session(_session_token);
  IF _reseller_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid'); END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', t.id, 'code', t.code, 'show_id', t.show_id, 'show_title', s.title,
    'status', t.status, 'max_devices', t.max_devices,
    'expires_at', t.expires_at, 'created_at', t.created_at
  ) ORDER BY t.created_at DESC) INTO _result
  FROM public.tokens t LEFT JOIN public.shows s ON s.id = t.show_id
  WHERE t.reseller_id = _reseller_id LIMIT _limit;

  RETURN jsonb_build_object('success', true, 'tokens', COALESCE(_result, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.reseller_get_active_shows(_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _reseller_id uuid; _result jsonb;
BEGIN
  _reseller_id := public.validate_reseller_session(_session_token);
  IF _reseller_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid'); END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', s.id, 'title', s.title, 'price', s.price,
    'schedule_date', s.schedule_date, 'schedule_time', s.schedule_time,
    'lineup', s.lineup, 'team', s.team, 'category', s.category,
    'is_replay', s.is_replay, 'is_subscription', s.is_subscription, 'is_bundle', s.is_bundle,
    'access_password', s.access_password,
    'bundle_replay_info', s.bundle_replay_info,
    'bundle_replay_passwords', s.bundle_replay_passwords,
    'background_image_url', s.background_image_url, 'short_id', s.short_id
  ) ORDER BY s.created_at DESC) INTO _result
  FROM public.shows s WHERE s.is_active = true;

  RETURN jsonb_build_object('success', true, 'shows', COALESCE(_result, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.reseller_logout(_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.resellers SET session_token = NULL, session_expires_at = NULL
  WHERE session_token = _session_token;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reseller_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _result jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'reseller_id', r.id, 'name', r.name, 'phone', r.phone,
    'prefix', r.wa_command_prefix, 'is_active', r.is_active,
    'created_at', r.created_at, 'notes', r.notes,
    'total_tokens', COALESCE(tt.cnt, 0),
    'per_show', COALESCE(tt.per_show, '[]'::jsonb)
  ) ORDER BY r.created_at DESC) INTO _result
  FROM public.resellers r
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt,
      jsonb_agg(jsonb_build_object('show_id', show_id, 'show_title', show_title, 'count', cnt) ORDER BY cnt DESC) AS per_show
    FROM (
      SELECT t.show_id, s.title AS show_title, COUNT(*) AS cnt
      FROM public.tokens t LEFT JOIN public.shows s ON s.id = t.show_id
      WHERE t.reseller_id = r.id GROUP BY t.show_id, s.title
    ) sub
  ) tt ON true;

  RETURN jsonb_build_object('success', true, 'stats', COALESCE(_result, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_reseller_tokens(_reseller_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _deleted int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  DELETE FROM public.token_sessions
  WHERE token_id IN (SELECT id FROM public.tokens WHERE reseller_id = _reseller_id);

  WITH d AS (DELETE FROM public.tokens WHERE reseller_id = _reseller_id RETURNING 1)
  SELECT count(*) INTO _deleted FROM d;

  RETURN jsonb_build_object('success', true, 'deleted', _deleted);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_reseller(
  _name text, _phone text, _password text, _prefix text, _notes text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  _normalized_phone text; _salt text; _hash text; _new_id uuid; _normalized_prefix text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nama wajib diisi');
  END IF;
  IF length(_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sandi minimal 6 karakter');
  END IF;
  IF _prefix IS NULL OR _prefix !~ '^[A-Za-z]{1,3}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Prefix harus 1-3 huruf');
  END IF;

  _normalized_phone := regexp_replace(_phone, '\D', '', 'g');
  IF _normalized_phone LIKE '0%' THEN _normalized_phone := '62' || substring(_normalized_phone from 2);
  ELSIF _normalized_phone LIKE '8%' THEN _normalized_phone := '62' || _normalized_phone; END IF;
  IF length(_normalized_phone) < 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nomor HP tidak valid');
  END IF;

  _normalized_prefix := upper(_prefix);

  IF EXISTS (SELECT 1 FROM public.resellers WHERE phone = _normalized_phone) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nomor HP sudah terdaftar');
  END IF;
  IF EXISTS (SELECT 1 FROM public.resellers WHERE upper(wa_command_prefix) = _normalized_prefix) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Prefix sudah dipakai');
  END IF;

  _salt := encode(extensions.gen_random_bytes(16), 'hex');
  _hash := public.hash_reseller_password(_password, _salt);

  INSERT INTO public.resellers (name, phone, password_hash, password_salt, wa_command_prefix, notes)
  VALUES (trim(_name), _normalized_phone, _hash, _salt, _normalized_prefix, COALESCE(_notes, ''))
  RETURNING id INTO _new_id;

  RETURN jsonb_build_object('success', true, 'id', _new_id, 'phone', _normalized_phone, 'prefix', _normalized_prefix);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_reseller_password(_reseller_id uuid, _new_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _salt text; _hash text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;
  IF length(_new_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sandi minimal 6 karakter');
  END IF;

  _salt := encode(extensions.gen_random_bytes(16), 'hex');
  _hash := public.hash_reseller_password(_new_password, _salt);

  UPDATE public.resellers
  SET password_salt = _salt, password_hash = _hash,
      session_token = NULL, session_expires_at = NULL
  WHERE id = _reseller_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_reseller_by_phone(_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _normalized text; _r record;
BEGIN
  _normalized := regexp_replace(_phone, '\D', '', 'g');
  IF _normalized LIKE '0%' THEN _normalized := '62' || substring(_normalized from 2);
  ELSIF _normalized LIKE '8%' THEN _normalized := '62' || _normalized; END IF;

  SELECT id, name, phone, wa_command_prefix, is_active INTO _r
  FROM public.resellers WHERE phone = _normalized AND is_active = true LIMIT 1;

  IF _r IS NULL THEN RETURN jsonb_build_object('found', false); END IF;

  RETURN jsonb_build_object('found', true, 'id', _r.id, 'name', _r.name,
    'phone', _r.phone, 'prefix', _r.wa_command_prefix);
END;
$$;

CREATE OR REPLACE FUNCTION public.reseller_create_token_by_id(
  _reseller_id uuid, _show_id uuid, _max_devices integer DEFAULT 1, _duration_days integer DEFAULT 7
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  _reseller record; _show record; _new_code text; _new_token_id uuid;
  _expires timestamptz; _attempts int := 0;
BEGIN
  SELECT * INTO _reseller FROM public.resellers WHERE id = _reseller_id AND is_active = true;
  IF _reseller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan');
  END IF;

  IF _max_devices < 1 OR _max_devices > 10 THEN _max_devices := 1; END IF;
  IF _duration_days < 1 OR _duration_days > 90 THEN _duration_days := 7; END IF;

  SELECT * INTO _show FROM public.shows WHERE id = _show_id AND is_active = true LIMIT 1;
  IF _show IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan');
  END IF;

  LOOP
    _new_code := 'RSL-' || upper(_reseller.wa_command_prefix) || '-' || upper(substring(encode(extensions.gen_random_bytes(4), 'hex') from 1 for 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tokens WHERE code = _new_code);
    _attempts := _attempts + 1;
    IF _attempts > 10 THEN RETURN jsonb_build_object('success', false, 'error', 'Gagal generate kode'); END IF;
  END LOOP;

  _expires := now() + (_duration_days || ' days')::interval;

  INSERT INTO public.tokens (code, show_id, status, max_devices, expires_at, duration_type, reseller_id, is_public)
  VALUES (_new_code, _show_id, 'active', _max_devices, _expires, 'custom', _reseller_id, false)
  RETURNING id INTO _new_token_id;

  RETURN jsonb_build_object(
    'success', true, 'token_id', _new_token_id, 'code', _new_code,
    'show_title', _show.title, 'show_id', _show.id,
    'expires_at', _expires, 'max_devices', _max_devices,
    'access_password', _show.access_password,
    'bundle_replay_info', _show.bundle_replay_info,
    'bundle_replay_passwords', _show.bundle_replay_passwords
  );
END;
$$;