
-- =========================================================
-- Reseller Payments: history per show + admin confirmation
-- =========================================================

-- 1. Table to track payments per token (each token = 1 show purchase by reseller)
CREATE TABLE IF NOT EXISTS public.reseller_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id uuid NOT NULL REFERENCES public.resellers(id) ON DELETE CASCADE,
  token_id uuid NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  show_id uuid REFERENCES public.shows(id) ON DELETE CASCADE,
  token_code text NOT NULL,
  token_short text NOT NULL,
  show_title text,
  show_short_id text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  paid_by_admin text NOT NULL DEFAULT 'system',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token_id)
);

-- Indexes for fast lookup per reseller / show
CREATE INDEX IF NOT EXISTS idx_reseller_payments_reseller ON public.reseller_payments(reseller_id);
CREATE INDEX IF NOT EXISTS idx_reseller_payments_show ON public.reseller_payments(show_id);
CREATE INDEX IF NOT EXISTS idx_reseller_payments_short ON public.reseller_payments(reseller_id, token_short);

-- Enable RLS
ALTER TABLE public.reseller_payments ENABLE ROW LEVEL SECURITY;

-- Admin full access
DROP POLICY IF EXISTS "Admins manage reseller payments" ON public.reseller_payments;
CREATE POLICY "Admins manage reseller payments"
ON public.reseller_payments FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Block public access
DROP POLICY IF EXISTS "Anon cannot read reseller payments" ON public.reseller_payments;
CREATE POLICY "Anon cannot read reseller payments"
ON public.reseller_payments FOR SELECT
TO anon
USING (false);

-- Service role full access (for edge functions / RPCs)
DROP POLICY IF EXISTS "Service role manage reseller payments" ON public.reseller_payments;
CREATE POLICY "Service role manage reseller payments"
ON public.reseller_payments FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- =========================================================
-- 2. RPC: mark payment by reseller phone + token short id (4 digit)
--    Admin-only, called from WhatsApp bot via /{prefix}paid {short}
-- =========================================================
CREATE OR REPLACE FUNCTION public.reseller_mark_paid_by_short(
  _reseller_phone text,
  _token_short text,
  _admin_note text DEFAULT 'WA admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reseller resellers%ROWTYPE;
  v_token tokens%ROWTYPE;
  v_show shows%ROWTYPE;
  v_short text;
  v_existing reseller_payments%ROWTYPE;
  v_payment reseller_payments%ROWTYPE;
BEGIN
  -- Find reseller by phone (normalized)
  SELECT * INTO v_reseller FROM resellers
  WHERE regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(_reseller_phone, '[^0-9]', '', 'g')
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reseller tidak ditemukan');
  END IF;

  v_short := upper(regexp_replace(_token_short, '[^A-Za-z0-9]', '', 'g'));
  IF length(v_short) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Short ID minimal 4 karakter');
  END IF;

  -- Find token belonging to this reseller, matching last 4 chars OR full code
  SELECT * INTO v_token FROM tokens
  WHERE reseller_id = v_reseller.id
    AND (
      upper(right(code, 4)) = v_short
      OR upper(code) = v_short
    )
  ORDER BY created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', format('Token #%s tidak ditemukan untuk reseller %s', v_short, v_reseller.name));
  END IF;

  -- Look up show info
  IF v_token.show_id IS NOT NULL THEN
    SELECT * INTO v_show FROM shows WHERE id = v_token.show_id LIMIT 1;
  END IF;

  -- Idempotency: if already paid, return existing
  SELECT * INTO v_existing FROM reseller_payments WHERE token_id = v_token.id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_paid', true,
      'payment_id', v_existing.id,
      'reseller_name', v_reseller.name,
      'reseller_phone', v_reseller.phone,
      'token_code', v_token.code,
      'token_short', v_existing.token_short,
      'show_title', v_existing.show_title,
      'show_short_id', v_existing.show_short_id,
      'paid_at', v_existing.paid_at
    );
  END IF;

  INSERT INTO reseller_payments (
    reseller_id, token_id, show_id,
    token_code, token_short,
    show_title, show_short_id,
    paid_by_admin, notes
  ) VALUES (
    v_reseller.id, v_token.id, v_token.show_id,
    v_token.code, upper(right(v_token.code, 4)),
    COALESCE(v_show.title, 'Show'),
    v_show.short_id,
    'whatsapp_admin',
    COALESCE(_admin_note, '')
  )
  RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'success', true,
    'already_paid', false,
    'payment_id', v_payment.id,
    'reseller_id', v_reseller.id,
    'reseller_name', v_reseller.name,
    'reseller_phone', v_reseller.phone,
    'reseller_prefix', v_reseller.wa_command_prefix,
    'token_code', v_token.code,
    'token_short', v_payment.token_short,
    'show_title', v_payment.show_title,
    'show_short_id', v_payment.show_short_id,
    'paid_at', v_payment.paid_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reseller_mark_paid_by_short(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reseller_mark_paid_by_short(text, text, text) TO service_role, authenticated;

-- =========================================================
-- 3. RPC: reseller's own payment list (web dashboard)
-- =========================================================
CREATE OR REPLACE FUNCTION public.reseller_list_my_payments(
  _session_token text,
  _limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      rp.token_id,
      rp.token_code,
      rp.token_short,
      rp.show_id,
      rp.show_title,
      rp.show_short_id,
      rp.paid_at,
      rp.paid_by_admin,
      rp.notes
    FROM reseller_payments rp
    WHERE rp.reseller_id = v_reseller_id
    ORDER BY rp.paid_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 500))
  ) p;

  RETURN jsonb_build_object('success', true, 'payments', v_payments);
