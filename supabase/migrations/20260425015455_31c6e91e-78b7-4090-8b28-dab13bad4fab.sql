-- ============================
-- restream_codes table
-- ============================
CREATE TABLE IF NOT EXISTS public.restream_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_restream_codes_code_lower
  ON public.restream_codes (lower(code));

CREATE INDEX IF NOT EXISTS idx_restream_codes_active
  ON public.restream_codes (is_active)
  WHERE is_active = true;

ALTER TABLE public.restream_codes ENABLE ROW LEVEL SECURITY;

-- Only admins can read/manage. Public/anon CANNOT see codes (validation goes
-- through SECURITY DEFINER RPC instead).
CREATE POLICY "Admins manage restream codes"
  ON public.restream_codes
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Anon cannot read restream codes"
  ON public.restream_codes
  FOR SELECT
  TO anon
  USING (false);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_restream_codes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restream_codes_updated_at ON public.restream_codes;
CREATE TRIGGER trg_restream_codes_updated_at
  BEFORE UPDATE ON public.restream_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_restream_codes_updated_at();

-- ============================
-- playlists.is_restream flag
-- ============================
ALTER TABLE public.playlists
  ADD COLUMN IF NOT EXISTS is_restream BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_playlists_is_restream
  ON public.playlists (is_restream)
  WHERE is_restream = true;

-- ============================
-- validate_restream_code RPC
-- Returns { valid: bool, code_id?: uuid }
-- SECURITY DEFINER so anon can call without seeing the table.
-- ============================
CREATE OR REPLACE FUNCTION public.validate_restream_code(_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF _code IS NULL OR length(trim(_code)) = 0 OR length(_code) > 200 THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  SELECT id INTO v_id
  FROM public.restream_codes
  WHERE lower(code) = lower(trim(_code))
    AND is_active = true
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  RETURN jsonb_build_object('valid', true, 'code_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_restream_code(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_restream_code(TEXT) TO anon, authenticated;

-- ============================
-- touch_restream_code_usage RPC
-- Bumps last_used_at when a code is consumed (called from edge function or client).
-- ============================
CREATE OR REPLACE FUNCTION public.touch_restream_code_usage(_code TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _code IS NULL OR length(trim(_code)) = 0 OR length(_code) > 200 THEN
    RETURN;
  END IF;
  UPDATE public.restream_codes
     SET last_used_at = now()
   WHERE lower(code) = lower(trim(_code))
     AND is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_restream_code_usage(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.touch_restream_code_usage(TEXT) TO anon, authenticated;

-- ============================
-- get_restream_playlists RPC
-- Returns list of playlists flagged for restream.
-- Requires a valid code so unauthenticated users can't enumerate playlists.
-- ============================
CREATE OR REPLACE FUNCTION public.get_restream_playlists(_code TEXT)
RETURNS TABLE (
  id UUID,
  title TEXT,
  type TEXT,
  url TEXT,
  sort_order INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valid BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.restream_codes
     WHERE lower(code) = lower(trim(_code))
       AND is_active = true
  ) INTO v_valid;

  IF NOT v_valid THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT p.id, p.title, p.type, p.url, p.sort_order
    FROM public.playlists p
    WHERE p.is_restream = true
      AND p.is_active = true
    ORDER BY p.sort_order ASC, p.title ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_restream_playlists(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.get_restream_playlists(TEXT) TO anon, authenticated;