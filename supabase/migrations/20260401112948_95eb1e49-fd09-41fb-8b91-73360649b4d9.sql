
-- Fix: Extend stale session cleanup from 6 hours to 12 hours
-- This prevents users from being kicked during 7+ hour streams
CREATE OR REPLACE FUNCTION public.create_token_session(_token_code text, _fingerprint text, _user_agent text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD;
  active_count INTEGER;
  existing RECORD;
  effective_max INTEGER;
BEGIN
  SELECT * INTO t FROM public.tokens WHERE code = _token_code AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token tidak valid');
  END IF;

  IF t.expires_at IS NOT NULL AND t.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token telah kedaluwarsa');
  END IF;

  IF COALESCE(t.is_public, false) = true THEN
    RETURN jsonb_build_object('success', true, 'public', true);
  END IF;

  effective_max := GREATEST(COALESCE(t.max_devices, 1), 1);

  PERFORM pg_advisory_xact_lock(hashtextextended(t.id::text, 0));

  -- Extended from 6h to 12h for long streaming sessions (7+ hours)
  UPDATE public.token_sessions
  SET is_active = false
  WHERE token_id = t.id
    AND is_active = true
    AND last_seen_at < now() - interval '12 hours';

  SELECT * INTO existing
  FROM public.token_sessions
  WHERE token_id = t.id AND fingerprint = _fingerprint AND is_active = true
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.token_sessions
    SET last_seen_at = now(), user_agent = _user_agent
    WHERE id = existing.id;
    RETURN jsonb_build_object('success', true);
  END IF;

  SELECT COUNT(*) INTO active_count
  FROM public.token_sessions
  WHERE token_id = t.id AND is_active = true;

  IF active_count >= effective_max THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'device_limit',
      'max_devices', effective_max,
      'active_devices', active_count
    );
  END IF;

  INSERT INTO public.token_sessions (token_id, fingerprint, user_agent)
  VALUES (t.id, _fingerprint, _user_agent);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Add composite indexes for high-traffic queries
CREATE INDEX IF NOT EXISTS idx_token_sessions_token_active ON public.token_sessions (token_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_token_sessions_fingerprint ON public.token_sessions (token_id, fingerprint, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tokens_code_status ON public.tokens (code, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_viewer_counts_last_seen ON public.viewer_counts (last_seen_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_recent ON public.chat_messages (created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_subscription_orders_short_id ON public.subscription_orders (short_id);
CREATE INDEX IF NOT EXISTS idx_coin_orders_short_id ON public.coin_orders (short_id);
CREATE INDEX IF NOT EXISTS idx_subscription_orders_gateway ON public.subscription_orders (payment_gateway_order_id) WHERE payment_gateway_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coin_orders_gateway ON public.coin_orders (payment_gateway_order_id) WHERE payment_gateway_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_password_reset_status ON public.password_reset_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_token ON public.password_reset_requests (secure_token) WHERE secure_token IS NOT NULL AND status = 'approved';
CREATE INDEX IF NOT EXISTS idx_user_bans_active ON public.user_bans (user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_playlists_active ON public.playlists (is_active, sort_order) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_streams_active ON public.streams (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_site_settings_key ON public.site_settings (key);
