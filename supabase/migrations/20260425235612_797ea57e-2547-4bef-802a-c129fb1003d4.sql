-- Bucket storage untuk video background hero (public read, admin-only write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hero-videos',
  'hero-videos',
  true,
  10485760, -- 10 MB
  ARRAY['video/mp4','video/webm','video/quicktime']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public boleh baca (agar video bisa dimuat di landing)
DROP POLICY IF EXISTS "Hero videos public read" ON storage.objects;
CREATE POLICY "Hero videos public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'hero-videos');

-- Hanya admin yang boleh upload
DROP POLICY IF EXISTS "Admins upload hero videos" ON storage.objects;
CREATE POLICY "Admins upload hero videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'hero-videos' AND public.has_role(auth.uid(), 'admin'));

-- Hanya admin yang boleh update
DROP POLICY IF EXISTS "Admins update hero videos" ON storage.objects;
CREATE POLICY "Admins update hero videos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'hero-videos' AND public.has_role(auth.uid(), 'admin'));

-- Hanya admin yang boleh hapus
DROP POLICY IF EXISTS "Admins delete hero videos" ON storage.objects;
CREATE POLICY "Admins delete hero videos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'hero-videos' AND public.has_role(auth.uid(), 'admin'));