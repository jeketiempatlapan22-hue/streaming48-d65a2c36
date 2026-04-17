-- Update get_purchased_show_passwords to ALSO include shows where the user has an active token
-- This ensures membership/bundle/custom token holders can see access passwords for their shows.
CREATE OR REPLACE FUNCTION public.get_purchased_show_passwords()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result json;
BEGIN
  SELECT json_object_agg(s.id::text, s.access_password) INTO _result
  FROM public.shows s
  WHERE s.is_active = true
    AND s.access_password IS NOT NULL
    AND s.access_password != ''
    AND (
      -- Shows redeemed via coins
      s.id::text IN (
        SELECT DISTINCT ct.reference_id
        FROM public.coin_transactions ct
        WHERE ct.user_id = auth.uid()
          AND ct.type IN ('redeem', 'replay_redeem', 'membership_redeem')
          AND ct.reference_id IS NOT NULL
      )
      OR
      -- Shows where user has an active, non-expired token (covers membership, bundle, regular order tokens)
      s.id IN (
        SELECT t.show_id
        FROM public.tokens t
        WHERE t.user_id = auth.uid()
          AND t.status = 'active'
          AND t.show_id IS NOT NULL
          AND (t.expires_at IS NULL OR t.expires_at > now())
      )
    );

  RETURN COALESCE(_result, '{}'::json);
END;
$function$;