
-- 1. Tambah kolom valid_from
ALTER TABLE public.tokens ADD COLUMN IF NOT EXISTS valid_from timestamptz;
CREATE INDEX IF NOT EXISTS idx_tokens_valid_from ON public.tokens(valid_from);

-- 2. Backfill: hanya untuk token non-universal yang punya show_id dan show punya jadwal
UPDATE public.tokens t
SET valid_from = public.parse_show_datetime(s.schedule_date, s.schedule_time)
FROM public.shows s
WHERE t.show_id = s.id
  AND t.valid_from IS NULL
  AND s.schedule_date IS NOT NULL AND s.schedule_date <> ''
  AND s.schedule_time IS NOT NULL AND s.schedule_time <> ''
  AND COALESCE(s.is_subscription, false) = false
  AND COALESCE(s.is_bundle, false) = false
  AND upper(coalesce(t.code,'')) NOT LIKE 'MBR-%'
  AND upper(coalesce(t.code,'')) NOT LIKE 'MRD-%'
  AND upper(coalesce(t.code,'')) NOT LIKE 'BDL-%'
  AND upper(coalesce(t.code,'')) NOT LIKE 'RT48-%';

-- 3. validate_token: enforce valid_from
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
  token_s RECORD;
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

  -- BLOK: Token belum aktif (valid_from di masa depan) untuk token non-universal
  IF NOT _is_universal AND t.valid_from IS NOT NULL AND t.valid_from > now() THEN
    SELECT title, schedule_date, schedule_time INTO token_s FROM public.shows WHERE id = t.show_id;
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Token belum aktif. Token kamu hanya bisa digunakan sesuai jadwal show.',
      'token_not_started', true,
      'starts_at', t.valid_from,
      'token_show_id', t.show_id,
      'token_show_title', COALESCE(token_s.title, ''),
      'token_show_date', COALESCE(token_s.schedule_date, ''),
      'token_show_time', COALESCE(token_s.schedule_time, '')
    );
  END IF;

  -- HARD-BLOCK: Token non-universal hanya boleh akses show miliknya
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
    'valid_from', t.valid_from,
    'created_at', t.created_at,
    'status', t.status,
    'show_id', t.show_id,
    'is_bundle', _is_bundle,
    'is_membership', _is_membership,
    'is_universal', _is_universal
  );
END;
$function$;

