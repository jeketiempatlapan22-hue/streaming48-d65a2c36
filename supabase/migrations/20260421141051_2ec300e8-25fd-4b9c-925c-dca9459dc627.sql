-- Audit log table for reseller token creation attempts (web + WhatsApp)
CREATE TABLE public.reseller_token_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reseller_id UUID REFERENCES public.resellers(id) ON DELETE SET NULL,
  reseller_name TEXT,
  reseller_prefix TEXT,
  source TEXT NOT NULL DEFAULT 'web', -- 'web' | 'whatsapp'
  show_id UUID,
  show_title TEXT,
  show_input TEXT, -- raw input (e.g. for WA: "#abc123" or show name)
  token_id UUID REFERENCES public.tokens(id) ON DELETE SET NULL,
  token_code TEXT,
  max_devices INTEGER,
  duration_days INTEGER,
  status TEXT NOT NULL DEFAULT 'success', -- 'success' | 'rejected' | 'error'
  rejection_reason TEXT, -- e.g. 'bundle_show', 'show_not_found', 'rate_limit', 'invalid_session'
  replay_info JSONB DEFAULT '{}'::jsonb, -- { access_password, replay_link, has_replay }
  metadata JSONB DEFAULT '{}'::jsonb, -- extra context (raw_command, error msg, etc)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reseller_audit_created ON public.reseller_token_audit(created_at DESC);
CREATE INDEX idx_reseller_audit_reseller ON public.reseller_token_audit(reseller_id, created_at DESC);
CREATE INDEX idx_reseller_audit_status ON public.reseller_token_audit(status, created_at DESC);

ALTER TABLE public.reseller_token_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage reseller audit"
ON public.reseller_token_audit FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role full access reseller audit"
ON public.reseller_token_audit FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Update reseller_create_token RPC to log every attempt (success/rejection)
CREATE OR REPLACE FUNCTION public.reseller_create_token(
  _session_token TEXT,
  _show_id UUID,
  _max_devices INTEGER DEFAULT 1,
  _duration_days INTEGER DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _reseller RECORD;
  _show RECORD;
  _new_code TEXT;
  _new_token_id UUID;
  _expires TIMESTAMPTZ;
  _replay_info JSONB;
BEGIN
  -- Validate session
  SELECT * INTO _reseller FROM public.resellers
  WHERE session_token = _session_token
    AND session_expires_at > now()
    AND is_active = true
  LIMIT 1;

  IF _reseller.id IS NULL THEN
    INSERT INTO public.reseller_token_audit (source, status, rejection_reason, metadata)
    VALUES ('web', 'rejected', 'invalid_session', jsonb_build_object('show_id', _show_id));
    RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid atau sudah berakhir.');
  END IF;

  -- Validate inputs
  IF _max_devices < 1 OR _max_devices > 10 THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, max_devices)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'invalid_max_devices', _max_devices);
    RETURN jsonb_build_object('success', false, 'error', 'Max device harus 1-10.');
  END IF;

  IF _duration_days < 1 OR _duration_days > 90 THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, duration_days)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'invalid_duration', _duration_days);
    RETURN jsonb_build_object('success', false, 'error', 'Durasi harus 1-90 hari.');
  END IF;

  -- Find show
  SELECT * INTO _show FROM public.shows WHERE id = _show_id LIMIT 1;
  IF _show.id IS NULL OR _show.is_active = false THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'show_not_found', _show_id);
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan atau tidak aktif.');
  END IF;

  -- Reject bundle shows
  IF COALESCE(_show.is_bundle, false) = true THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'bundle_show', _show.id, _show.title);
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak dapat membuat token untuk show bundle.');
  END IF;

  -- Rate limit (50/hour)
  IF NOT public.check_rate_limit('reseller_token_' || _reseller.id::text, 50, 3600) THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'rate_limit', _show.id, _show.title);
    RETURN jsonb_build_object('success', false, 'error', 'Batas pembuatan token tercapai (50/jam).');
  END IF;

  -- Generate unique code
  LOOP
    _new_code := 'RSL-' || upper(_reseller.wa_command_prefix) || '-' || upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tokens WHERE code = _new_code);
  END LOOP;

  _expires := now() + (_duration_days || ' days')::interval;

  INSERT INTO public.tokens (code, show_id, max_devices, expires_at, status, reseller_id, duration_type)
  VALUES (_new_code, _show.id, _max_devices, _expires, 'active', _reseller.id, 'custom')
  RETURNING id INTO _new_token_id;

  -- Build replay info
  _replay_info := jsonb_build_object(
    'has_replay', _show.access_password IS NOT NULL,
    'access_password', _show.access_password,
    'replay_link', 'https://replaytime.lovable.app'
  );

  -- Multi-device admin notification
  IF _max_devices > 1 THEN
    INSERT INTO public.admin_notifications (type, title, message)
    VALUES ('reseller_multidevice', '⚠️ Token Multi-Device Reseller',
            'Reseller "' || _reseller.name || '" membuat token ' || _new_code || ' (' || _show.title || ') dengan ' || _max_devices || ' device.');
  END IF;

  -- Audit success
  INSERT INTO public.reseller_token_audit (
    reseller_id, reseller_name, reseller_prefix, source, show_id, show_title,
    token_id, token_code, max_devices, duration_days, status, replay_info
  ) VALUES (
    _reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', _show.id, _show.title,
    _new_token_id, _new_code, _max_devices, _duration_days, 'success', _replay_info
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', _new_code,
    'token_id', _new_token_id,
    'expires_at', _expires,
    'access_password', _show.access_password,
    'show_title', _show.title
  );
