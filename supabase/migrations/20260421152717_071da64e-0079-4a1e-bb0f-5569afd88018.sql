
-- Update reseller_get_active_shows: exclude replay shows
CREATE OR REPLACE FUNCTION public.reseller_get_active_shows(_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  FROM public.shows s
  WHERE s.is_active = true
    AND COALESCE(s.is_replay, false) = false;

  RETURN jsonb_build_object('success', true, 'shows', COALESCE(_result, '[]'::jsonb));
END;
$function$;

-- Update reseller_create_token: enforce 1-day duration except membership; reject replay shows
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
  _replay_info JSONB;
  _final_duration INT;
BEGIN
  SELECT * INTO _reseller FROM public.resellers
  WHERE session_token = _session_token
    AND session_expires_at > now()
    AND is_active = true
  LIMIT 1;

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

  -- Reject replay shows
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

  -- Force duration: 1 day for non-membership, custom (1-90) for membership
  IF COALESCE(_show.is_subscription, false) = true THEN
    _final_duration := _duration_days;
  ELSE
    _final_duration := 1;
  END IF;

  LOOP
    _new_code := 'RSL-' || upper(_reseller.wa_command_prefix) || '-' || upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tokens WHERE code = _new_code);
  END LOOP;

  _expires := now() + (_final_duration || ' days')::interval;

  INSERT INTO public.tokens (code, show_id, max_devices, expires_at, status, reseller_id, duration_type)
  VALUES (_new_code, _show.id, _max_devices, _expires, 'active', _reseller.id, 'custom')
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
    'access_password', _show.access_password,
    'show_title', _show.title
  );
END;
$function$;

-- Update reseller_create_token_by_id (WhatsApp path): same rules
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
  _replay_info JSONB;
  _final_duration INT;
BEGIN
  SELECT * INTO _reseller FROM public.resellers
  WHERE id = _reseller_id AND is_active = true
  LIMIT 1;

  IF _reseller.id IS NULL THEN
    INSERT INTO public.reseller_token_audit (source, status, rejection_reason, metadata)
    VALUES ('whatsapp', 'rejected', 'reseller_inactive', jsonb_build_object('reseller_id', _reseller_id, 'show_id', _show_id));
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan / nonaktif.');
  END IF;

  IF _max_devices < 1 OR _max_devices > 10 THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, max_devices)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'invalid_max_devices', _max_devices);
    RETURN jsonb_build_object('success', false, 'error', 'Max device harus 1-10.');
  END IF;

  IF _duration_days < 1 OR _duration_days > 90 THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, duration_days)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'invalid_duration', _duration_days);
    RETURN jsonb_build_object('success', false, 'error', 'Durasi harus 1-90 hari.');
  END IF;

  SELECT * INTO _show FROM public.shows WHERE id = _show_id LIMIT 1;
  IF _show.id IS NULL OR _show.is_active = false THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'show_not_found', _show_id);
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan atau tidak aktif.');
  END IF;

  IF COALESCE(_show.is_replay, false) = true THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'replay_show', _show.id, _show.title);
    RETURN jsonb_build_object('success', false, 'error', 'Tidak dapat membuat token untuk show replay.');
  END IF;

  IF COALESCE(_show.is_bundle, false) = true THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'bundle_show', _show.id, _show.title);
    RETURN jsonb_build_object('success', false, 'error', 'Tidak dapat membuat token untuk show bundle.');
  END IF;

  IF NOT public.check_rate_limit('reseller_token_wa_' || _reseller.id::text, 50, 3600) THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'rate_limit', _show.id, _show.title);
    RETURN jsonb_build_object('success', false, 'error', 'Batas pembuatan token tercapai (50/jam).');
  END IF;

  IF COALESCE(_show.is_subscription, false) = true THEN
    _final_duration := _duration_days;
  ELSE
    _final_duration := 1;
  END IF;

  LOOP
    _new_code := 'RSL-' || upper(_reseller.wa_command_prefix) || '-' || upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tokens WHERE code = _new_code);
  END LOOP;

  _expires := now() + (_final_duration || ' days')::interval;

  INSERT INTO public.tokens (code, show_id, max_devices, expires_at, status, reseller_id, duration_type)
  VALUES (_new_code, _show.id, _max_devices, _expires, 'active', _reseller.id, 'custom')
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
    'expires_at', _expires,
    'access_password', _show.access_password,
    'show_title', _show.title
  );
END;
$function$;
