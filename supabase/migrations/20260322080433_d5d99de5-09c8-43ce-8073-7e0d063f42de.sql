CREATE TABLE public.subscription_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid REFERENCES public.shows(id) ON DELETE CASCADE NOT NULL,
  user_id uuid DEFAULT auth.uid(),
  phone text,
  email text,
  payment_proof_url text,
  payment_method text DEFAULT 'qris',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create subscription orders" ON public.subscription_orders
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can view own subscription orders" ON public.subscription_orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Admins can manage subscription orders" ON public.subscription_orders
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can view order counts" ON public.subscription_orders
  FOR SELECT TO public USING (status = 'confirmed');

CREATE OR REPLACE FUNCTION public.get_order_count(_show_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(COUNT(*)::integer, 0) FROM public.subscription_orders
  WHERE show_id = _show_id AND status = 'confirmed';
$$;

CREATE OR REPLACE FUNCTION public.redeem_coins_for_membership(_show_id uuid, _phone text, _email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  s RECORD;
  bal INTEGER;
BEGIN
  SELECT * INTO s FROM public.shows WHERE id = _show_id AND is_active = true AND is_subscription = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Membership tidak ditemukan');
  END IF;
  IF s.coin_price <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Membership tidak bisa dibeli dengan koin');
  END IF;
  SELECT balance INTO bal FROM public.coin_balances WHERE user_id = auth.uid();
  IF bal IS NULL OR bal < s.coin_price THEN
    RETURN jsonb_build_object('success', false, 'error', 'Koin tidak cukup');
  END IF;
  UPDATE public.coin_balances SET balance = balance - s.coin_price, updated_at = now() WHERE user_id = auth.uid();
  INSERT INTO public.subscription_orders (show_id, user_id, phone, email, payment_method, status)
  VALUES (_show_id, auth.uid(), _phone, _email, 'coin', 'confirmed');
  RETURN jsonb_build_object('success', true, 'group_link', s.group_link, 'remaining_balance', bal - s.coin_price);
END;
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.subscription_orders;