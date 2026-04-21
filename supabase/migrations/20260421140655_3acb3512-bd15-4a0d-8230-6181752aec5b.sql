
-- 1) Block bundle shows + admin notification for multi-device in reseller_create_token (web)
CREATE OR REPLACE FUNCTION public.reseller_create_token(_session_token text, _show_id uuid, _max_devices integer DEFAULT 1, _duration_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  -- Block bundle shows for resellers
  IF COALESCE(_show.is_bundle, false) = true THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show bundle tidak dapat dibuat token oleh reseller');
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

  -- Notify admin if multi-device (>1)
  IF _max_devices > 1 THEN
    INSERT INTO public.admin_notifications (type, title, message)
    VALUES (
      'reseller_multidevice',
      '⚠️ Token Multi-Device Reseller',
      'Reseller "' || _reseller.name || '" (/' || upper(_reseller.wa_command_prefix) || 'token via web) membuat token ' || _new_code ||
      ' untuk show "' || _show.title || '" dengan ' || _max_devices || ' device (durasi ' || _duration_days || ' hari).'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'token_id', _new_token_id, 'code', _new_code,
    'show_title', _show.title, 'expires_at', _expires, 'max_devices', _max_devices,
    'access_password', _show.access_password
  );
END;
$function$;

-- 2) Block bundle + admin notification in reseller_create_token_by_id (WhatsApp bot)
CREATE OR REPLACE FUNCTION public.reseller_create_token_by_id(_reseller_id uuid, _show_id uuid, _max_devices integer DEFAULT 1, _duration_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  -- Block bundle shows for resellers (also via WhatsApp bot)
  IF COALESCE(_show.is_bundle, false) = true THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show bundle tidak dapat dibuat token oleh reseller');
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

  -- Notify admin if multi-device (>1)
  IF _max_devices > 1 THEN
    INSERT INTO public.admin_notifications (type, title, message)
    VALUES (
      'reseller_multidevice',
      '⚠️ Token Multi-Device Reseller (WA)',
      'Reseller "' || _reseller.name || '" (/' || upper(_reseller.wa_command_prefix) || 'token via WhatsApp) membuat token ' || _new_code ||
      ' untuk show "' || _show.title || '" dengan ' || _max_devices || ' device (durasi ' || _duration_days || ' hari).'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'token_id', _new_token_id, 'code', _new_code,
    'show_title', _show.title, 'show_id', _show.id,
    'expires_at', _expires, 'max_devices', _max_devices,
    'access_password', _show.access_password
  );
END;
$function$;
