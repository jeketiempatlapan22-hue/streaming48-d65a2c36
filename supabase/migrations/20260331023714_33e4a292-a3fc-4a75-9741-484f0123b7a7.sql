
-- Performance indexes for 1000 concurrent viewers

-- chat_messages: speed up realtime queries and cleanup
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_is_deleted ON public.chat_messages (is_deleted) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_chat_messages_is_pinned ON public.chat_messages (is_pinned) WHERE is_pinned = true;

-- viewer_counts: speed up heartbeat upsert and cleanup
CREATE INDEX IF NOT EXISTS idx_viewer_counts_last_seen ON public.viewer_counts (last_seen_at);

-- token_sessions: speed up session lookups
CREATE INDEX IF NOT EXISTS idx_token_sessions_token_active ON public.token_sessions (token_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_token_sessions_fingerprint ON public.token_sessions (token_id, fingerprint) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_token_sessions_last_seen ON public.token_sessions (last_seen_at) WHERE is_active = true;

-- tokens: speed up validate_token lookups
CREATE INDEX IF NOT EXISTS idx_tokens_code ON public.tokens (code);
CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON public.tokens (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_status ON public.tokens (status) WHERE status = 'active';

-- rate_limits: speed up check_rate_limit
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON public.rate_limits (key);

-- streams: speed up get_stream_status
CREATE INDEX IF NOT EXISTS idx_streams_active ON public.streams (is_active) WHERE is_active = true;

-- playlists: speed up get_safe_playlists
CREATE INDEX IF NOT EXISTS idx_playlists_active_sort ON public.playlists (sort_order) WHERE is_active = true;

-- profiles: speed up username lookups
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles (username) WHERE username IS NOT NULL;

-- subscription_orders: speed up order count queries  
CREATE INDEX IF NOT EXISTS idx_sub_orders_show_status ON public.subscription_orders (show_id, status);

-- coin_orders: speed up pending order queries
CREATE INDEX IF NOT EXISTS idx_coin_orders_status ON public.coin_orders (status) WHERE status = 'pending';

-- security_events: speed up recent event queries
CREATE INDEX IF NOT EXISTS idx_security_events_created ON public.security_events (created_at DESC);

-- user_bans: speed up ban checks
CREATE INDEX IF NOT EXISTS idx_user_bans_active ON public.user_bans (user_id) WHERE is_active = true;
