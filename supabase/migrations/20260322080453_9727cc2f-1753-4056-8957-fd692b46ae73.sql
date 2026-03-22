DROP POLICY "Users can create subscription orders" ON public.subscription_orders;
CREATE POLICY "Users can create own subscription orders" ON public.subscription_orders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());