-- 1) Trigger function: force duration_type='membership' for membership-show tokens
CREATE OR REPLACE FUNCTION public.normalize_membership_token_duration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_sub BOOLEAN;
BEGIN
  IF NEW.show_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(is_subscription, false) INTO _is_sub
  FROM public.shows
  WHERE id = NEW.show_id
  LIMIT 1;

  IF _is_sub IS TRUE THEN
    NEW.duration_type := 'membership';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_membership_token_duration() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.normalize_membership_token_duration() TO service_role, postgres;

-- 2) BEFORE INSERT/UPDATE trigger so the value is set before the row hits disk
DROP TRIGGER IF EXISTS trg_normalize_membership_token_duration ON public.tokens;
CREATE TRIGGER trg_normalize_membership_token_duration
BEFORE INSERT OR UPDATE OF show_id, duration_type ON public.tokens
FOR EACH ROW
EXECUTE FUNCTION public.normalize_membership_token_duration();

-- 3) Backfill existing tokens for membership shows
UPDATE public.tokens t
SET duration_type = 'membership'
FROM public.shows s
WHERE s.id = t.show_id
  AND COALESCE(s.is_subscription, false) = true
  AND COALESCE(t.duration_type, '') <> 'membership';