-- 4. reseller_create_token: anchor ke jadwal show
CREATE OR REPLACE FUNCTION public.reseller_create_token(_session_token text, _show_id uuid, _max_devices integer DEFAULT 1, _duration_days integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _reseller RECORD;
  _show RECORD;
  _new_code TEXT;
  _new_token_id UUID;
  _expires TIMESTAMPTZ;
  _valid_from TIMESTAMPTZ;
  _schedule_ts TIMESTAMPTZ;
  _replay_info JSONB;
  _final_duration INT;
  _is_membership BOOLEAN;
  _duration_type TEXT;
BEGIN
  SELECT * INTO _reseller FROM public.resellers
  WHERE session_token = _session_token AND session_expires_at > now() AND is_active = true LIMIT 1;
  IF _reseller.id IS NULL THEN
    INSERT INTO public.reseller_token_audit (source, status, rejection_reason, metadata)
    VALUES ('web', 'rejected', 'invalid_session', jsonb_build_object('show_id', _show_id));
    RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid atau sudah berakhir.');
  END IF;

  IF _max_devices < 1 OR _max_devices > 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Max device harus 1-10.');
  END IF;
  IF _duration_days < 1 OR _duration_days > 90 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Durasi harus 1-90 hari.');
  END IF;

  SELECT * INTO _show FROM public.shows WHERE id = _show_id LIMIT 1;
  IF _show.id IS NULL OR _show.is_active = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan atau tidak aktif.');
  END IF;
  IF COALESCE(_show.is_replay, false) = true THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak dapat membuat token untuk show replay.');
  END IF;
  IF COALESCE(_show.is_bundle, false) = true THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak dapat membuat token untuk show bundle.');
  END IF;

  IF NOT public.check_rate_limit('reseller_token_' || _reseller.id::text, 50, 3600) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Batas pembuatan token tercapai (50/jam).');
  END IF;

  _is_membership := COALESCE(_show.is_subscription, false);

  IF _is_membership THEN
    _final_duration := GREATEST(1, COALESCE(_show.membership_duration_days, 30));
    _duration_type := 'membership';
  ELSE
    _final_duration := 1;
    _duration_type := 'custom';
    -- WAJIB: show non-membership harus punya jadwal lengkap
    _schedule_ts := public.parse_show_datetime(_show.schedule_date, _show.schedule_time);
    IF _schedule_ts IS NULL THEN
      INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
      VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'show_no_schedule', _show.id, _show.title);
      RETURN jsonb_build_object('success', false, 'error', 'Show belum punya jadwal lengkap (tanggal & jam). Token tidak dapat dibuat.');
    END IF;
  END IF;

  LOOP
    IF _is_membership THEN
      _new_code := 'MBR-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12));
    ELSE
      _new_code := 'RSL-' || upper(_reseller.wa_command_prefix) || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));
    END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tokens WHERE code = _new_code);
  END LOOP;

  IF _is_membership THEN
    _valid_from := NULL;
    _expires := now() + (_final_duration || ' days')::interval;
  ELSE
    -- Anchor ke jadwal: kalau jadwal di masa depan, valid_from = jadwal; kalau lewat, valid_from = NULL (langsung aktif)
    IF _schedule_ts > now() THEN
      _valid_from := _schedule_ts;
      _expires := _schedule_ts + (_final_duration || ' days')::interval;
    ELSE
      _valid_from := NULL;
      _expires := now() + (_final_duration || ' days')::interval;
    END IF;
  END IF;

  INSERT INTO public.tokens (code, show_id, max_devices, expires_at, valid_from, status, reseller_id, duration_type)
  VALUES (_new_code, _show.id, _max_devices, _expires, _valid_from, 'active', _reseller.id, _duration_type)
  RETURNING id INTO _new_token_id;

  _replay_info := jsonb_build_object(
    'has_replay', _show.access_password IS NOT NULL,
    'access_password', _show.access_password,
    'replay_link', 'https://replaytime.lovable.app'
  );

  IF _max_devices > 1 THEN
    INSERT INTO public.admin_notifications (type, title, message)
    VALUES ('reseller_multidevice', '⚠️ Token Multi-Device Reseller',
            'Reseller "' || _reseller.name || '" membuat token ' || _new_code || ' (' || _show.title || ') dengan ' || _max_devices || ' device.');
  END IF;

  INSERT INTO public.reseller_token_audit (
    reseller_id, reseller_name, reseller_prefix, source, show_id, show_title,
    token_id, token_code, max_devices, duration_days, status, replay_info
  ) VALUES (
    _reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', _show.id, _show.title,
    _new_token_id, _new_code, _max_devices, _final_duration, 'success', _replay_info
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', _new_code,
    'token_id', _new_token_id,
    'expires_at', _expires,
    'valid_from', _valid_from,
    'access_password', _show.access_password,
    'show_title', _show.title,
    'is_membership', _is_membership,
    'duration_days', _final_duration
  );
END;
$function$;

