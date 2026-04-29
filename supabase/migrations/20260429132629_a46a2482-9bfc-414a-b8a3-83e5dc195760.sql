CREATE OR REPLACE FUNCTION public.reseller_get_active_shows(_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _reseller_id uuid; _result jsonb;
BEGIN
  _reseller_id := public.validate_reseller_session(_session_token);
  IF _reseller_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Sesi tidak valid'); END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', s.id, 'title', s.title, 'price', s.price,
    'schedule_date', s.schedule_date, 'schedule_time', s.schedule_time,
    'lineup', s.lineup, 'team', s.team, 'category', s.category,
    'is_replay', s.is_replay, 'is_subscription', s.is_subscription, 'is_bundle', s.is_bundle,
    'access_password', s.access_password,
    'bundle_replay_info', s.bundle_replay_info,
    'bundle_replay_passwords', s.bundle_replay_passwords,
    'background_image_url', s.background_image_url, 'short_id', s.short_id,
    'membership_duration_days', s.membership_duration_days
  ) ORDER BY s.created_at DESC) INTO _result
  FROM public.shows s
  WHERE s.is_active = true
    AND COALESCE(s.is_replay, false) = false;

  RETURN jsonb_build_object('success', true, 'shows', COALESCE(_result, '[]'::jsonb));
END;
$function$;