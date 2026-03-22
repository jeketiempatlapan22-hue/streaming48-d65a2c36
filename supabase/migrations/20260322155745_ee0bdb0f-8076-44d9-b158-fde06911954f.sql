-- Create admin-media bucket for storing reusable images (QRIS, backgrounds, etc.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('admin-media', 'admin-media', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: Only admins can upload/manage files in admin-media
CREATE POLICY "Admins can manage admin media"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'admin-media' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'admin-media' AND public.has_role(auth.uid(), 'admin'));

-- Anyone can view admin-media files (they're public images like QRIS)
CREATE POLICY "Anyone can view admin media"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'admin-media');