
CREATE OR REPLACE FUNCTION public.redeem_coins_for_replay(_show_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _show RECORD; _balance INTEGER;
BEGIN
  SELECT * INTO _show FROM public.shows WHERE id = _show_id AND is_active = true;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Show tidak ditemukan'); END IF;
  IF _show.replay_coin_price <= 0 THEN RETURN json_build_object('success', false, 'error', 'Replay tidak tersedia untuk show ini'); END IF;
  
  SELECT cb.balance INTO _balance FROM public.coin_balances cb WHERE cb.user_id = auth.uid();
  IF _balance IS NULL OR _balance < _show.replay_coin_price THEN 
    RETURN json_build_object('success', false, 'error', 'Koin tidak cukup'); 
  END IF;
  
  UPDATE public.coin_balances SET balance = balance - _show.replay_coin_price, updated_at = now() WHERE user_id = auth.uid();
  INSERT INTO public.coin_transactions (user_id, amount, type, reference_id, description)
  VALUES (auth.uid(), -_show.replay_coin_price, 'replay_redeem', _show_id::text, 'Tukar koin untuk replay ' || _show.title);
  
  RETURN json_build_object(
    'success', true,
    'replay_password', _show.access_password,
    'remaining_balance', _balance - _show.replay_coin_price
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.get_purchased_show_passwords()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result json;
BEGIN
  SELECT json_object_agg(s.id::text, s.access_password) INTO _result
  FROM public.shows s
  WHERE s.is_active = true
    AND s.access_password != ''
    AND s.id::text IN (
      SELECT DISTINCT ct.reference_id 
      FROM public.coin_transactions ct 
      WHERE ct.user_id = auth.uid() 
        AND ct.type IN ('redeem', 'replay_redeem')
        AND ct.reference_id IS NOT NULL
    );
  
  RETURN COALESCE(_result, '{}'::json);
END;
$function$;
