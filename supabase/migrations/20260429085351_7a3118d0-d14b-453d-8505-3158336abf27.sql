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
      -- Shows redeemed via coins/order specifically for THIS show (per-show purchase)
      s.id::text IN (
        SELECT DISTINCT ct.reference_id
        FROM public.coin_transactions ct
        WHERE ct.user_id = auth.uid()
          AND ct.type IN ('redeem', 'replay_redeem')
          AND ct.reference_id IS NOT NULL
      )
      OR
      -- Shows where user has an active, non-expired per-show token
      -- IMPORTANT: exclude universal tokens (MBR-/MRD-/BDL-/RT48-) — those are handled by
      -- get_membership_show_passwords which respects exclude_from_membership.
      s.id IN (
        SELECT t.show_id
        FROM public.tokens t
        WHERE t.user_id = auth.uid()
          AND t.status = 'active'
          AND t.show_id IS NOT NULL
          AND (t.expires_at IS NULL OR t.expires_at > now())
          AND NOT (
            t.code ILIKE 'MBR-%' OR t.code ILIKE 'MRD-%'
            OR t.code ILIKE 'BDL-%' OR t.code ILIKE 'RT48-%'
          )
      )
    );

  RETURN COALESCE(_result, '{}'::json);
END;
$function$;