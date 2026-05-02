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
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, max_devices)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'invalid_max_devices', _max_devices);
    RETURN jsonb_build_object('success', false, 'error', 'Max device harus 1-10.');
  END IF;
  IF _duration_days < 1 OR _duration_days > 90 THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, duration_days)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'invalid_duration', _duration_days);
    RETURN jsonb_build_object('success', false, 'error', 'Durasi harus 1-90 hari.');
  END IF;

  SELECT * INTO _show FROM public.shows WHERE id = _show_id LIMIT 1;
  IF _show.id IS NULL OR _show.is_active = false THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'show_not_found', _show_id);
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan atau tidak aktif.');
  END IF;
  IF COALESCE(_show.is_replay, false) = true THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'replay_show', _show.id, _show.title);
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak dapat membuat token untuk show replay.');
  END IF;
  IF COALESCE(_show.is_bundle, false) = true THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'bundle_show', _show.id, _show.title);
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak dapat membuat token untuk show bundle.');
  END IF;

  IF NOT public.check_rate_limit('reseller_token_' || _reseller.id::text, 50, 3600) THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'rate_limit', _show.id, _show.title);
    RETURN jsonb_build_object('success', false, 'error', 'Batas pembuatan token tercapai (50/jam).');
  END IF;

  _is_membership := COALESCE(_show.is_subscription, false);

  IF _is_membership THEN
    _final_duration := GREATEST(1, COALESCE(_show.membership_duration_days, 30));
    _duration_type := 'membership';
  ELSE
    -- Non-membership: token valid sampai 14 hari setelah jadwal show,
    -- sehingga otomatis berlanjut sebagai akses replay tanpa beli ulang.
    _final_duration := 14;
    _duration_type := 'replay_window';
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
    IF _schedule_ts > now() THEN
      -- Show belum mulai: cegah dipakai sebelum jadwal, expire 14 hari setelah jadwal.
      _valid_from := _schedule_ts;
      _expires := _schedule_ts + (_final_duration || ' days')::interval;
    ELSE
      -- Show sudah lewat / sedang live: token aktif sekarang,
      -- tetap dapat 14 hari window dihitung dari jadwal show.
      _valid_from := NULL;
      _expires := GREATEST(now(), _schedule_ts) + (_final_duration || ' days')::interval;
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