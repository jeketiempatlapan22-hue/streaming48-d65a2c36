
-- Fix the self-referencing policy: remove public DELETE entirely
-- Vote changes will work through admin policy for authenticated admins
-- For public users, create an RPC to handle vote changes atomically
DROP POLICY IF EXISTS "Voters can delete own vote" ON public.poll_votes;

-- Create a secure RPC for changing votes
CREATE OR REPLACE FUNCTION public.change_poll_vote(_poll_id uuid, _voter_id text, _new_option_index integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Delete existing vote for this voter on this poll
  DELETE FROM public.poll_votes WHERE poll_id = _poll_id AND voter_id = _voter_id;
  -- Insert new vote
  INSERT INTO public.poll_votes (poll_id, voter_id, option_index)
  VALUES (_poll_id, _voter_id, _new_option_index);
END;
$$;
