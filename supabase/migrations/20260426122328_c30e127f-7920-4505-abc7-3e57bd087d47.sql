-- Standardize replay token duration to 14 days for coin redemption
CREATE OR REPLACE FUNCTION public.redeem_coins_for_replay(_show_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _show RECORD; _balance INTEGER; _code text; _expires timestamptz; _duration_days int := 14;
BEGIN
  SELECT * INTO _show FROM public.shows WHERE id = _show_id AND is_active = true;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Show tidak ditemukan'); END IF;
  IF _show.replay_coin_price <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Replay tidak tersedia untuk show ini');
  END IF;

  SELECT cb.balance INTO _balance FROM public.coin_balances cb WHERE cb.user_id = auth.uid();
  IF _balance IS NULL OR _balance < _show.replay_coin_price THEN
    RETURN json_build_object('success', false, 'error', 'Koin tidak cukup');
  END IF;

  UPDATE public.coin_balances SET balance = balance - _show.replay_coin_price, updated_at = now()
    WHERE user_id = auth.uid();
  INSERT INTO public.coin_transactions (user_id, amount, type, reference_id, description)
    VALUES (auth.uid(), -_show.replay_coin_price, 'replay_redeem', _show_id::text,
            'Tukar koin untuk replay ' || _show.title);

  _code := 'RPL-' || upper(substring(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 8));
  _expires := now() + (_duration_days || ' days')::interval;
  INSERT INTO public.replay_tokens (code, show_id, password, expires_at, created_via, user_id)
    VALUES (_code, _show.id, _show.access_password, _expires, 'coin', auth.uid());

  RETURN json_build_object(
    'success', true,
    'replay_password', _show.access_password,
    'replay_token', _code,
    'expires_at', _expires,
    'remaining_balance', _balance - _show.replay_coin_price
  );
END $function$;