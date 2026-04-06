ALTER TABLE public.playlists
DROP CONSTRAINT IF EXISTS playlists_type_check;

ALTER TABLE public.playlists
ADD CONSTRAINT playlists_type_check
CHECK (type IN ('m3u8', 'cloudflare', 'youtube', 'proxy', 'direct'));