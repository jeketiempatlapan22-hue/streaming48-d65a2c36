ALTER TABLE public.replay_access_tokens 
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');