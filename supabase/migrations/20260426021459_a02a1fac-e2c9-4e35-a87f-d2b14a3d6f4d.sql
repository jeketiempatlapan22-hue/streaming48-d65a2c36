-- Drop the existing function so we can recreate with extended return type
DROP FUNCTION IF EXISTS public.get_public_shows();

-- 1. Columns
ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS replay_m3u8_url text,
  ADD COLUMN IF NOT EXISTS replay_youtube_url text,
  ADD COLUMN IF NOT EXISTS replay_month text;

-- 2. replay_tokens
CREATE TABLE IF NOT EXISTS public.replay_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  show_id uuid,
  password text,
  expires_at timestamptz,
  created_via text NOT NULL DEFAULT 'manual',
  user_id uuid,
  phone text,
  status text NOT NULL DEFAULT 'active',
  source_token_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_replay_tokens_code ON public.replay_tokens(code);
CREATE INDEX IF NOT EXISTS idx_replay_tokens_show ON public.replay_tokens(show_id);
CREATE INDEX IF NOT EXISTS idx_replay_tokens_user ON public.replay_tokens(user_id);
ALTER TABLE public.replay_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage replay tokens" ON public.replay_tokens;
CREATE POLICY "Admins manage replay tokens" ON public.replay_tokens
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Service role full access replay tokens" ON public.replay_tokens;
CREATE POLICY "Service role full access replay tokens" ON public.replay_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon cannot read replay tokens" ON public.replay_tokens;
CREATE POLICY "Anon cannot read replay tokens" ON public.replay_tokens FOR SELECT TO anon USING (false);
DROP POLICY IF EXISTS "Users view own replay tokens" ON public.replay_tokens;
CREATE POLICY "Users view own replay tokens" ON public.replay_tokens FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 3. replay_token_sessions
CREATE TABLE IF NOT EXISTS public.replay_token_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_code text NOT NULL,
  fingerprint text NOT NULL,
  user_agent text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_replay_sessions_token ON public.replay_token_sessions(token_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_sessions_active
  ON public.replay_token_sessions(token_code) WHERE is_active = true;
ALTER TABLE public.replay_token_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage replay sessions" ON public.replay_token_sessions;
CREATE POLICY "Admins manage replay sessions" ON public.replay_token_sessions
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Service role full access replay sessions" ON public.replay_token_sessions;
CREATE POLICY "Service role full access replay sessions" ON public.replay_token_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public no read replay sessions" ON public.replay_token_sessions;
CREATE POLICY "Public no read replay sessions" ON public.replay_token_sessions FOR SELECT TO anon USING (false);

-- 4. New get_public_shows
CREATE FUNCTION public.get_public_shows()
RETURNS TABLE(
  id uuid, title text, price text, lineup text, schedule_date text, schedule_time text,
  background_image_url text, qris_image_url text, is_subscription boolean, max_subscribers integer,
  subscription_benefits text, group_link text, is_order_closed boolean, category text, category_member text,
  coin_price integer, replay_coin_price integer, is_replay boolean,
  access_password text, is_active boolean, created_at timestamptz, updated_at timestamptz,
  qris_price integer, membership_duration_days integer, short_id text, external_show_id text,
  replay_qris_price integer, team text, is_bundle boolean, bundle_description text,
  bundle_duration_days integer, bundle_replay_passwords jsonb, bundle_replay_info text,
  has_replay_media boolean, replay_month text, replay_youtube_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    s.id, s.title, s.price, s.lineup, s.schedule_date, s.schedule_time,
    s.background_image_url, s.qris_image_url, s.is_subscription, s.max_subscribers,
    s.subscription_benefits, s.group_link, s.is_order_closed, s.category, s.category_member,
    s.coin_price, s.replay_coin_price, s.is_replay,
    NULL::text as access_password,
    s.is_active, s.created_at, s.updated_at,
    s.qris_price, s.membership_duration_days, s.short_id, s.external_show_id,
    s.replay_qris_price, s.team, s.is_bundle, s.bundle_description,
    s.bundle_duration_days, NULL::jsonb as bundle_replay_passwords, s.bundle_replay_info,
    (COALESCE(NULLIF(s.replay_m3u8_url,''), NULLIF(s.replay_youtube_url,'')) IS NOT NULL) AS has_replay_media,
    s.replay_month,
    s.replay_youtube_url
  FROM public.shows s
  WHERE s.is_active = true
  ORDER BY s.created_at DESC;
$$;

-- 5. validate_replay_access
CREATE OR REPLACE FUNCTION public.validate_replay_access(
  _token text DEFAULT NULL,
  _password text DEFAULT NULL,
  _show_id uuid DEFAULT NULL,
  _short_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _show RECORD;
  _rt RECORD;
  _global_pw text;
  _month text;
  _live_token RECORD;
BEGIN
  IF _show_id IS NOT NULL THEN
    SELECT * INTO _show FROM public.shows WHERE id = _show_id LIMIT 1;
  ELSIF _short_id IS NOT NULL THEN
    SELECT * INTO _show FROM public.shows WHERE lower(short_id) = lower(_short_id) LIMIT 1;
  END IF;

  IF _token IS NOT NULL AND length(trim(_token)) >= 4 THEN
    SELECT * INTO _rt FROM public.replay_tokens
      WHERE code = _token AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1;

    IF FOUND THEN
      IF _rt.show_id IS NOT NULL THEN
        SELECT * INTO _show FROM public.shows WHERE id = _rt.show_id LIMIT 1;
      END IF;

      IF _show.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan');
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'access_via', 'replay_token',
        'token_code', _rt.code,
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url,
        'youtube_url', _show.replay_youtube_url,
        'expires_at', _rt.expires_at,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;

    SELECT t.* INTO _live_token FROM public.tokens t
      WHERE t.code = _token AND t.status = 'active'
        AND (t.expires_at IS NULL OR t.expires_at > now())
      LIMIT 1;

    IF FOUND AND _live_token.show_id IS NOT NULL THEN
      SELECT * INTO _show FROM public.shows WHERE id = _live_token.show_id LIMIT 1;
      IF _show.id IS NOT NULL AND _show.is_replay THEN
        RETURN jsonb_build_object(
          'success', true,
          'access_via', 'live_token_upgrade',
          'token_code', _live_token.code,
          'show_id', _show.id, 'show_title', _show.title,
          'm3u8_url', _show.replay_m3u8_url,
          'youtube_url', _show.replay_youtube_url,
          'expires_at', _live_token.expires_at,
          'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
        );
      END IF;
    END IF;
  END IF;

  IF _show.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan');
  END IF;

  IF _password IS NOT NULL AND _show.access_password IS NOT NULL
     AND _show.access_password <> '' AND _password = _show.access_password THEN
    RETURN jsonb_build_object(
      'success', true,
      'access_via', 'show_password',
      'show_id', _show.id, 'show_title', _show.title,
      'm3u8_url', _show.replay_m3u8_url,
      'youtube_url', _show.replay_youtube_url,
      'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
    );
  END IF;

  IF _password IS NOT NULL THEN
    _month := COALESCE(NULLIF(_show.replay_month,''), to_char(now(), 'YYYY-MM'));
    SELECT value INTO _global_pw FROM public.site_settings
      WHERE key = 'replay_global_password__' || _month LIMIT 1;
    IF _global_pw IS NULL OR _global_pw = '' THEN
      SELECT value INTO _global_pw FROM public.site_settings
        WHERE key = 'replay_global_password_default' LIMIT 1;
    END IF;
    IF _global_pw IS NOT NULL AND _global_pw <> '' AND _password = _global_pw THEN
      RETURN jsonb_build_object(
        'success', true,
        'access_via', 'global_password',
        'global_month', _month,
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url,
        'youtube_url', _show.replay_youtube_url,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Sandi atau token tidak valid');
END $$;

-- 6. Replay sessions (single device lock)
CREATE OR REPLACE FUNCTION public.create_replay_session(
  _token_code text, _fingerprint text, _user_agent text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _existing RECORD;
BEGIN
  IF _token_code IS NULL OR length(trim(_token_code)) < 4 THEN
    RETURN jsonb_build_object('success', true, 'note', 'no token, no lock');
  END IF;
  IF _fingerprint IS NULL OR length(trim(_fingerprint)) < 6 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Fingerprint tidak valid');
  END IF;

  SELECT * INTO _existing FROM public.replay_token_sessions
    WHERE token_code = _token_code AND is_active = true LIMIT 1;

  IF FOUND THEN
    IF _existing.fingerprint = _fingerprint THEN
      UPDATE public.replay_token_sessions
        SET last_seen_at = now(), user_agent = COALESCE(_user_agent, user_agent)
        WHERE id = _existing.id;
      RETURN jsonb_build_object('success', true, 'reused', true);
    ELSE
      RETURN jsonb_build_object('success', false,
        'error', 'locked',
        'message', 'Token sedang aktif di perangkat lain.');
    END IF;
  END IF;

  INSERT INTO public.replay_token_sessions(token_code, fingerprint, user_agent)
    VALUES (_token_code, _fingerprint, COALESCE(_user_agent, ''));
  RETURN jsonb_build_object('success', true, 'created', true);
END $$;

CREATE OR REPLACE FUNCTION public.self_reset_replay_session(
  _token_code text, _fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _allowed boolean;
BEGIN
  IF _token_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token tidak valid');
  END IF;

  SELECT public.check_rate_limit('replay_reset:' || _token_code, 3, 86400) INTO _allowed;
  IF NOT _allowed THEN
    RETURN jsonb_build_object('success', false,
      'error', 'limit',
      'message', 'Batas reset tercapai (3x per 24 jam). Coba lagi nanti.');
  END IF;

  UPDATE public.replay_token_sessions SET is_active = false
    WHERE token_code = _token_code AND is_active = true;

  IF _fingerprint IS NOT NULL AND length(trim(_fingerprint)) >= 6 THEN
    INSERT INTO public.replay_token_sessions(token_code, fingerprint, user_agent)
      VALUES (_token_code, _fingerprint, '');
  END IF;

  RETURN jsonb_build_object('success', true);
END $$;

-- 7. Updated redeem_coins_for_replay
CREATE OR REPLACE FUNCTION public.redeem_coins_for_replay(_show_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _show RECORD; _balance INTEGER; _code text; _expires timestamptz; _duration_days int := 7;
BEGIN
  SELECT * INTO _show FROM public.shows WHERE id = _show_id AND is_active = true;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Show tidak ditemukan'); END IF;
  IF _show.replay_coin_price <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Replay tidak tersedia untuk show ini');
  END IF;

  SELECT cb.balance INTO _balance FROM public.coin_balances cb WHERE cb.user_id = auth.uid();
  IF _balance IS NULL OR _balance < _show.replay_coin_price THEN
    RETURN json_build_object('success', false, 'error', 'Koin tidak cukup');
  END IF;

  UPDATE public.coin_balances SET balance = balance - _show.replay_coin_price, updated_at = now()
    WHERE user_id = auth.uid();
  INSERT INTO public.coin_transactions (user_id, amount, type, reference_id, description)
    VALUES (auth.uid(), -_show.replay_coin_price, 'replay_redeem', _show_id::text,
            'Tukar koin untuk replay ' || _show.title);

  _code := 'RPL-' || upper(substring(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 8));
  _expires := now() + (_duration_days || ' days')::interval;
  INSERT INTO public.replay_tokens (code, show_id, password, expires_at, created_via, user_id)
    VALUES (_code, _show.id, _show.access_password, _expires, 'coin', auth.uid());

  RETURN json_build_object(
    'success', true,
    'replay_password', _show.access_password,
    'replay_token', _code,
    'expires_at', _expires,
    'remaining_balance', _balance - _show.replay_coin_price
  );
END $$;

-- 8. Trigger: migrate live tokens when show flips to is_replay
CREATE OR REPLACE FUNCTION public.migrate_tokens_on_replay_flip()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _t RECORD;
BEGIN
  IF NEW.is_replay = true AND COALESCE(OLD.is_replay, false) = false THEN
    IF NEW.replay_month IS NULL OR NEW.replay_month = '' THEN
      NEW.replay_month := to_char(now(), 'YYYY-MM');
    END IF;

    FOR _t IN
      SELECT * FROM public.tokens
       WHERE show_id = NEW.id AND status = 'active'
         AND (expires_at IS NULL OR expires_at > now())
    LOOP
      INSERT INTO public.replay_tokens(code, show_id, password, expires_at, created_via, user_id, source_token_code)
        VALUES (_t.code, NEW.id, NEW.access_password, _t.expires_at, 'live_upgrade', _t.user_id, _t.code)
      ON CONFLICT (code) DO NOTHING;
      DELETE FROM public.tokens WHERE id = _t.id;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_migrate_tokens_on_replay_flip ON public.shows;
CREATE TRIGGER trg_migrate_tokens_on_replay_flip
  BEFORE UPDATE ON public.shows
  FOR EACH ROW EXECUTE FUNCTION public.migrate_tokens_on_replay_flip();

-- 9. Helper RPCs
CREATE OR REPLACE FUNCTION public.get_my_replay_tokens()
RETURNS TABLE(code text, show_id uuid, password text, expires_at timestamptz, created_via text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT code, show_id, password, expires_at, created_via
  FROM public.replay_tokens
  WHERE user_id = auth.uid() AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_replay_tokens()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.replay_token_sessions
    WHERE last_seen_at < now() - interval '24 hours';
  UPDATE public.replay_tokens SET status = 'expired'
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now();
END $$;