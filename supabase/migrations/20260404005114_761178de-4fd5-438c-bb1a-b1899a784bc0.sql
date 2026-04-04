
-- 1. Add membership_duration_days column to shows
ALTER TABLE public.shows ADD COLUMN IF NOT EXISTS membership_duration_days integer NOT NULL DEFAULT 30;

-- 2. Create confirm_membership_order RPC
CREATE OR REPLACE FUNCTION public.confirm_membership_order(_order_id uuid)
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
  _confirmed_count INTEGER;
  _membership_enabled TEXT;
BEGIN
  -- Get the order
  SELECT * INTO o FROM public.subscription_orders WHERE id = _order_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order tidak ditemukan atau sudah diproses');
  END IF;

  -- Get the show
  SELECT * INTO s FROM public.shows WHERE id = o.show_id;
  IF NOT FOUND OR s.is_subscription = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show bukan membership');
  END IF;

  -- Check quota
  SELECT COUNT(*)::integer INTO _confirmed_count
  FROM public.subscription_orders
  WHERE show_id = o.show_id AND status = 'confirmed';

  IF s.max_subscribers > 0 AND _confirmed_count >= s.max_subscribers THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kuota membership penuh');
  END IF;

  -- Update order status
  UPDATE public.subscription_orders SET status = 'confirmed', payment_status = 'paid' WHERE id = _order_id;

  -- Check if membership token feature is enabled
  SELECT value INTO _membership_enabled FROM public.site_settings WHERE key = 'membership_token_enabled';
  IF COALESCE(_membership_enabled, 'true') = 'true' THEN
    -- Generate membership token
    new_code := 'MBR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    _expires_at := now() + (COALESCE(s.membership_duration_days, 30) || ' days')::interval;

    INSERT INTO public.tokens (code, show_id, user_id, max_devices, expires_at, duration_type)
    VALUES (new_code, o.show_id, o.user_id, 1, _expires_at, 'membership');

    RETURN jsonb_build_object(
      'success', true,
      'token_code', new_code,
      'expires_at', _expires_at,
      'duration_days', COALESCE(s.membership_duration_days, 30),
      'access_password', s.access_password,
      'group_link', s.group_link
    );
  ELSE
    RETURN jsonb_build_object('success', true, 'type', 'membership_no_token');
  END IF;
END;
$function$;

-- 3. Update redeem_coins_for_membership to include quota check + token generation
CREATE OR REPLACE FUNCTION public.redeem_coins_for_membership(_show_id uuid, _phone text, _email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s RECORD;
  bal INTEGER;
  _confirmed_count INTEGER;
  new_code TEXT;
  _expires_at TIMESTAMPTZ;
  _membership_enabled TEXT;
BEGIN
  SELECT * INTO s FROM public.shows WHERE id = _show_id AND is_active = true AND is_subscription = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Membership tidak ditemukan');
  END IF;
  IF s.coin_price <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Membership tidak bisa dibeli dengan koin');
  END IF;

  -- Check quota
  SELECT COUNT(*)::integer INTO _confirmed_count
  FROM public.subscription_orders
  WHERE show_id = _show_id AND status = 'confirmed';

  IF s.max_subscribers > 0 AND _confirmed_count >= s.max_subscribers THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kuota membership sudah penuh');
  END IF;

  SELECT balance INTO bal FROM public.coin_balances WHERE user_id = auth.uid();
  IF bal IS NULL OR bal < s.coin_price THEN
    RETURN jsonb_build_object('success', false, 'error', 'Koin tidak cukup');
  END IF;

  -- Deduct coins
  UPDATE public.coin_balances SET balance = balance - s.coin_price, updated_at = now() WHERE user_id = auth.uid();

  -- Log transaction
  INSERT INTO public.coin_transactions (user_id, amount, type, reference_id, description)
  VALUES (auth.uid(), -s.coin_price, 'membership_redeem', _show_id::text, 'Tukar koin untuk membership ' || s.title);

  -- Create order
  INSERT INTO public.subscription_orders (show_id, user_id, phone, email, payment_method, status, payment_status)
  VALUES (_show_id, auth.uid(), _phone, _email, 'coin', 'confirmed', 'paid');

  -- Check if membership token feature is enabled
  SELECT value INTO _membership_enabled FROM public.site_settings WHERE key = 'membership_token_enabled';
  IF COALESCE(_membership_enabled, 'true') = 'true' THEN
    new_code := 'MBR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    _expires_at := now() + (COALESCE(s.membership_duration_days, 30) || ' days')::interval;

    INSERT INTO public.tokens (code, show_id, user_id, max_devices, expires_at, duration_type)
    VALUES (new_code, _show_id, auth.uid(), 1, _expires_at, 'membership');

    RETURN jsonb_build_object(
      'success', true,
      'token_code', new_code,
      'expires_at', _expires_at,
      'duration_days', COALESCE(s.membership_duration_days, 30),
      'group_link', s.group_link,
      'access_password', s.access_password,
      'remaining_balance', bal - s.coin_price
    );
  ELSE
    RETURN jsonb_build_object('success', true, 'group_link', s.group_link, 'remaining_balance', bal - s.coin_price);
  END IF;
END;
$function$;
