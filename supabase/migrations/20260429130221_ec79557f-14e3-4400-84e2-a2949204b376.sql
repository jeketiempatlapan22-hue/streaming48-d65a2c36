CREATE OR REPLACE FUNCTION public.set_membership_pause_bot(_paused boolean, _source text DEFAULT 'bot')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _affected integer := 0;
BEGIN
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

  RETURN jsonb_build_object('success', true, 'paused', _paused, 'sessions_terminated', _affected);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_membership_pause_bot(boolean, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_membership_pause_bot(boolean, text) TO service_role;