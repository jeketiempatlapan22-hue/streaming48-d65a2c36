-- 0) Allow 'archived' status on tokens
ALTER TABLE public.tokens DROP CONSTRAINT IF EXISTS tokens_status_check;
ALTER TABLE public.tokens
  ADD CONSTRAINT tokens_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'blocked'::text, 'expired'::text, 'archived'::text]));

-- 1) Add archive columns to tokens
ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS archived_to_replay boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tokens_reseller_archived ON public.tokens (reseller_id, archived_to_replay);

-- 2) Update validate_replay_access: keep tokens row (mark as archived) instead of DELETE
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
      WHERE t.code = _token
        AND t.status IN ('active', 'archived')
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

        -- Preserve history: mark token as archived instead of DELETE
        UPDATE public.tokens
          SET status = 'archived',
              archived_to_replay = true,
              archived_at = COALESCE(archived_at, now()),
              expires_at = _new_expires
          WHERE id = _live_token.id;

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

-- 3) Backfill: re-insert archived placeholders for tokens previously deleted by replay flip
INSERT INTO public.tokens (
  code, show_id, max_devices, expires_at, status, created_at,
  archived_to_replay, archived_at, reseller_id, user_id
)
SELECT
  rt.code,
  rt.show_id,
  1,
  COALESCE(rt.expires_at, now() + interval '14 days'),
  'archived',
  rt.created_at,
  true,
  rt.created_at,
  (SELECT a.reseller_id FROM public.reseller_token_audit a
     WHERE a.token_code = rt.code AND a.reseller_id IS NOT NULL
     ORDER BY a.created_at ASC LIMIT 1),
  rt.user_id
FROM public.replay_tokens rt
WHERE rt.created_via IN ('auto_backfill', 'live_upgrade_validate')
ON CONFLICT (code) DO NOTHING;

-- 4) Patch reseller_list_my_tokens: include replay/archive flags + replay_expires_at
CREATE OR REPLACE FUNCTION public.reseller_list_my_tokens(
  _session_token text,
  _limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reseller_id uuid;
  v_tokens jsonb;
BEGIN
  v_reseller_id := validate_reseller_session(_session_token);
  IF v_reseller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid');
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_tokens
  FROM (
    SELECT
      tk.id, tk.code, tk.show_id, tk.status, tk.max_devices,
      tk.expires_at, tk.created_at,
      s.title AS show_title,
      s.short_id AS show_short_id,
      COALESCE(s.is_replay, false) AS is_replay_show,
      (tk.archived_to_replay OR tk.status = 'archived') AS is_archived,
      CASE
        WHEN COALESCE(s.is_replay, false) OR tk.archived_to_replay OR tk.status = 'archived'
        THEN 'replay'
        ELSE 'live'
      END AS effective_link_kind,
      (
        SELECT rt.expires_at FROM public.replay_tokens rt
        WHERE rt.code = tk.code LIMIT 1
      ) AS replay_expires_at,
      EXISTS (
        SELECT 1 FROM reseller_payments rp
        WHERE rp.reseller_id = tk.reseller_id
          AND rp.show_id IS NOT NULL
          AND rp.show_id = tk.show_id
      ) AS is_paid,
      (
        SELECT rp.paid_at FROM reseller_payments rp
        WHERE rp.reseller_id = tk.reseller_id
          AND rp.show_id IS NOT NULL
          AND rp.show_id = tk.show_id
        LIMIT 1
      ) AS paid_at
    FROM tokens tk
    LEFT JOIN shows s ON s.id = tk.show_id
    WHERE tk.reseller_id = v_reseller_id
    ORDER BY tk.created_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 500))
  ) t;

  RETURN jsonb_build_object('success', true, 'tokens', v_tokens);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reseller_list_my_tokens(text, integer) TO service_role, authenticated, anon;

-- 5) Patch reseller_list_recent_tokens_by_id (WhatsApp /mytokens)
CREATE OR REPLACE FUNCTION public.reseller_list_recent_tokens_by_id(_reseller_id uuid, _limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rows jsonb;
BEGIN
  IF _reseller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'code', t.code,
    'last4', right(t.code, 4),
    'show_title', s.title,
    'status', t.status,
    'max_devices', t.max_devices,
    'expires_at', t.expires_at,
    'created_at', t.created_at,
    'is_expired', (t.expires_at IS NOT NULL AND t.expires_at <= now()),
    'is_replay_show', COALESCE(s.is_replay, false),
    'is_archived', (t.archived_to_replay OR t.status = 'archived'),
    'effective_link_kind', CASE
      WHEN COALESCE(s.is_replay, false) OR t.archived_to_replay OR t.status = 'archived'
      THEN 'replay' ELSE 'live'
    END
  ) ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO _rows
  FROM (
    SELECT * FROM public.tokens
    WHERE reseller_id = _reseller_id
    ORDER BY created_at DESC
    LIMIT greatest(1, least(coalesce(_limit, 20), 50))
  ) t
  LEFT JOIN public.shows s ON s.id = t.show_id;

  RETURN jsonb_build_object('success', true, 'tokens', _rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reseller_list_recent_tokens_by_id(uuid, int) TO service_role;

-- 6) Trigger: auto-upgrade live tokens when admin flips show to replay
CREATE OR REPLACE FUNCTION public.handle_show_replay_flip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_replay = true AND COALESCE(OLD.is_replay, false) = false THEN
    INSERT INTO public.replay_tokens (
      code, show_id, password, expires_at, created_via, user_id, source_token_code
    )
    SELECT
      t.code, NEW.id, NEW.access_password,
      now() + interval '14 days',
      'show_flip_trigger', t.user_id, t.code
    FROM public.tokens t
    WHERE t.show_id = NEW.id
      AND t.status = 'active'
      AND (t.expires_at IS NULL OR t.expires_at > now())
    ON CONFLICT (code) DO UPDATE
      SET expires_at = GREATEST(public.replay_tokens.expires_at, EXCLUDED.expires_at),
          updated_at = now(),
          status = 'active',
          show_id = COALESCE(public.replay_tokens.show_id, EXCLUDED.show_id);

    UPDATE public.tokens
      SET status = 'archived',
          archived_to_replay = true,
          archived_at = now(),
          expires_at = now() + interval '14 days'
      WHERE show_id = NEW.id
        AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_show_replay_flip ON public.shows;
CREATE TRIGGER trg_show_replay_flip
  AFTER UPDATE OF is_replay ON public.shows
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_show_replay_flip();