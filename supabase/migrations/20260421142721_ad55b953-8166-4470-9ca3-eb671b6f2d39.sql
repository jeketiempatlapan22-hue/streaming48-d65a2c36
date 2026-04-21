
-- Trigger: when a token row is deleted, also clean its sessions (defense in depth)
CREATE OR REPLACE FUNCTION public.cleanup_token_sessions_on_token_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.token_sessions WHERE token_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_token_sessions_on_token_delete ON public.tokens;
CREATE TRIGGER trg_cleanup_token_sessions_on_token_delete
BEFORE DELETE ON public.tokens
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_token_sessions_on_token_delete();

-- Helper: find a reseller's token by full code or last-4 digits
CREATE OR REPLACE FUNCTION public._reseller_find_token(_reseller_id uuid, _input text)
RETURNS public.tokens
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _norm text;
  _tok public.tokens;
  _count int;
BEGIN
  _norm := upper(trim(coalesce(_input, '')));
  IF _norm = '' THEN
    RETURN NULL;
  END IF;

  -- Exact match first
  SELECT * INTO _tok
  FROM public.tokens
  WHERE reseller_id = _reseller_id AND upper(code) = _norm
  LIMIT 1;

  IF FOUND THEN
    RETURN _tok;
  END IF;

  -- Last 4 chars match (only if input is exactly 4 chars to avoid ambiguity)
  IF length(_norm) = 4 THEN
    SELECT count(*) INTO _count
    FROM public.tokens
    WHERE reseller_id = _reseller_id AND right(upper(code), 4) = _norm;

    IF _count = 1 THEN
      SELECT * INTO _tok
      FROM public.tokens
      WHERE reseller_id = _reseller_id AND right(upper(code), 4) = _norm
      LIMIT 1;
      RETURN _tok;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- Core: reset sessions for one of reseller's tokens (by reseller_id)
CREATE OR REPLACE FUNCTION public.reseller_reset_token_sessions_by_id(_reseller_id uuid, _input text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _reseller public.resellers;
  _tok public.tokens;
  _deleted int := 0;
  _allowed boolean;
BEGIN
  IF _reseller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan.');
  END IF;

  SELECT * INTO _reseller FROM public.resellers WHERE id = _reseller_id AND is_active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan atau nonaktif.');
  END IF;

  -- Rate limit: 30 resets per hour per reseller
  SELECT public.check_rate_limit('reseller_reset_' || _reseller.id::text, 30, 3600) INTO _allowed;
  IF NOT _allowed THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_input, metadata)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'rate_limit', _input, jsonb_build_object('action', 'reset_session'));
    RETURN jsonb_build_object('success', false, 'error', 'Terlalu banyak reset. Coba lagi nanti (max 30/jam).');
  END IF;

  _tok := public._reseller_find_token(_reseller.id, _input);

  IF _tok.id IS NULL THEN
    INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, rejection_reason, show_input, metadata)
    VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'rejected', 'token_not_owned', _input, jsonb_build_object('action', 'reset_session'));
    RETURN jsonb_build_object('success', false, 'error', 'Token tidak ditemukan atau bukan milik Anda.');
  END IF;

  DELETE FROM public.token_sessions WHERE token_id = _tok.id;
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  INSERT INTO public.reseller_token_audit (reseller_id, reseller_name, reseller_prefix, source, status, show_id, token_id, token_code, metadata)
  VALUES (_reseller.id, _reseller.name, _reseller.wa_command_prefix, 'web', 'success', _tok.show_id, _tok.id, _tok.code,
          jsonb_build_object('action', 'reset_session', 'deleted_count', _deleted));

  RETURN jsonb_build_object('success', true, 'deleted_count', _deleted, 'token_code', _tok.code, 'token_id', _tok.id);
END;
$$;

-- Web wrapper: validates session_token then delegates
CREATE OR REPLACE FUNCTION public.reseller_reset_token_sessions(_session_token text, _input text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid;
  _result jsonb;
BEGIN
  _me := public.validate_reseller_session(_session_token);
  IF _me IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid. Silakan login ulang.');
  END IF;

  _result := public.reseller_reset_token_sessions_by_id(_me, _input);
  -- Override source = 'web' in last audit row inserted (already 'web' inside helper)
  RETURN _result;
END;
$$;

-- Stats by reseller_id
CREATE OR REPLACE FUNCTION public.reseller_my_stats_by_id(_reseller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _reseller public.resellers;
  _total int := 0;
  _active int := 0;
  _expired int := 0;
  _blocked int := 0;
  _per_show jsonb;
BEGIN
  IF _reseller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan.');
  END IF;

  SELECT * INTO _reseller FROM public.resellers WHERE id = _reseller_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan.');
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())),
    count(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= now()),
    count(*) FILTER (WHERE status = 'blocked')
  INTO _total, _active, _expired, _blocked
  FROM public.tokens
  WHERE reseller_id = _reseller.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'show_id', s.id,
    'show_title', s.title,
    'count', t.cnt,
    'active', t.active_cnt
  ) ORDER BY t.cnt DESC), '[]'::jsonb)
  INTO _per_show
  FROM (
    SELECT show_id,
           count(*) AS cnt,
           count(*) FILTER (WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())) AS active_cnt
    FROM public.tokens
    WHERE reseller_id = _reseller.id AND show_id IS NOT NULL
    GROUP BY show_id
  ) t
  LEFT JOIN public.shows s ON s.id = t.show_id;

  RETURN jsonb_build_object(
    'success', true,
    'reseller_name', _reseller.name,
    'total', _total,
    'active', _active,
    'expired', _expired,
    'blocked', _blocked,
    'per_show', _per_show
  );
END;
$$;

-- Web stats wrapper
CREATE OR REPLACE FUNCTION public.reseller_my_stats(_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid;
BEGIN
  _me := public.validate_reseller_session(_session_token);
  IF _me IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid.');
  END IF;
  RETURN public.reseller_my_stats_by_id(_me);
END;
$$;

-- List recent tokens for a reseller (for /mytokens command)
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
    'is_expired', (t.expires_at IS NOT NULL AND t.expires_at <= now())
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
