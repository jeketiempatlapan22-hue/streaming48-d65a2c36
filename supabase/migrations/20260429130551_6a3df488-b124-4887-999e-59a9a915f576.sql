-- Pastikan tidak ada akses non-service-role
REVOKE EXECUTE ON FUNCTION public.set_membership_pause_bot(boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_membership_pause_bot(boolean, text) TO service_role;

-- Tambahkan guard di dalam fungsi (defense in depth)
CREATE OR REPLACE FUNCTION public.set_membership_pause_bot(_paused boolean, _source text DEFAULT 'bot')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _affected integer := 0;
  _caller_role text := current_setting('request.jwt.claim.role', true);
  _allowed_sources text[] := ARRAY['whatsapp', 'telegram', 'bot'];
BEGIN
  -- Hanya service_role yang boleh memanggil (bot WA/Telegram pakai SERVICE_ROLE_KEY).
  -- auth.role() == 'service_role' saat dipanggil dengan service key.
  IF auth.role() <> 'service_role' AND COALESCE(_caller_role, '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: bot RPC requires service role'
      USING ERRCODE = '42501';
  END IF;

  -- Validasi sumber agar log audit jelas
  IF _source IS NULL OR NOT (_source = ANY(_allowed_sources)) THEN
    RAISE EXCEPTION 'invalid source: %', _source USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.site_settings (key, value)
  VALUES ('membership_paused', CASE WHEN _paused THEN 'true' ELSE 'false' END)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  IF _paused THEN
    UPDATE public.token_sessions ts
    SET is_active = false
    FROM public.tokens t
    WHERE ts.token_id = t.id
      AND ts.is_active = true
      AND (upper(t.code) LIKE 'MBR-%' OR upper(t.code) LIKE 'MRD-%');
    GET DIAGNOSTICS _affected = ROW_COUNT;

    INSERT INTO public.admin_notifications (title, message, type)
    VALUES (
      '⏸️ Akses Membership Dijeda',
      format('Dijeda via %s. %s sesi aktif diputus.', _source, _affected),
      'membership_pause'
    );
  ELSE
    INSERT INTO public.admin_notifications (title, message, type)
    VALUES (
      '▶️ Akses Membership Diaktifkan',
      format('Diaktifkan via %s.', _source),
      'membership_resume'
    );
  END IF;

  -- Audit log
  INSERT INTO public.security_events (event_type, description, severity)
  VALUES (
    'membership_pause_toggle',
    format('source=%s paused=%s sessions_terminated=%s', _source, _paused, _affected),
    'low'
  );

  RETURN jsonb_build_object('success', true, 'paused', _paused, 'sessions_terminated', _affected, 'source', _source);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_membership_pause_bot(boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_membership_pause_bot(boolean, text) TO service_role;