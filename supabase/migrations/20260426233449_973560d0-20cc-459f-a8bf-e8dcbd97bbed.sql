-- 1) Backfill: replay_tokens dengan expires_at NULL → 14 hari
UPDATE public.replay_tokens
SET expires_at = GREATEST(created_at, now()) + interval '14 days',
    updated_at = now()
WHERE expires_at IS NULL;

-- 2) Backfill: live tokens yang masih menempel ke show is_replay=true
WITH replay_show_tokens AS (
  SELECT t.id, t.code, t.show_id, t.user_id, s.access_password
  FROM public.tokens t
  JOIN public.shows s ON s.id = t.show_id
  WHERE s.is_replay = true
    AND t.status = 'active'
),
upserted AS (
  INSERT INTO public.replay_tokens (
    code, show_id, password, expires_at, created_via, user_id, source_token_code
  )
  SELECT
    rst.code,
    rst.show_id,
    rst.access_password,
    now() + interval '14 days',
    'auto_backfill',
    rst.user_id,
    rst.code
  FROM replay_show_tokens rst
  ON CONFLICT (code) DO UPDATE
    SET expires_at = GREATEST(public.replay_tokens.expires_at, EXCLUDED.expires_at),
        updated_at = now(),
        status = 'active',
        show_id = COALESCE(public.replay_tokens.show_id, EXCLUDED.show_id)
  RETURNING code
)
DELETE FROM public.tokens
WHERE id IN (SELECT id FROM replay_show_tokens);

-- 3) Update validate_replay_access: auto-upgrade live token → replay token 14 hari
CREATE OR REPLACE FUNCTION public.validate_replay_access(
  _token text DEFAULT NULL::text,
  _password text DEFAULT NULL::text,
  _show_id uuid DEFAULT NULL::uuid,
  _short_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _show RECORD;
  _rt RECORD;
  _global_pw text;
  _month text;
  _today text;
  _live_token RECORD;
  _new_expires timestamptz;
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

      IF _rt.expires_at IS NULL THEN
        UPDATE public.replay_tokens
          SET expires_at = now() + interval '14 days', updated_at = now()
          WHERE id = _rt.id
          RETURNING expires_at INTO _new_expires;
      ELSE
        _new_expires := _rt.expires_at;
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'access_via', 'replay_token',
        'token_code', _rt.code,
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url,
        'youtube_url', _show.replay_youtube_url,
        'expires_at', _new_expires,
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
        _new_expires := now() + interval '14 days';

        INSERT INTO public.replay_tokens (
          code, show_id, password, expires_at, created_via, user_id, source_token_code
        ) VALUES (
          _live_token.code, _show.id, _show.access_password,
          _new_expires, 'live_upgrade_validate', _live_token.user_id, _live_token.code
        )
        ON CONFLICT (code) DO UPDATE
          SET expires_at = EXCLUDED.expires_at,
              updated_at = now(),
              status = 'active',
              show_id = COALESCE(public.replay_tokens.show_id, EXCLUDED.show_id);

        DELETE FROM public.tokens WHERE id = _live_token.id;

        RETURN jsonb_build_object(
          'success', true,
          'access_via', 'live_token_upgrade',
          'token_code', _live_token.code,
          'show_id', _show.id, 'show_title', _show.title,
          'm3u8_url', _show.replay_m3u8_url,
          'youtube_url', _show.replay_youtube_url,
          'expires_at', _new_expires,
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
    _month := COALESCE(NULLIF(_show.replay_month,''), to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM'));
    _today := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD');

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

    SELECT value INTO _global_pw FROM public.site_settings
      WHERE key = 'replay_global_password__' || _today LIMIT 1;
    IF _global_pw IS NOT NULL AND _global_pw <> '' AND _password = _global_pw THEN
      RETURN jsonb_build_object(
        'success', true, 'access_via', 'global_password', 'global_scope', 'daily',
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url, 'youtube_url', _show.replay_youtube_url,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;

    SELECT value INTO _global_pw FROM public.site_settings
      WHERE key = 'replay_global_password__' || _month LIMIT 1;
    IF _global_pw IS NOT NULL AND _global_pw <> '' AND _password = _global_pw THEN
      RETURN jsonb_build_object(
        'success', true, 'access_via', 'global_password', 'global_scope', 'monthly',
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url, 'youtube_url', _show.replay_youtube_url,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;

    SELECT value INTO _global_pw FROM public.site_settings
      WHERE key = 'replay_global_password' LIMIT 1;
    IF _global_pw IS NOT NULL AND _global_pw <> '' AND _password = _global_pw THEN
      RETURN jsonb_build_object(
        'success', true, 'access_via', 'global_password', 'global_scope', 'default',
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url, 'youtube_url', _show.replay_youtube_url,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Token atau sandi salah');
END $function$;