-- 5. reseller_create_token_by_id (varian WhatsApp): sama
CREATE OR REPLACE FUNCTION public.reseller_create_token_by_id(_reseller_id uuid, _show_id uuid, _max_devices integer DEFAULT 1, _duration_days integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _reseller RECORD;
  _show RECORD;
  _new_code TEXT;
  _new_token_id UUID;
  _expires TIMESTAMPTZ;
  _valid_from TIMESTAMPTZ;
  _schedule_ts TIMESTAMPTZ;
  _replay_info JSONB;
  _final_duration INT;
  _is_membership BOOLEAN;
  _duration_type TEXT;
BEGIN
  SELECT * INTO _reseller FROM public.resellers WHERE id = _reseller_id AND is_active = true LIMIT 1;
  IF _reseller.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan / nonaktif.');
  END IF;
  IF _max_devices < 1 OR _max_devices > 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Max device harus 1-10.');
  END IF;
  IF _duration_days < 1 OR _duration_days > 90 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Durasi harus 1-90 hari.');
  END IF;

  SELECT * INTO _show FROM public.shows WHERE id = _show_id LIMIT 1;
  IF _show.id IS NULL OR _show.is_active = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan atau tidak aktif.');
  END IF;
  IF COALESCE(_show.is_replay, false) = true THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tidak dapat membuat token untuk show replay.');
  END IF;
  IF COALESCE(_show.is_bundle, false) = true THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tidak dapat membuat token untuk show bundle.');
  END IF;
  IF NOT public.check_rate_limit('reseller_token_wa_' || _reseller.id::text, 50, 3600) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Batas pembuatan token tercapai (50/jam).');
  END IF;

  _is_membership := COALESCE(_show.is_subscription, false);

  IF _is_membership THEN
    _final_duration := GREATEST(1, COALESCE(_show.membership_duration_days, 30));
    _duration_type := 'membership';
  ELSE
    _final_duration := 1;
    _duration_type := 'custom';
    _schedule_ts := public.parse_show_datetime(_show.schedule_date, _show.schedule_time);
    IF _schedule_ts IS NULL THEN
      INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
      VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'show_no_schedule', _show.id, _show.title);
      RETURN jsonb_build_object('success', false, 'error', 'Show belum punya jadwal lengkap (tanggal & jam). Token tidak dapat dibuat.');
    END IF;
  END IF;

  LOOP
    IF _is_membership THEN
      _new_code := 'MBR-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12));
    ELSE
      _new_code := 'RSL-' || upper(_reseller.wa_command_prefix) || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));
    END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tokens WHERE code = _new_code);
  END LOOP;

  IF _is_membership THEN
    _valid_from := NULL;
    _expires := now() + (_final_duration || ' days')::interval;
  ELSE
    IF _schedule_ts > now() THEN
      _valid_from := _schedule_ts;
      _expires := _schedule_ts + (_final_duration || ' days')::interval;
    ELSE
      _valid_from := NULL;
      _expires := now() + (_final_duration || ' days')::interval;
    END IF;
  END IF;

  INSERT INTO public.tokens (code, show_id, max_devices, expires_at, valid_from, status, reseller_id, duration_type)
  VALUES (_new_code, _show.id, _max_devices, _expires, _valid_from, 'active', _reseller.id, _duration_type)
  RETURNING id INTO _new_token_id;

  _replay_info := jsonb_build_object(
    'has_replay', _show.access_password IS NOT NULL,
    'access_password', _show.access_password,
    'replay_link', 'https://replaytime.lovable.app'
  );

  IF _max_devices > 1 THEN
    INSERT INTO public.admin_notifications (type, title, message)
    VALUES ('reseller_multidevice', '⚠️ Token Multi-Device Reseller (WA)',
            'Reseller "' || _reseller.name || '" via WA membuat token ' || _new_code || ' (' || _show.title || ') dengan ' || _max_devices || ' device.');
  END IF;

  INSERT INTO public.reseller_token_audit (
    reseller_id, reseller_name, reseller_prefix, source, show_id, show_title,
    token_id, token_code, max_devices, duration_days, status, replay_info
  ) VALUES (
    _reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', _show.id, _show.title,
    _new_token_id, _new_code, _max_devices, _final_duration, 'success', _replay_info
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', _new_code,
    'token_id', _new_token_id,
    'show_title', _show.title,
    'expires_at', _expires,
    'valid_from', _valid_from,
    'access_password', _show.access_password,
    'replay_info', _replay_info,
    'is_membership', _is_membership,
    'duration_days', _final_duration
  );
END;
$function$;

