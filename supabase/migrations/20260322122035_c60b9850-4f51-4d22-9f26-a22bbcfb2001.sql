-- Allow anonymous/public users to insert chat messages (token-based viewers)
CREATE POLICY "Anyone can send chat messages"
ON public.chat_messages
FOR INSERT
TO public
WITH CHECK (true);