-- RLS policies for telegram tables (service_role only via admin)
CREATE POLICY "Service role only" ON public.telegram_bot_state FOR ALL TO service_role USING (true);
CREATE POLICY "Service role only" ON public.telegram_messages FOR ALL TO service_role USING (true);