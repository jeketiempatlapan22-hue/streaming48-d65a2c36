-- Harden and normalize member photo table policies
DROP POLICY IF EXISTS "Admins can manage member photos" ON public.member_photos;
DROP POLICY IF EXISTS "Admins can insert member photos" ON public.member_photos;
DROP POLICY IF EXISTS "Admins can update member photos" ON public.member_photos;
DROP POLICY IF EXISTS "Admins can delete member photos" ON public.member_photos;

CREATE POLICY "Admins can insert member photos"
ON public.member_photos
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update member photos"
ON public.member_photos
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete member photos"
ON public.member_photos
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Recreate member photo storage policies with explicit authenticated admin access
DROP POLICY IF EXISTS "Admins can upload member photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update member photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete member photos" ON storage.objects;

CREATE POLICY "Admins can upload member photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'member-photos'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Admins can update member photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'member-photos'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
)
WITH CHECK (
  bucket_id = 'member-photos'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Admins can delete member photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'member-photos'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);