-- 1) Trigger function: when a token is inserted for a membership show
--    via bot (no user_id, i.e. created by admin/reseller bot, OR reseller_id set),
--    auto-create an anonymous confirmed subscription_orders row.
CREATE OR REPLACE FUNCTION public.auto_create_anon_membership_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _show RECORD;
  _short TEXT;
  _method TEXT;
BEGIN
  -- Only act on tokens that are tied to a show
  IF NEW.show_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, is_subscription INTO _show
  FROM public.shows
  WHERE id = NEW.show_id
  LIMIT 1;

  -- Only for membership shows
  IF _show.id IS NULL OR COALESCE(_show.is_subscription, false) = false THEN
    RETURN NEW;
  END IF;

  -- Skip if token belongs to a real user (purchase flow handles its own order row)
  IF NEW.user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Distinguish source
  IF NEW.reseller_id IS NOT NULL THEN
    _method := 'reseller_bot';
    _short  := 'RB-' || upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 6));
  ELSE
    _method := 'admin_bot';
    _short  := 'AB-' || upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 6));
  END IF;

  INSERT INTO public.subscription_orders (
    show_id, user_id, phone, email,
    status, payment_status, payment_method,
    short_id, created_at
  ) VALUES (
    NEW.show_id, NULL, NULL, NULL,
    'confirmed', 'confirmed', _method,
    _short, now()
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block token creation if order insert fails
  RETURN NEW;
END;
$$;

-- Lock down execution
REVOKE EXECUTE ON FUNCTION public.auto_create_anon_membership_order() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.auto_create_anon_membership_order() TO service_role, postgres;

-- 2) Attach trigger
DROP TRIGGER IF EXISTS trg_auto_create_anon_membership_order ON public.tokens;
CREATE TRIGGER trg_auto_create_anon_membership_order
AFTER INSERT ON public.tokens
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_anon_membership_order();

-- 3) Remove the now-duplicate INSERT inside reseller_create_token_by_id
--    The trigger above will handle it uniformly for both admin and reseller bots.
CREATE OR REPLACE FUNCTION public.reseller_create_token_by_id(
  _reseller_id uuid,
  _show_id uuid,
  _max_devices integer DEFAULT 1,
  _duration_days integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _reseller RECORD;
  _show RECORD;
  _new_code TEXT;
  _new_token_id UUID;
  _expires TIMESTAMPTZ;
  _schedule_ts TIMESTAMPTZ;
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
    _new_code := 'RSL-' || upper(_reseller.wa_command_prefix) || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tokens WHERE code = _new_code);
  END LOOP;

  _schedule_ts := public.parse_show_datetime(_show.schedule_date, _show.schedule_time);
  IF _schedule_ts IS NOT NULL AND _schedule_ts > now() THEN
    _expires := _schedule_ts + (_final_duration || ' days')::interval;
  ELSE
    _expires := now() + (_final_duration || ' days')::interval;
  END IF;

  -- The trigger trg_auto_create_anon_membership_order will create
  -- an anonymous subscription_orders row automatically for membership shows.
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
    'show_title', _show.title,
    'expires_at', _expires,
    'access_password', _show.access_password,
    'replay_info', _replay_info
  );
END;
$function$;

-- Re-apply locked-down grants for the recreated function
REVOKE EXECUTE ON FUNCTION public.reseller_create_token_by_id(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reseller_create_token_by_id(uuid, uuid, integer, integer) TO service_role;