END;
$$;

-- Update reseller_create_token_by_id RPC (used by WhatsApp) with same audit logging
CREATE OR REPLACE FUNCTION public.reseller_create_token_by_id(
  _reseller_id UUID,
  _show_id UUID,
  _max_devices INTEGER DEFAULT 1,
  _duration_days INTEGER DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _reseller RECORD;
  _show RECORD;
  _new_code TEXT;
  _new_token_id UUID;
  _expires TIMESTAMPTZ;
  _replay_info JSONB;
BEGIN
  SELECT * INTO _reseller FROM public.resellers
  WHERE id = _reseller_id AND is_active = true LIMIT 1;

  IF _reseller.id IS NULL THEN
    INSERT INTO public.reseller_token_audit (source, status, rejection_reason, metadata)
    VALUES ('whatsapp', 'rejected', 'reseller_inactive', jsonb_build_object('reseller_id', _reseller_id, 'show_id', _show_id));
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak aktif.');
  END IF;

  IF _max_devices < 1 OR _max_devices > 10 THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, max_devices)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'invalid_max_devices', _max_devices);
    RETURN jsonb_build_object('success', false, 'error', 'Max device harus 1-10.');
  END IF;

  IF _duration_days < 1 OR _duration_days > 90 THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, duration_days)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'invalid_duration', _duration_days);
    RETURN jsonb_build_object('success', false, 'error', 'Durasi harus 1-90 hari.');
  END IF;

  SELECT * INTO _show FROM public.shows WHERE id = _show_id LIMIT 1;
  IF _show.id IS NULL OR _show.is_active = false THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'show_not_found', _show_id);
    RETURN jsonb_build_object('success', false, 'error', 'Show tidak ditemukan atau tidak aktif.');
  END IF;

  IF COALESCE(_show.is_bundle, false) = true THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'bundle_show', _show.id, _show.title);
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak dapat membuat token untuk show bundle.');
  END IF;

  IF NOT public.check_rate_limit('reseller_token_' || _reseller.id::text, 50, 3600) THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_id, show_title)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', 'rejected', 'rate_limit', _show.id, _show.title);
    RETURN jsonb_build_object('success', false, 'error', 'Batas pembuatan token tercapai (50/jam).');
  END IF;

  LOOP
    _new_code := 'RSL-' || upper(_reseller.wa_command_prefix) || '-' || upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tokens WHERE code = _new_code);
  END LOOP;

  _expires := now() + (_duration_days || ' days')::interval;

  INSERT INTO public.tokens (code, show_id, max_devices, expires_at, status, reseller_id, duration_type)
  VALUES (_new_code, _show.id, _max_devices, _expires, 'active', _reseller.id, 'custom')
  RETURNING id INTO _new_token_id;

  _replay_info := jsonb_build_object(
    'has_replay', _show.access_password IS NOT NULL,
    'access_password', _show.access_password,
    'replay_link', 'https://replaytime.lovable.app'
  );

  IF _max_devices > 1 THEN
    INSERT INTO public.admin_notifications (type, title, message)
    VALUES ('reseller_multidevice', '⚠️ Token Multi-Device Reseller (WA)',
            'Reseller "' || _reseller.name || '" via WA membuat token ' || _new_code || ' (' || _show.title || ') dengan ' || _max_devices || ' device.');
  END IF;

  INSERT INTO public.reseller_token_audit (
    reseller_id, reseller_name, reseller_prefix, source, show_id, show_title,
    token_id, token_code, max_devices, duration_days, status, replay_info
  ) VALUES (
    _reseller.id, _reseller.name, _reseller.wa_command_prefix, 'whatsapp', _show.id, _show.title,
    _new_token_id, _new_code, _max_devices, _duration_days, 'success', _replay_info
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', _new_code,
    'token_id', _new_token_id,
    'expires_at', _expires,
    'access_password', _show.access_password,
    'show_title', _show.title
  );
END;
$$;

-- RPC for admin to log WA-side failures (e.g. show_not_found, parse_error) that happen before reaching the token RPC
CREATE OR REPLACE FUNCTION public.log_reseller_audit(
  _reseller_id UUID,
  _source TEXT,
  _status TEXT,
  _rejection_reason TEXT DEFAULT NULL,
  _show_input TEXT DEFAULT NULL,
  _metadata JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _reseller RECORD;
BEGIN
  IF _reseller_id IS NOT NULL THEN
    SELECT name, wa_command_prefix INTO _reseller FROM public.resellers WHERE id = _reseller_id;
  END IF;

  INSERT INTO public.reseller_token_audit (
    reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_input, metadata
  ) VALUES (
    _reseller_id, _reseller.name, _reseller.wa_command_prefix, _source, _status, _rejection_reason, _show_input, _metadata
  );
END;
$$;