END;
$$;

REVOKE ALL ON FUNCTION public.reseller_list_my_payments(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reseller_list_my_payments(text, integer) TO service_role, authenticated, anon;

-- =========================================================
-- 4. RPC: admin list payments per reseller (for admin panel)
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_list_reseller_payments(
  _reseller_id uuid DEFAULT NULL,
  _limit integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      rp.id, rp.token_id, rp.token_code, rp.token_short,
      rp.show_id, rp.show_title, rp.show_short_id,
      rp.paid_at, rp.paid_by_admin, rp.notes,
      rp.reseller_id,
      r.name AS reseller_name,
      r.phone AS reseller_phone,
      r.wa_command_prefix AS reseller_prefix
    FROM reseller_payments rp
    JOIN resellers r ON r.id = rp.reseller_id
    WHERE _reseller_id IS NULL OR rp.reseller_id = _reseller_id
    ORDER BY rp.paid_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 1000))
  ) p;

  RETURN jsonb_build_object('success', true, 'payments', v_payments);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_reseller_payments(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_reseller_payments(uuid, integer) TO authenticated;

-- =========================================================
-- 5. Patch reseller_list_my_tokens to include `is_paid` flag
--    so reseller dashboard can show ✅ on paid tokens.
-- =========================================================
CREATE OR REPLACE FUNCTION public.reseller_list_my_tokens(
  _session_token text,
  _limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      EXISTS (SELECT 1 FROM reseller_payments rp WHERE rp.token_id = tk.id) AS is_paid,
      (SELECT rp.paid_at FROM reseller_payments rp WHERE rp.token_id = tk.id LIMIT 1) AS paid_at
    FROM tokens tk
    LEFT JOIN shows s ON s.id = tk.show_id
    WHERE tk.reseller_id = v_reseller_id
    ORDER BY tk.created_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 500))
  ) t;

  RETURN jsonb_build_object('success', true, 'tokens', v_tokens);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reseller_list_my_tokens(text, integer) TO service_role, authenticated, anon;

-- =========================================================
-- 6. Trigger: when a show is deleted, cascade delete tokens of that show
--    (so reseller_payments ALSO get cleaned via tokens.id FK CASCADE).
--    This guarantees: admin deletes show → tokens gone → payments gone
--    → no longer visible on reseller or admin panels.
-- =========================================================
CREATE OR REPLACE FUNCTION public.cascade_delete_tokens_on_show_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete tokens linked to this show (this will CASCADE to token_sessions and reseller_payments)
  DELETE FROM tokens WHERE show_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_tokens_on_show_delete ON public.shows;
CREATE TRIGGER trg_cascade_tokens_on_show_delete
BEFORE DELETE ON public.shows
FOR EACH ROW
EXECUTE FUNCTION public.cascade_delete_tokens_on_show_delete();
