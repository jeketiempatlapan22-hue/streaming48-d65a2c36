
-- Drop & recreate RPCs first (they depend on column)
DROP FUNCTION IF EXISTS public.get_public_shows();
DROP FUNCTION IF EXISTS public.get_membership_show_passwords();

-- Recreate get_membership_show_passwords without exclude filter
CREATE FUNCTION public.get_membership_show_passwords()
RETURNS TABLE(show_id uuid, access_password text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.access_password
  FROM public.shows s
  WHERE s.access_password IS NOT NULL
    AND s.access_password <> ''
    AND s.is_active = true;
$$;
GRANT EXECUTE ON FUNCTION public.get_membership_show_passwords() TO anon, authenticated;

-- Recreate get_public_shows without exclude_from_membership
CREATE FUNCTION public.get_public_shows()
RETURNS TABLE(
  id uuid, title text, price text, lineup text, schedule_date text, schedule_time text,
  background_image_url text, qris_image_url text, is_subscription boolean, max_subscribers integer,
  subscription_benefits text, group_link text, is_order_closed boolean, category text,
  category_member text, coin_price integer, replay_coin_price integer, is_replay boolean,
  access_password text, is_active boolean, created_at timestamptz, updated_at timestamptz,
  qris_price integer, membership_duration_days integer, short_id text, external_show_id text,
  replay_qris_price integer, team text, is_bundle boolean, bundle_description text,
  bundle_duration_days integer, bundle_replay_passwords jsonb, bundle_replay_info text,
  has_replay_media boolean, replay_month text, replay_youtube_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id, s.title, s.price, s.lineup, s.schedule_date, s.schedule_time,
    s.background_image_url, s.qris_image_url, s.is_subscription, s.max_subscribers,
    s.subscription_benefits, s.group_link, s.is_order_closed, s.category,
    s.category_member, s.coin_price, s.replay_coin_price, s.is_replay,
    s.access_password, s.is_active, s.created_at, s.updated_at,
    s.qris_price, s.membership_duration_days, s.short_id, s.external_show_id,
    s.replay_qris_price, s.team, s.is_bundle, s.bundle_description,
    s.bundle_duration_days, s.bundle_replay_passwords, s.bundle_replay_info,
    (s.replay_m3u8_url IS NOT NULL AND s.replay_m3u8_url <> '') OR
    (s.replay_youtube_url IS NOT NULL AND s.replay_youtube_url <> '') AS has_replay_media,
    s.replay_month, s.replay_youtube_url
  FROM public.shows s
  WHERE s.is_active = true
  ORDER BY s.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_public_shows() TO anon, authenticated;

-- Now safe to drop the column
ALTER TABLE public.shows DROP COLUMN IF EXISTS exclude_from_membership;
