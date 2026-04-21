-- 1) Allow one payment per (reseller, show) and free the token_id uniqueness
ALTER TABLE public.reseller_payments DROP CONSTRAINT IF EXISTS reseller_payments_token_id_key;
ALTER TABLE public.reseller_payments ALTER COLUMN token_id DROP NOT NULL;

-- Deduplicate any existing rows that would violate the new (reseller_id, show_id) uniqueness
-- Keep the earliest paid_at per (reseller_id, show_id)
DELETE FROM public.reseller_payments rp
USING public.reseller_payments rp2
WHERE rp.reseller_id = rp2.reseller_id
  AND rp.show_id IS NOT NULL
  AND rp2.show_id IS NOT NULL
  AND rp.show_id = rp2.show_id
  AND rp.paid_at > rp2.paid_at;

CREATE UNIQUE INDEX IF NOT EXISTS reseller_payments_reseller_show_uidx
  ON public.reseller_payments (reseller_id, show_id)
  WHERE show_id IS NOT NULL;

-- 2) Replace mark-paid RPC: now accepts SHOW short_id and marks the show as paid (idempotent per reseller+show)
CREATE OR REPLACE FUNCTION public.reseller_mark_paid_by_short(
  _reseller_phone text,
  _token_short text,
  _admin_note text DEFAULT 'WA admin'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reseller resellers%ROWTYPE;
  v_show shows%ROWTYPE;
  v_short text;
  v_existing reseller_payments%ROWTYPE;
  v_payment reseller_payments%ROWTYPE;
  v_token_count int;
BEGIN
  -- Find reseller by phone (normalized)
  SELECT * INTO v_reseller FROM resellers
  WHERE regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(_reseller_phone, '[^0-9]', '', 'g')
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan');
  END IF;

  v_short := lower(regexp_replace(_token_short, '[^A-Za-z0-9]', '', 'g'));
  IF length(v_short) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Short ID show minimal 3 karakter');
  END IF;

  -- Find show by short_id (case-insensitive). Restrict to shows the reseller has issued tokens for.
  SELECT s.* INTO v_show
  FROM shows s
  WHERE lower(s.short_id) = v_short
    AND EXISTS (
      SELECT 1 FROM tokens t
      WHERE t.reseller_id = v_reseller.id AND t.show_id = s.id
    )
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Fallback: allow marking a show even without tokens yet (rare), but only if short_id matches a real show
    SELECT * INTO v_show FROM shows WHERE lower(short_id) = v_short LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format('Show dengan ID #%s tidak ditemukan untuk reseller %s', v_short, v_reseller.name)
      );
    END IF;
  END IF;

  SELECT count(*) INTO v_token_count
  FROM tokens
  WHERE reseller_id = v_reseller.id AND show_id = v_show.id;

  -- Idempotent per (reseller, show)
  SELECT * INTO v_existing
  FROM reseller_payments
  WHERE reseller_id = v_reseller.id AND show_id = v_show.id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_paid', true,
      'payment_id', v_existing.id,
      'reseller_name', v_reseller.name,
      'reseller_phone', v_reseller.phone,
      'show_id', v_show.id,
      'show_title', v_show.title,
      'show_short_id', v_show.short_id,
      'token_count', v_token_count,
      'paid_at', v_existing.paid_at
    );
  END IF;

  INSERT INTO reseller_payments (
    reseller_id, token_id, show_id,
    token_code, token_short,
    show_title, show_short_id,
    paid_by_admin, notes
  ) VALUES (
    v_reseller.id, NULL, v_show.id,
    '-', v_show.short_id,
    v_show.title, v_show.short_id,
    'WA admin', COALESCE(_admin_note, 'WA admin')
  ) RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'success', true,
    'already_paid', false,
    'payment_id', v_payment.id,
    'reseller_name', v_reseller.name,
    'reseller_phone', v_reseller.phone,
    'show_id', v_show.id,
    'show_title', v_show.title,
    'show_short_id', v_show.short_id,
    'token_count', v_token_count,
    'paid_at', v_payment.paid_at
  );
END;
$function$;

-- 3) Reseller list payments: one row per show
CREATE OR REPLACE FUNCTION public.reseller_list_my_payments(
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
  v_payments jsonb;
BEGIN
  v_reseller_id := validate_reseller_session(_session_token);
  IF v_reseller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid');
  END IF;

  SELECT COALESCE(jsonb_agg(p ORDER BY p.paid_at DESC), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT
      rp.id,
      rp.show_id,
      rp.show_title,
      rp.show_short_id,
      rp.paid_at,
      rp.paid_by_admin,
      rp.notes,
      (
        SELECT count(*) FROM tokens t
        WHERE t.reseller_id = rp.reseller_id AND t.show_id = rp.show_id
      ) AS token_count
    FROM reseller_payments rp
    WHERE rp.reseller_id = v_reseller_id
      AND rp.show_id IS NOT NULL
    ORDER BY rp.paid_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 500))
  ) p;

  RETURN jsonb_build_object('success', true, 'payments', v_payments);
END;
$function$;

-- 4) Admin list payments: one row per show
CREATE OR REPLACE FUNCTION public.admin_list_reseller_payments(
  _reseller_id uuid DEFAULT NULL::uuid,
  _limit integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payments jsonb;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(p ORDER BY p.paid_at DESC), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT
      rp.id,
      rp.show_id,
      rp.show_title,
      rp.show_short_id,
      rp.paid_at,
      rp.paid_by_admin,
      rp.notes,
      rp.reseller_id,
      r.name AS reseller_name,
      r.phone AS reseller_phone,
      r.wa_command_prefix AS reseller_prefix,
      (
        SELECT count(*) FROM tokens t
        WHERE t.reseller_id = rp.reseller_id AND t.show_id = rp.show_id
      ) AS token_count
    FROM reseller_payments rp
    JOIN resellers r ON r.id = rp.reseller_id
    WHERE rp.show_id IS NOT NULL
      AND (_reseller_id IS NULL OR rp.reseller_id = _reseller_id)
    ORDER BY rp.paid_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 1000))
  ) p;

  RETURN jsonb_build_object('success', true, 'payments', v_payments);
END;
$function$;

-- 5) Reseller list tokens: paid status now derived from per-show payment
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