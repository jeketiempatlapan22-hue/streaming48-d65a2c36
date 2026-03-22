CREATE OR REPLACE FUNCTION public.create_token_session(_token_code text, _fingerprint text, _user_agent text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t RECORD;
  active_count INTEGER;
  existing RECORD;
BEGIN
  SELECT * INTO t FROM public.tokens WHERE code = _token_code AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token tidak valid');
  END IF;

  -- Check expiry
  IF t.expires_at IS NOT NULL AND t.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token telah kedaluwarsa');
  END IF;

  -- Public tokens: unlimited access, no session tracking
  IF t.is_public = true THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Check if this fingerprint already has an active session
  SELECT * INTO existing FROM public.token_sessions
    WHERE token_id = t.id AND fingerprint = _fingerprint AND is_active = true;
  IF FOUND THEN
    UPDATE public.token_sessions SET last_seen_at = now(), user_agent = _user_agent WHERE id = existing.id;
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Strict device limit: COIN tokens = 1, manual tokens = admin-set max_devices
  SELECT COUNT(*) INTO active_count FROM public.token_sessions
    WHERE token_id = t.id AND is_active = true;
  
  IF active_count >= t.max_devices THEN
    RETURN jsonb_build_object('success', false, 'error', 'device_limit', 'max_devices', t.max_devices, 'active_devices', active_count);
  END IF;

  INSERT INTO public.token_sessions (token_id, fingerprint, user_agent)
  VALUES (t.id, _fingerprint, _user_agent);

  RETURN jsonb_build_object('success', true);
END;
$$;