-- 6. confirm_regular_order: set valid_from
CREATE OR REPLACE FUNCTION public.confirm_regular_order(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  s RECORD;
  new_code TEXT;
  _expires_at TIMESTAMPTZ;
  _valid_from TIMESTAMPTZ;
  _show_dt TIMESTAMPTZ;
BEGIN
  SELECT * INTO o FROM public.subscription_orders WHERE id = _order_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order tidak ditemukan atau sudah diproses');
  END IF;

  UPDATE public.subscription_orders SET status = 'confirmed' WHERE id = _order_id;

  SELECT * INTO s FROM public.shows WHERE id = o.show_id;
  IF NOT FOUND OR s.is_subscription = true THEN
    RETURN jsonb_build_object('success', true, 'type', 'subscription');
  END IF;

  IF s.is_bundle = true THEN
    new_code := 'BDL-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  ELSE
    new_code := 'ORD-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  END IF;

  _valid_from := NULL;

  IF s.is_bundle = true AND s.bundle_duration_days > 0 THEN
    _expires_at := now() + (s.bundle_duration_days || ' days')::interval;
  ELSIF s.schedule_date IS NOT NULL AND s.schedule_date != '' THEN
    _show_dt := public.parse_show_datetime(s.schedule_date, COALESCE(s.schedule_time, '23.59 WIB'));
    IF _show_dt IS NOT NULL THEN
      _expires_at := date_trunc('day', _show_dt AT TIME ZONE 'Asia/Jakarta') + interval '23 hours 59 minutes 59 seconds';
      _expires_at := _expires_at AT TIME ZONE 'Asia/Jakarta';
      IF _expires_at < now() THEN
        _expires_at := now() + interval '24 hours';
        _valid_from := NULL;
      ELSE
        -- valid_from = jadwal show (kalau di masa depan)
        IF _show_dt > now() THEN
          _valid_from := _show_dt;
        END IF;
      END IF;
    ELSE
      _expires_at := now() + interval '24 hours';
    END IF;
  ELSE
    _expires_at := now() + interval '24 hours';
  END IF;

  INSERT INTO public.tokens (code, show_id, user_id, max_devices, expires_at, valid_from)
  VALUES (new_code, o.show_id, o.user_id, 1, _expires_at, _valid_from);

  RETURN jsonb_build_object(
    'success', true,
    'type', 'regular',
    'token_code', new_code,
    'expires_at', _expires_at,
    'valid_from', _valid_from
  );
END;
$function$;

-- 7. redeem_coins_for_token: set valid_from
CREATE OR REPLACE FUNCTION public.redeem_coins_for_token(_show_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s RECORD;
  bal INTEGER;
  new_code TEXT;
  price INTEGER;
  _expires_at TIMESTAMPTZ;
  _valid_from TIMESTAMPTZ;
  _show_dt TIMESTAMPTZ;
BEGIN
  SELECT * INTO s FROM public.shows WHERE id = _show_id AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan');
  END IF;

  price := CASE WHEN s.is_replay THEN s.replay_coin_price ELSE s.coin_price END;
  IF price <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak bisa dibeli dengan koin');
  END IF;

  SELECT balance INTO bal FROM public.coin_balances WHERE user_id = auth.uid();
  IF bal IS NULL OR bal < price THEN
    RETURN jsonb_build_object('success', false, 'error', 'Koin tidak cukup. Butuh ' || price || ' koin.');
  END IF;

  IF s.is_bundle = true THEN
    new_code := 'BDL-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  ELSE
    new_code := 'COIN-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  END IF;

  _valid_from := NULL;

  IF s.is_bundle = true AND s.bundle_duration_days > 0 THEN
    _expires_at := now() + (s.bundle_duration_days || ' days')::interval;
  ELSIF s.schedule_date IS NOT NULL AND s.schedule_date != '' THEN
    _show_dt := public.parse_show_datetime(s.schedule_date, COALESCE(s.schedule_time, '23.59 WIB'));
    IF _show_dt IS NOT NULL THEN
      _expires_at := date_trunc('day', _show_dt AT TIME ZONE 'Asia/Jakarta') + interval '23 hours 59 minutes 59 seconds';
      _expires_at := _expires_at AT TIME ZONE 'Asia/Jakarta';
      IF _expires_at < now() THEN
        _expires_at := now() + interval '24 hours';
      ELSE
        IF _show_dt > now() THEN
          _valid_from := _show_dt;
        END IF;
      END IF;
    ELSE
      _expires_at := now() + interval '24 hours';
    END IF;
  ELSE
    _expires_at := now() + interval '24 hours';
  END IF;

  UPDATE public.coin_balances SET balance = balance - price, updated_at = now() WHERE user_id = auth.uid();

  INSERT INTO public.coin_transactions (user_id, amount, type, reference_id, description)
  VALUES (auth.uid(), -price, 'redeem', _show_id::text, 'Tukar koin untuk ' || s.title);

  INSERT INTO public.tokens (code, show_id, user_id, max_devices, expires_at, valid_from)
  VALUES (new_code, _show_id, auth.uid(), 1, _expires_at, _valid_from);

  INSERT INTO public.subscription_orders (show_id, user_id, payment_method, status, payment_status)
  VALUES (_show_id, auth.uid(), 'coin', 'confirmed', 'paid');

  RETURN jsonb_build_object(
    'success', true,
    'token_code', new_code,
    'remaining_balance', bal - price,
    'access_password', s.access_password,
    'expires_at', _expires_at,
    'valid_from', _valid_from
  );
END;
$function$;
