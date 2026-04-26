-- =========================================================
-- FIX 1: reseller_stats total_tokens calculation
-- =========================================================
-- Sebelumnya total_tokens dihitung COUNT(*) dari hasil GROUP BY show_id,
-- sehingga hanya menghitung jumlah show distinct, bukan jumlah token sebenarnya.
CREATE OR REPLACE FUNCTION public.reseller_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _result jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'reseller_id', r.id,
    'name', r.name,
    'phone', r.phone,
    'prefix', r.wa_command_prefix,
    'is_active', r.is_active,
    'created_at', r.created_at,
    'notes', r.notes,
    'total_tokens', COALESCE(tk.total, 0),
    'active_tokens', COALESCE(tk.active, 0),
    'expired_tokens', COALESCE(tk.expired, 0),
    'blocked_tokens', COALESCE(tk.blocked, 0),
    'per_show', COALESCE(ps.per_show, '[]'::jsonb)
  ) ORDER BY r.created_at DESC) INTO _result
  FROM public.resellers r
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())) AS active,
      COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= now()) AS expired,
      COUNT(*) FILTER (WHERE status = 'blocked') AS blocked
    FROM public.tokens
    WHERE reseller_id = r.id
  ) tk ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'show_id', sub.show_id,
      'show_title', sub.show_title,
      'count', sub.cnt
    ) ORDER BY sub.cnt DESC) AS per_show
    FROM (
      SELECT t.show_id, s.title AS show_title, COUNT(*) AS cnt
      FROM public.tokens t
      LEFT JOIN public.shows s ON s.id = t.show_id
      WHERE t.reseller_id = r.id
      GROUP BY t.show_id, s.title
    ) sub
  ) ps ON true;

  RETURN jsonb_build_object('success', true, 'stats', COALESCE(_result, '[]'::jsonb));
END;
$function$;

-- =========================================================
-- FIX 2: request_password_reset(text) - simpan plaintext token
-- =========================================================
-- Sebelumnya overload 1-arg menyimpan hash sehingga link yang
-- disalin admin (pakai DB row) berbeda dengan plaintext yang
-- dikembalikan ke user. Konsisten-kan agar selalu plaintext,
-- sama dengan overload 2-arg dan edge function request-password-reset.
CREATE OR REPLACE FUNCTION public.request_password_reset(_identifier text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid; _phone text; _username text; _short_id text;
  _normalized text; _email_lookup text; _allowed boolean;
  _secure_token text;
BEGIN
  _normalized := trim(_identifier);
  IF _normalized = '' THEN RETURN json_build_object('success', false, 'error', 'Masukkan nomor HP atau email'); END IF;

  SELECT public.check_rate_limit('pw_reset:' || _normalized, 3, 600) INTO _allowed;
  IF NOT _allowed THEN
    RETURN json_build_object('success', false, 'error', 'Terlalu banyak percobaan. Tunggu beberapa menit.');
  END IF;

  IF _normalized ~ '^[0-9]' THEN
    _email_lookup := regexp_replace(_normalized, '[^0-9]', '', 'g') || '@rt48.user';
  ELSE
    _email_lookup := _normalized;
  END IF;

  SELECT id INTO _user_id FROM auth.users WHERE email = _email_lookup;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Akun tidak ditemukan');
  END IF;

  IF EXISTS (SELECT 1 FROM public.password_reset_requests WHERE user_id = _user_id AND status = 'pending' AND created_at > now() - interval '1 hour') THEN
    RETURN json_build_object('success', false, 'error', 'Sudah ada permintaan reset yang belum diproses. Tunggu admin mengkonfirmasi.');
  END IF;

  SELECT username INTO _username FROM public.profiles WHERE id = _user_id;

  IF _normalized ~ '^[0-9]' THEN
    _phone := regexp_replace(_normalized, '[^0-9]', '', 'g');
  ELSE
    _phone := '';
  END IF;

  -- Generate plaintext token & simpan APA ADANYA (bukan hash) supaya
  -- link yang disalin admin maupun yang dikirim ke user identik dengan
  -- nilai yang dipakai apply-password-reset.
  _secure_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.password_reset_requests (user_id, identifier, phone, secure_token)
  VALUES (_user_id, _normalized, _phone, _secure_token)
  RETURNING short_id INTO _short_id;

  RETURN json_build_object(
    'success', true,
    'short_id', _short_id,
    'username', COALESCE(_username, ''),
    'secure_token', _secure_token
  );
END;
$function$;