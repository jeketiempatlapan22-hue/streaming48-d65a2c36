-- Saat token live di-migrate ke replay, paksa expires_at = now() + 14 hari.
CREATE OR REPLACE FUNCTION public.migrate_tokens_on_replay_flip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      INSERT INTO public.replay_tokens(
        code, show_id, password, expires_at, created_via, user_id, source_token_code
      ) VALUES (
        _t.code, NEW.id, NEW.access_password,
        now() + interval '14 days',
        'live_upgrade', _t.user_id, _t.code
      )
      ON CONFLICT (code) DO UPDATE
        SET expires_at = EXCLUDED.expires_at,
            updated_at = now(),
            status = 'active';
      DELETE FROM public.tokens WHERE id = _t.id;
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;

-- Cleanup: hapus replay_tokens segera setelah expired (bukan +7 hari).
CREATE OR REPLACE FUNCTION public.cleanup_replay_artifacts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted_tokens integer := 0;
  _deleted_sessions integer := 0;
BEGIN
  -- Hapus replay_tokens yang sudah lewat expires_at
  DELETE FROM public.replay_tokens
  WHERE expires_at IS NOT NULL
    AND expires_at < now();
  GET DIAGNOSTICS _deleted_tokens = ROW_COUNT;

  -- Nonaktifkan sesi replay >24 jam
  UPDATE public.replay_token_sessions
     SET is_active = false
   WHERE is_active = true
     AND last_seen_at < (now() - interval '24 hours');

  DELETE FROM public.replay_token_sessions
  WHERE is_active = false
    AND last_seen_at < (now() - interval '7 days');
  GET DIAGNOSTICS _deleted_sessions = ROW_COUNT;

  INSERT INTO public.security_events (event_type, description, severity)
  VALUES (
    'replay_cleanup',
    'Cleanup replay: ' || _deleted_tokens || ' tokens removed, ' || _deleted_sessions || ' sessions purged',
    'low'
  );
END;
$$;