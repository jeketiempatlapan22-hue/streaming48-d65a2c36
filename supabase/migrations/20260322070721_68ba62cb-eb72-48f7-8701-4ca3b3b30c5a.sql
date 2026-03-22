
-- Profiles table for viewer accounts
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Shows table (tickets/events)
CREATE TABLE public.shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  price TEXT NOT NULL DEFAULT 'Gratis',
  lineup TEXT,
  schedule_date TEXT,
  schedule_time TEXT,
  background_image_url TEXT,
  qris_image_url TEXT,
  is_subscription BOOLEAN NOT NULL DEFAULT false,
  max_subscribers INTEGER NOT NULL DEFAULT 0,
  subscription_benefits TEXT,
  group_link TEXT,
  is_order_closed BOOLEAN NOT NULL DEFAULT false,
  category TEXT DEFAULT 'regular',
  category_member TEXT,
  coin_price INTEGER NOT NULL DEFAULT 0,
  replay_coin_price INTEGER NOT NULL DEFAULT 0,
  is_replay BOOLEAN NOT NULL DEFAULT false,
  access_password TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active shows" ON public.shows FOR SELECT TO public USING (is_active = true);
CREATE POLICY "Admins can manage shows" ON public.shows FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Tokens for access control
CREATE TABLE public.tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  show_id UUID REFERENCES public.shows(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'expired')),
  max_devices INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage tokens" ON public.tokens FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view own tokens" ON public.tokens FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Token sessions (device tracking)
CREATE TABLE public.token_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID REFERENCES public.tokens(id) ON DELETE CASCADE NOT NULL,
  fingerprint TEXT NOT NULL,
  user_agent TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.token_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage sessions" ON public.token_sessions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Coin balances
CREATE TABLE public.coin_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coin_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own balance" ON public.coin_balances FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins can manage balances" ON public.coin_balances FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Coin packages (for coin shop)
CREATE TABLE public.coin_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  coin_amount INTEGER NOT NULL,
  price TEXT NOT NULL,
  qris_image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coin_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active packages" ON public.coin_packages FOR SELECT TO public USING (is_active = true);
CREATE POLICY "Admins can manage packages" ON public.coin_packages FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Coin orders
CREATE TABLE public.coin_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  package_id UUID REFERENCES public.coin_packages(id) ON DELETE SET NULL,
  coin_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  payment_proof_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coin_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own orders" ON public.coin_orders FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can create orders" ON public.coin_orders FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins can manage orders" ON public.coin_orders FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Site settings (key-value)
CREATE TABLE public.site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL DEFAULT ''
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view settings" ON public.site_settings FOR SELECT TO public USING (true);
CREATE POLICY "Admins can manage settings" ON public.site_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Insert default settings
INSERT INTO public.site_settings (key, value) VALUES
  ('site_title', 'RealTime48 Streaming'),
  ('whatsapp_number', ''),
  ('purchase_message', ''),
  ('whatsapp_channel', ''),
  ('subscription_info', ''),
  ('announcement_text', ''),
  ('announcement_enabled', 'false');

-- Chat messages for live streaming
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  message TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view messages" ON public.chat_messages FOR SELECT TO public USING (is_deleted = false);
CREATE POLICY "Authenticated can send messages" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Admins can manage messages" ON public.chat_messages FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Playlists (multiple stream sources for live page)
CREATE TABLE public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'm3u8' CHECK (type IN ('m3u8', 'cloudflare', 'youtube')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active playlists" ON public.playlists FOR SELECT TO public USING (is_active = true);
CREATE POLICY "Admins can manage playlists" ON public.playlists FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Add is_live column to streams table
ALTER TABLE public.streams ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT false;

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.streams;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coin_balances;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shows;

-- RPC: validate token
CREATE OR REPLACE FUNCTION public.validate_token(_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
BEGIN
  SELECT * INTO t FROM public.tokens WHERE code = _code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token tidak ditemukan');
  END IF;
  IF t.status = 'blocked' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token telah diblokir');
  END IF;
  IF t.status = 'expired' OR (t.expires_at IS NOT NULL AND t.expires_at < now()) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token telah kedaluwarsa');
  END IF;
  RETURN jsonb_build_object(
    'valid', true,
    'id', t.id,
    'code', t.code,
    'max_devices', t.max_devices,
    'expires_at', t.expires_at,
    'status', t.status
  );
END;
$$;

-- RPC: create token session
CREATE OR REPLACE FUNCTION public.create_token_session(_token_code TEXT, _fingerprint TEXT, _user_agent TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  active_count INTEGER;
  existing RECORD;
BEGIN
  SELECT * INTO t FROM public.tokens WHERE code = _token_code AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token tidak valid');
  END IF;

  -- Check if this fingerprint already has an active session
  SELECT * INTO existing FROM public.token_sessions
    WHERE token_id = t.id AND fingerprint = _fingerprint AND is_active = true;
  IF FOUND THEN
    UPDATE public.token_sessions SET last_seen_at = now(), user_agent = _user_agent WHERE id = existing.id;
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Count active sessions
  SELECT COUNT(*) INTO active_count FROM public.token_sessions
    WHERE token_id = t.id AND is_active = true;
  IF active_count >= t.max_devices THEN
    RETURN jsonb_build_object('success', false, 'error', 'Batas perangkat tercapai');
  END IF;

  INSERT INTO public.token_sessions (token_id, fingerprint, user_agent)
  VALUES (t.id, _fingerprint, _user_agent);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC: release token session
CREATE OR REPLACE FUNCTION public.release_token_session(_token_code TEXT, _fingerprint TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
BEGIN
  SELECT id INTO t FROM public.tokens WHERE code = _token_code;
  IF FOUND THEN
    UPDATE public.token_sessions SET is_active = false WHERE token_id = t.id AND fingerprint = _fingerprint;
  END IF;
END;
$$;

-- RPC: redeem coins for token
CREATE OR REPLACE FUNCTION public.redeem_coins_for_token(_show_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  bal INTEGER;
  new_code TEXT;
  price INTEGER;
BEGIN
  SELECT * INTO s FROM public.shows WHERE id = _show_id AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan');
  END IF;

  price := CASE WHEN s.is_replay THEN s.replay_coin_price ELSE s.coin_price END;
  IF price <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak bisa dibeli dengan koin');
  END IF;

  SELECT balance INTO bal FROM public.coin_balances WHERE user_id = auth.uid();
  IF bal IS NULL OR bal < price THEN
    RETURN jsonb_build_object('success', false, 'error', 'Koin tidak cukup. Butuh ' || price || ' koin.');
  END IF;

  -- Generate unique token code
  new_code := 'RT48-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

  -- Deduct coins
  UPDATE public.coin_balances SET balance = balance - price, updated_at = now() WHERE user_id = auth.uid();

  -- Create token
  INSERT INTO public.tokens (code, show_id, user_id, max_devices, expires_at)
  VALUES (new_code, _show_id, auth.uid(), 1, now() + interval '24 hours');

  RETURN jsonb_build_object(
    'success', true,
    'token_code', new_code,
    'remaining_balance', bal - price,
    'access_password', s.access_password
  );
END;
$$;

-- RPC: get public shows (non-expired, active)
CREATE OR REPLACE FUNCTION public.get_public_shows()
RETURNS SETOF public.shows
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.shows WHERE is_active = true ORDER BY created_at DESC;
$$;
