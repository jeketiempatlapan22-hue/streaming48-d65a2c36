CREATE OR REPLACE FUNCTION public.validate_replay_access(_token text DEFAULT NULL::text, _password text DEFAULT NULL::text, _show_id uuid DEFAULT NULL::uuid, _short_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _show RECORD;
  _rt RECORD;
  _live_t RECORD;
  _global_pw text;
  _new_expires timestamptz;
  _uid uuid;
  _has_purchase boolean := false;
  _has_universal boolean := false;
BEGIN
  -- Resolve show by id or short_id
  IF _show_id IS NOT NULL THEN
    SELECT * INTO _show FROM public.shows WHERE id = _show_id LIMIT 1;
  ELSIF _short_id IS NOT NULL THEN
    SELECT * INTO _show FROM public.shows WHERE lower(short_id) = lower(_short_id) LIMIT 1;
  END IF;

  _uid := auth.uid();

  -- 1) Replay token (RT-...) path
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
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL),
        'expires_at', _new_expires
      );
    END IF;

    -- 1b) NEW: Live token (still in `tokens`) for a show that has flipped to replay.
    -- Auto-migrate ke `replay_tokens` lalu beri akses (mengatasi token yatim yang tidak terjaring trigger).
    SELECT t.* INTO _live_t FROM public.tokens t
      WHERE t.code = _token
        AND t.status = 'active'
        AND (t.expires_at IS NULL OR t.expires_at > now())
      LIMIT 1;

    IF FOUND AND _live_t.show_id IS NOT NULL THEN
      SELECT * INTO _show FROM public.shows WHERE id = _live_t.show_id LIMIT 1;

      IF FOUND AND COALESCE(_show.is_replay, false) = true THEN
        -- Migrasikan: insert ke replay_tokens (kode sama), 14 hari berlaku, lalu hapus dari tokens
        INSERT INTO public.replay_tokens(
          code, show_id, password, expires_at, created_via, user_id, source_token_code
        ) VALUES (
          _live_t.code, _show.id, _show.access_password,
          now() + interval '14 days',
          'live_upgrade_lazy', _live_t.user_id, _live_t.code
        )
        ON CONFLICT (code) DO UPDATE
          SET expires_at = EXCLUDED.expires_at,
              updated_at = now(),
              status = 'active'
        RETURNING expires_at INTO _new_expires;

        DELETE FROM public.tokens WHERE id = _live_t.id;

        RETURN jsonb_build_object(
          'success', true,
          'access_via', 'live_token_upgrade',
          'token_code', _live_t.code,
          'show_id', _show.id, 'show_title', _show.title,
          'm3u8_url', _show.replay_m3u8_url,
          'youtube_url', _show.replay_youtube_url,
          'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL),
          'expires_at', _new_expires
        );
      END IF;
    END IF;
  END IF;

  -- 2) Authenticated user with prior live purchase or universal token
  IF _uid IS NOT NULL AND _show.id IS NOT NULL THEN
    -- Per-show token (any non-universal active token for this show)
    SELECT EXISTS (
      SELECT 1 FROM public.tokens t
      WHERE t.user_id = _uid
        AND t.status = 'active'
        AND t.show_id = _show.id
        AND (t.expires_at IS NULL OR t.expires_at > now())
        AND NOT (
          t.code ILIKE 'MBR-%' OR t.code ILIKE 'MRD-%'
          OR t.code ILIKE 'BDL-%' OR t.code ILIKE 'RT48-%'
        )
    ) INTO _has_purchase;

    -- Coin-redeem history for this show
    IF NOT _has_purchase THEN
      SELECT EXISTS (
        SELECT 1 FROM public.coin_transactions ct
        WHERE ct.user_id = _uid
          AND ct.type IN ('redeem', 'replay_redeem')
          AND ct.reference_id = _show.id::text
      ) INTO _has_purchase;
    END IF;

    -- Universal active tokens (membership/bundle/custom)
    SELECT EXISTS (
      SELECT 1 FROM public.tokens t
      WHERE t.user_id = _uid
        AND t.status = 'active'
        AND (t.expires_at IS NULL OR t.expires_at > now())
        AND (
          t.code ILIKE 'MBR-%' OR t.code ILIKE 'MRD-%'
          OR t.code ILIKE 'BDL-%' OR t.code ILIKE 'RT48-%'
        )
    ) INTO _has_universal;

    IF _has_purchase OR _has_universal THEN
      RETURN jsonb_build_object(
        'success', true,
        'access_via', CASE WHEN _has_purchase THEN 'purchased_live_token' ELSE 'universal_token' END,
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url,
        'youtube_url', _show.replay_youtube_url,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;
  END IF;

  -- 3) Per-show access password match (sandi yang dibagikan via WA/setelah pembelian)
  IF _password IS NOT NULL AND length(trim(_password)) > 0 AND _show.id IS NOT NULL THEN
    IF _show.access_password IS NOT NULL
       AND _show.access_password <> ''
       AND _password = _show.access_password THEN
      RETURN jsonb_build_object(
        'success', true,
        'access_via', 'show_password',
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url,
        'youtube_url', _show.replay_youtube_url,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;
  END IF;

  -- 4) Global replay password (existing behaviour)
  IF _password IS NOT NULL AND length(trim(_password)) > 0 THEN
    SELECT value INTO _global_pw FROM public.site_settings
      WHERE key = 'replay_global_password' LIMIT 1;
    IF _global_pw IS NOT NULL AND _global_pw <> '' AND _password = _global_pw AND _show.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true, 'access_via', 'global_password', 'global_scope', 'default',
        'show_id', _show.id, 'show_title', _show.title,
        'm3u8_url', _show.replay_m3u8_url, 'youtube_url', _show.replay_youtube_url,
        'has_media', (COALESCE(NULLIF(_show.replay_m3u8_url,''), NULLIF(_show.replay_youtube_url,'')) IS NOT NULL)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Token / sandi tidak valid atau show tidak ditemukan');
END
$function$;