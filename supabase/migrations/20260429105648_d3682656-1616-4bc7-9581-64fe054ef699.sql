DROP FUNCTION IF EXISTS public.get_public_shows();

CREATE FUNCTION public.get_public_shows()
RETURNS TABLE(
  id uuid,
  title text,
  price text,
  lineup text,
  schedule_date text,
  schedule_time text,
  background_image_url text,
  qris_image_url text,
  is_subscription boolean,
  max_subscribers integer,
  subscription_benefits text,
  group_link text,
  is_order_closed boolean,
  category text,
  category_member text,
  coin_price integer,
  replay_coin_price integer,
  is_replay boolean,
  access_password text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  qris_price integer,
  membership_duration_days integer,
  short_id text,
  external_show_id text,
  replay_qris_price integer,
  team text,
  is_bundle boolean,
  bundle_description text,
  bundle_duration_days integer,
  bundle_replay_passwords jsonb,
  bundle_replay_info text,
  has_replay_media boolean,
  replay_month text,
  replay_youtube_url text,
  exclude_from_membership boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    s.id,
    s.title,
    s.price,
    s.lineup,
    s.schedule_date,
    s.schedule_time,
    s.background_image_url,
    s.qris_image_url,
    s.is_subscription,
    s.max_subscribers,
    s.subscription_benefits,
    s.group_link,
    s.is_order_closed,
    s.category,
    s.category_member,
    s.coin_price,
    s.replay_coin_price,
    s.is_replay,
    NULL::text AS access_password,
    s.is_active,
    s.created_at,
    s.updated_at,
    s.qris_price,
    s.membership_duration_days,
    s.short_id,
    s.external_show_id,
    s.replay_qris_price,
    s.team,
    s.is_bundle,
    s.bundle_description,
    s.bundle_duration_days,
    NULL::jsonb AS bundle_replay_passwords,
    s.bundle_replay_info,
    (COALESCE(NULLIF(s.replay_m3u8_url, ''), NULLIF(s.replay_youtube_url, '')) IS NOT NULL) AS has_replay_media,
    s.replay_month,
    s.replay_youtube_url,
    COALESCE(s.exclude_from_membership, false) AS exclude_from_membership
  FROM public.shows s
  WHERE s.is_active = true
  ORDER BY s.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_shows() TO anon, authenticated;