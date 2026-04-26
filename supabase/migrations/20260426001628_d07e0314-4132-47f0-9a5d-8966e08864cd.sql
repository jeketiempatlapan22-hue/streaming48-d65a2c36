INSERT INTO public.site_settings (key, value)
VALUES ('hero_video_brightness', '60')
ON CONFLICT (key) DO NOTHING;