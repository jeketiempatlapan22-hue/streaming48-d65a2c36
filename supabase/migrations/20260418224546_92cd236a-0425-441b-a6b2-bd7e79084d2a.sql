-- 1. Update self_reset_token_session: izinkan multi-device, tetap 3x/hari
CREATE OR REPLACE FUNCTION public.self_reset_token_session(_token_code text, _fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD; _allowed boolean;
BEGIN
  SELECT * INTO t FROM public.tokens WHERE code = _token_code AND status = 'active';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Token tidak valid'); END IF;

  SELECT public.check_rate_limit('self_reset:' || _token_code, 3, 86400) INTO _allowed;
  IF NOT _allowed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Batas reset tercapai (3x per 24 jam). Coba lagi nanti.');
  END IF;

  -- Hapus semua sesi aktif (semua device akan dipaksa keluar)
  DELETE FROM public.token_sessions WHERE token_id = t.id AND is_active = true;

  -- Buat sesi baru untuk device yang melakukan reset
  INSERT INTO public.token_sessions (token_id, fingerprint, user_agent)
  VALUES (t.id, _fingerprint, '');

  RETURN jsonb_build_object('success', true);
END; $function$;

-- 2. Update auto_reset_long_token_sessions: jalan setiap hari jam 00:00 WIB,
--    reset semua sesi aktif untuk token yang sudah berusia >3 hari
CREATE OR REPLACE FUNCTION public.auto_reset_long_token_sessions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _count integer;
BEGIN
  DELETE FROM public.token_sessions
  WHERE is_active = true
    AND token_id IN (
      SELECT id FROM public.tokens
      WHERE status = 'active'
        AND created_at < now() - interval '3 days'
        AND (expires_at IS NULL OR expires_at > now())
    );
  GET DIAGNOSTICS _count = ROW_COUNT;

  IF _count > 0 THEN
    INSERT INTO public.security_events (event_type, description, severity)
    VALUES ('auto_reset_long_tokens', 'Auto-reset ' || _count || ' sesi pada token >3 hari (cron 00:00 WIB)', 'low');
  END IF;
END; $function$;

-- 3. Fungsi baru: hitung sesi aktif per token (untuk admin panel)
CREATE OR REPLACE FUNCTION public.get_token_active_sessions(_token_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(COUNT(*)::integer, 0)
  FROM public.token_sessions
  WHERE token_id = _token_id
    AND is_active = true
    AND last_seen_at > now() - interval '12 hours';
$function$;

-- 4. Fungsi batch: ambil jumlah sesi aktif untuk banyak token sekaligus
CREATE OR REPLACE FUNCTION public.get_tokens_active_sessions(_token_ids uuid[])
 RETURNS TABLE(token_id uuid, active_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ts.token_id, COUNT(*)::integer AS active_count
  FROM public.token_sessions ts
  WHERE ts.token_id = ANY(_token_ids)
    AND ts.is_active = true
    AND ts.last_seen_at > now() - interval '12 hours'
  GROUP BY ts.token_id;
$function$;