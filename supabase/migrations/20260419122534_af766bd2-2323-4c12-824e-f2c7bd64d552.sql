-- Table for one-time replay access tokens (Solusi 2: Shared Backend)
CREATE TABLE public.replay_access_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token text NOT NULL UNIQUE,
  show_id uuid NOT NULL,
  user_id uuid NOT NULL,
  password text NOT NULL,
  used boolean NOT NULL DEFAULT false,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

CREATE INDEX idx_replay_access_tokens_token ON public.replay_access_tokens(token);
CREATE INDEX idx_replay_access_tokens_expires ON public.replay_access_tokens(expires_at);

ALTER TABLE public.replay_access_tokens ENABLE ROW LEVEL SECURITY;

-- Block public/auth direct access; only service role (via edge functions) may read/write
CREATE POLICY "Block all direct access to replay_access_tokens"
  ON public.replay_access_tokens
  FOR ALL
  TO public, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Service role full access to replay_access_tokens"
  ON public.replay_access_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RPC: check if current user has access to a show's replay
-- Returns access_password if user has membership/bundle/replay-redeem/regular-purchase, else null
CREATE OR REPLACE FUNCTION public.check_user_replay_access(_show_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _password text;
  _has_access boolean := false;
  _show_active boolean;
  _is_bundle boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tidak login');
  END IF;

  SELECT access_password, is_active, is_bundle INTO _password, _show_active, _is_bundle
  FROM public.shows WHERE id = _show_id;

  IF NOT FOUND OR NOT _show_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan');
  END IF;

  IF _password IS NULL OR _password = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sandi replay belum diatur');
  END IF;

  -- 1. Check coin redemption (replay/regular/membership)
  IF EXISTS (
    SELECT 1 FROM public.coin_transactions
    WHERE user_id = auth.uid()
      AND type IN ('redeem', 'replay_redeem', 'membership_redeem')
      AND reference_id = _show_id::text
  ) THEN
    _has_access := true;
  END IF;

  -- 2. Check active token bound to this show (regular order, coin, bundle, membership)
  IF NOT _has_access AND EXISTS (
    SELECT 1 FROM public.tokens
    WHERE user_id = auth.uid()
      AND show_id = _show_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    _has_access := true;
  END IF;

  -- 3. Check universal access tokens (membership MBR-, MRD-, BDL-, RT48-)
  IF NOT _has_access AND EXISTS (
    SELECT 1 FROM public.tokens
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
      AND (code ILIKE 'MBR-%' OR code ILIKE 'MRD-%' OR code ILIKE 'BDL-%' OR code ILIKE 'RT48-%')
  ) THEN
    _has_access := true;
  END IF;

  IF NOT _has_access THEN
    RETURN jsonb_build_object('success', false, 'error', 'Anda belum membeli akses replay show ini');
  END IF;

  RETURN jsonb_build_object('success', true, 'password', _password);
END;
$$;

-- Cleanup expired tokens (run via existing cleanup_old_logs cron eventually)
CREATE OR REPLACE FUNCTION public.cleanup_replay_access_tokens()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.replay_access_tokens WHERE expires_at < now() - interval '1 hour';
$$;