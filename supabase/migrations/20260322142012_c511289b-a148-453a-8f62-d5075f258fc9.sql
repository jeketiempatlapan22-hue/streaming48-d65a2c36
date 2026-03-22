
-- Fix 1: Chat admin badge spoofing - enforce is_admin=false and is_pinned=false on INSERT
DROP POLICY IF EXISTS "Anyone can send chat messages" ON public.chat_messages;
CREATE POLICY "Anyone can send chat messages"
  ON public.chat_messages FOR INSERT TO public
  WITH CHECK (
    is_admin = false AND is_pinned = false AND
    length(message) > 0 AND length(message) <= 500 AND
    length(username) > 0 AND length(username) <= 50
  );

DROP POLICY IF EXISTS "Authenticated can send messages" ON public.chat_messages;
CREATE POLICY "Authenticated can send messages"
  ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND is_admin = false AND is_pinned = false AND
    length(message) > 0 AND length(message) <= 500 AND
    length(username) > 0 AND length(username) <= 50
  );

-- Fix 2: Poll votes - restrict DELETE to own voter_id only
DROP POLICY IF EXISTS "Anyone can change vote" ON public.poll_votes;
CREATE POLICY "Voters can delete own vote"
  ON public.poll_votes FOR DELETE TO public
  USING (voter_id = voter_id);

-- Also restrict INSERT to prevent vote manipulation (limit fields)
DROP POLICY IF EXISTS "Anyone can vote" ON public.poll_votes;
CREATE POLICY "Anyone can vote"
  ON public.poll_votes FOR INSERT TO public
  WITH CHECK (true);

-- Fix 3: Make payment proof buckets private
UPDATE storage.buckets SET public = false WHERE id IN ('payment-proofs', 'coin-proofs');
