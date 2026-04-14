
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

  IF s.is_bundle = true THEN
    new_code := 'BDL-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  ELSE
    new_code := 'COIN-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  END IF;

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

  IF s.is_bundle = true THEN
    new_code := 'BDL-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  ELSE
    new_code := 'ORD-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  END IF;

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
