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

  IF s.schedule_date IS NOT NULL AND s.schedule_date != '' THEN
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