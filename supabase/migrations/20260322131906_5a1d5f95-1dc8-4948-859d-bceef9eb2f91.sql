
-- Performance indexes for token_sessions lookups
CREATE INDEX IF NOT EXISTS idx_token_sessions_active_lookup 
ON public.token_sessions (token_id, is_active, fingerprint, last_seen_at) 
WHERE is_active = true;

-- Prevent duplicate active sessions for same fingerprint on same token
CREATE UNIQUE INDEX IF NOT EXISTS idx_token_sessions_unique_active_fp
ON public.token_sessions (token_id, fingerprint)
WHERE is_active = true;
