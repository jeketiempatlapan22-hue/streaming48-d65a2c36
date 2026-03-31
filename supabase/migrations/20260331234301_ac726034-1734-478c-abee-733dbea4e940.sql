
-- 1. Add index on token_sessions for faster session lookups during live
CREATE INDEX IF NOT EXISTS idx_token_sessions_token_active 
ON public.token_sessions (token_id, is_active) WHERE (is_active = true);

-- 2. Add index on chat_messages for faster recent message queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_created 
ON public.chat_messages (created_at DESC) WHERE (is_deleted = false);

-- 3. Add index on coin_balances user_id (frequently queried)
CREATE INDEX IF NOT EXISTS idx_coin_balances_user 
ON public.coin_balances (user_id);

-- 4. Optimize get_viewer_count to use index
CREATE INDEX IF NOT EXISTS idx_viewer_counts_last_seen 
ON public.viewer_counts (last_seen_at);

-- 5. Add index on auth_metrics for admin dashboard queries
CREATE INDEX IF NOT EXISTS idx_auth_metrics_created 
ON public.auth_metrics (created_at DESC);

-- 6. Run ANALYZE on frequently accessed tables
ANALYZE public.viewer_counts;
ANALYZE public.token_sessions;
ANALYZE public.tokens;
ANALYZE public.chat_messages;
ANALYZE public.site_settings;
ANALYZE public.streams;
ANALYZE public.coin_balances;
ANALYZE public.subscription_orders;
