-- 1. Optimize viewer_heartbeat: remove piggyback cleanup (causes 2000 DELETE scans/min at scale)
CREATE OR REPLACE FUNCTION public.viewer_heartbeat(_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.viewer_counts (viewer_key, last_seen_at)
  VALUES (_key, now())
  ON CONFLICT (viewer_key) DO UPDATE SET last_seen_at = now();
END;
$function$;

-- 2. Add missing index on subscription_orders for user lookups
CREATE INDEX IF NOT EXISTS idx_sub_orders_user_status ON public.subscription_orders (user_id, status);

-- 3. Add missing index on password_reset_requests for user pending checks
CREATE INDEX IF NOT EXISTS idx_pw_reset_user_status ON public.password_reset_requests (user_id, status);

-- 4. Add index on user_bans for fast ban checks
CREATE INDEX IF NOT EXISTS idx_user_bans_active ON public.user_bans (user_id) WHERE (is_active = true);

-- 5. Add index on tokens show_id for show-based lookups
CREATE INDEX IF NOT EXISTS idx_tokens_show_id ON public.tokens (show_id) WHERE (status = 'active');

-- 6. Run ANALYZE on hot tables
ANALYZE public.viewer_counts;
ANALYZE public.token_sessions;
ANALYZE public.tokens;
ANALYZE public.chat_messages;
ANALYZE public.site_settings;
ANALYZE public.streams;