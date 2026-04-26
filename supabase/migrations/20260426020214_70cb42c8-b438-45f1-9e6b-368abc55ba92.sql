-- Add missing UPDATE policy for member-photos bucket (needed for upsert)
CREATE POLICY "Admins can update member photos"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'member-photos' AND has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'member-photos' AND has_role(auth.uid(), 'admin'::app_role));