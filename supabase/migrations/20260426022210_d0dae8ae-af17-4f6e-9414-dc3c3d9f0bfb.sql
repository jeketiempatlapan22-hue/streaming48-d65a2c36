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
  _today text;
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

  -- Sandi per-show
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

  -- Sandi global: master, harian, bulanan, default
  IF _password IS NOT NULL THEN
    _month := COALESCE(NULLIF(_show.replay_month,''), to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM'));
    _today := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD');

    -- Master
    SELECT value INTO _global_pw FROM public.site_settings
      WHERE key = 'replay_global_password__all' LIMIT 1;
    IF _global_pw IS NOT NULL AND _global_pw <> '' AND _password = _global_pw THEN
      RETURN jsonb_build_object(
        'success', true, 'access_via', 'global_password', 'global_scope', 'master',
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url, 'youtube_url', _show.replay_youtube_url,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;

    -- Harian (hari ini WIB)
    SELECT value INTO _global_pw FROM public.site_settings
      WHERE key = 'replay_global_password__' || _today LIMIT 1;
    IF _global_pw IS NOT NULL AND _global_pw <> '' AND _password = _global_pw THEN
      RETURN jsonb_build_object(
        'success', true, 'access_via', 'global_password', 'global_scope', 'day', 'global_period', _today,
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url, 'youtube_url', _show.replay_youtube_url,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;

    -- Bulanan
    SELECT value INTO _global_pw FROM public.site_settings
      WHERE key = 'replay_global_password__' || _month LIMIT 1;
    IF _global_pw IS NULL OR _global_pw = '' THEN
      SELECT value INTO _global_pw FROM public.site_settings
        WHERE key = 'replay_global_password_default' LIMIT 1;
    END IF;
    IF _global_pw IS NOT NULL AND _global_pw <> '' AND _password = _global_pw THEN
      RETURN jsonb_build_object(
        'success', true, 'access_via', 'global_password', 'global_scope', 'month', 'global_period', _month,
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url, 'youtube_url', _show.replay_youtube_url,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Sandi atau token tidak valid');
END $$;