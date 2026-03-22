
-- 1. Update get_public_shows to hide access_password (correct column order)
CREATE OR REPLACE FUNCTION public.get_public_shows()
 RETURNS SETOF shows
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT 
    id, title, price, lineup, schedule_date, schedule_time,
    background_image_url, qris_image_url, is_subscription, max_subscribers,
    subscription_benefits, group_link, is_order_closed, category, category_member,
    coin_price, replay_coin_price, is_replay,
    NULL::text as access_password,
    is_active, created_at, updated_at
  FROM public.shows WHERE is_active = true ORDER BY created_at DESC;
$$;

-- 2. Secure rate_limits table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rate_limits' AND policyname = 'Only service role can access rate_limits') THEN
    CREATE POLICY "Only service role can access rate_limits" ON public.rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rate_limits' AND policyname = 'Block public access to rate_limits') THEN
    CREATE POLICY "Block public access to rate_limits" ON public.rate_limits FOR ALL TO public USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rate_limits' AND policyname = 'Block authenticated access to rate_limits') THEN
    CREATE POLICY "Block authenticated access to rate_limits" ON public.rate_limits FOR ALL TO authenticated USING (false);
  END IF;
END $$;

-- 3. Tighten chat_messages INSERT
DROP POLICY IF EXISTS "Anyone can send chat messages" ON public.chat_messages;
CREATE POLICY "Anyone can send chat messages" ON public.chat_messages
  FOR INSERT TO public
  WITH CHECK (length(message) > 0 AND length(message) <= 500 AND length(username) > 0 AND length(username) <= 50);

-- 4. Performance indexes
CREATE INDEX IF NOT EXISTS idx_token_sessions_active_lookup ON public.token_sessions (token_id, is_active, fingerprint) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_coin_transactions_user ON public.coin_transactions (user_id, type);
CREATE INDEX IF NOT EXISTS idx_coin_orders_status ON public.coin_orders (status, user_id);
