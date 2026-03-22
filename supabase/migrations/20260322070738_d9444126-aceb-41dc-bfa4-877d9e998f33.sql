
-- Fix permissive RLS: chat_messages INSERT should require authenticated user_id
DROP POLICY "Authenticated can send messages" ON public.chat_messages;
CREATE POLICY "Authenticated can send messages" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
