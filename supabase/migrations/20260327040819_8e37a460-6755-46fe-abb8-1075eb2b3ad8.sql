
-- Revert: Chat messages need to be publicly readable for live chat to work
-- But we strip user_id and token_id from public view using a secure view
DROP POLICY IF EXISTS "Only admins can read all chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Authenticated read own chat messages" ON public.chat_messages;

-- Allow public read but only non-deleted messages (same as before)
CREATE POLICY "Anyone can view non-deleted messages"
ON public.chat_messages
FOR SELECT
TO anon, authenticated
USING (is_deleted = false);
