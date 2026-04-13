
-- 1. Add bundle columns to shows
ALTER TABLE public.shows ADD COLUMN IF NOT EXISTS is_bundle boolean NOT NULL DEFAULT false;
ALTER TABLE public.shows ADD COLUMN IF NOT EXISTS bundle_description text;
ALTER TABLE public.shows ADD COLUMN IF NOT EXISTS bundle_duration_days integer NOT NULL DEFAULT 30;
ALTER TABLE public.shows ADD COLUMN IF NOT EXISTS bundle_replay_passwords jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.shows ADD COLUMN IF NOT EXISTS bundle_replay_info text;

-- 2. Auto-reset function for long token sessions
CREATE OR REPLACE FUNCTION public.auto_reset_long_token_sessions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.token_sessions 
  WHERE is_active = true 
  AND token_id IN (
    SELECT id FROM public.tokens 
    WHERE status = 'active' 
    AND created_at < now() - interval '3 days'
  );
END; $$;

-- 3. Enable pg_cron and pg_net
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 4. Update get_public_shows to include bundle columns
CREATE OR REPLACE FUNCTION public.get_public_shows()
 RETURNS SETOF shows
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    id, title, price, lineup, schedule_date, schedule_time,
    background_image_url, qris_image_url, is_subscription, max_subscribers,
    subscription_benefits, group_link, is_order_closed, category, category_member,
    coin_price, replay_coin_price, is_replay,
    NULL::text as access_password,
    is_active, created_at, updated_at,
    qris_price,
    membership_duration_days,
    short_id,
    external_show_id,
    replay_qris_price,
    team,
    is_bundle,
    bundle_description,
    bundle_duration_days,
    NULL::jsonb as bundle_replay_passwords,
    bundle_replay_info
  FROM public.shows WHERE is_active = true ORDER BY created_at DESC;
$function$;

-- 5. Update confirm_regular_order to use bundle_duration_days
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

  new_code := 'ORD-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

  -- Bundle shows use bundle_duration_days
  IF s.is_bundle = true AND s.bundle_duration_days > 0 THEN
    _expires_at := now() + (s.bundle_duration_days || ' days')::interval;
  ELSIF s.schedule_date IS NOT NULL AND s.schedule_date != '' THEN
    _show_dt := public.parse_show_datetime(s.schedule_date, COALESCE(s.schedule_time, '23.59 WIB'));
    IF _show_dt IS NOT NULL THEN
      _expires_at := date_trunc('day', _show_dt AT TIME ZONE 'Asia/Jakarta') + interval '23 hours 59 minutes 59 seconds';
      _expires_at := _expires_at AT TIME ZONE 'Asia/Jakarta';
      IF _expires_at < now() THEN
        _expires_at := now() + interval '24 hours';
      END IF;
    ELSE
      _expires_at := now() + interval '24 hours';
    END IF;
  ELSE
    _expires_at := now() + interval '24 hours';
  END IF;

  INSERT INTO public.tokens (code, show_id, user_id, max_devices, expires_at)
  VALUES (new_code, o.show_id, o.user_id, 1, _expires_at);

  RETURN jsonb_build_object(
    'success', true,
    'type', 'regular',
    'token_code', new_code,
    'expires_at', _expires_at
  );
END;
$function$;

-- 6. Update redeem_coins_for_token to use bundle_duration_days
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

  new_code := 'COIN-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

  -- Bundle shows use bundle_duration_days
  IF s.is_bundle = true AND s.bundle_duration_days > 0 THEN
    _expires_at := now() + (s.bundle_duration_days || ' days')::interval;
  ELSIF s.schedule_date IS NOT NULL AND s.schedule_date != '' THEN
    _show_dt := public.parse_show_datetime(s.schedule_date, COALESCE(s.schedule_time, '23.59 WIB'));
    IF _show_dt IS NOT NULL THEN
      _expires_at := date_trunc('day', _show_dt AT TIME ZONE 'Asia/Jakarta') + interval '23 hours 59 minutes 59 seconds';
      _expires_at := _expires_at AT TIME ZONE 'Asia/Jakarta';
      IF _expires_at < now() THEN
        _expires_at := now() + interval '24 hours';
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

  INSERT INTO public.tokens (code, show_id, user_id, max_devices, expires_at)
  VALUES (new_code, _show_id, auth.uid(), 1, _expires_at);

  INSERT INTO public.subscription_orders (show_id, user_id, payment_method, status, payment_status)
  VALUES (_show_id, auth.uid(), 'coin', 'confirmed', 'paid');

  RETURN jsonb_build_object(
    'success', true,
    'token_code', new_code,
    'remaining_balance', bal - price,
    'access_password', s.access_password,
    'expires_at', _expires_at
  );
END;
$function$;

-- 7. Update self_reset_token_session to block multi-device tokens
CREATE OR REPLACE FUNCTION public.self_reset_token_session(_token_code text, _fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD; _allowed boolean;
BEGIN
  SELECT * INTO t FROM public.tokens WHERE code = _token_code AND status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Token tidak valid'); END IF;

  -- Block self-reset for multi-device tokens (max_devices > 5)
  IF t.max_devices > 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token multi-device tidak bisa di-reset sendiri. Hubungi admin.');
  END IF;

  SELECT public.check_rate_limit('self_reset:' || _token_code, 2, 86400) INTO _allowed;
  IF NOT _allowed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Batas reset tercapai (2x per 24 jam). Coba lagi nanti.');
  END IF;

  DELETE FROM public.token_sessions WHERE token_id = t.id AND is_active = true;

  INSERT INTO public.token_sessions (token_id, fingerprint, user_agent)
  VALUES (t.id, _fingerprint, '');

  RETURN jsonb_build_object('success', true);
END; $function$;
