CREATE OR REPLACE FUNCTION public.get_public_shows()
 RETURNS SETOF shows
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    id, title, price, lineup, schedule_date, schedule_time,
    background_image_url, qris_image_url, is_subscription, max_subscribers,
    subscription_benefits, group_link, is_order_closed, category, category_member,
    coin_price, replay_coin_price, is_replay,
    NULL::text as access_password,
    is_active, created_at, updated_at,
    qris_price,
    membership_duration_days,
    short_id,
    external_show_id,
    replay_qris_price
  FROM public.shows WHERE is_active = true ORDER BY created_at DESC;
$function$;