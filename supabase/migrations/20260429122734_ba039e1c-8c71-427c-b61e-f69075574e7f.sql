
CREATE OR REPLACE FUNCTION public.validate_active_live_token(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_validation jsonb;
BEGIN
  -- validate_token sudah mengecek: token exists, status, expiry, replay-restriction,
  -- dan jeda membership global. Kembalikan apa adanya.
  base_validation := public.validate_token(_code);
  RETURN base_validation;
END;
$$;
