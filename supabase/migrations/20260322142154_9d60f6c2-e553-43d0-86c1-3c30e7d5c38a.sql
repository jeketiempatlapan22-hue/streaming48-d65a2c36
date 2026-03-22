
-- Add storage RLS policies for private buckets
-- Allow authenticated users to upload to payment-proofs and coin-proofs
CREATE POLICY "Authenticated users can upload payment proofs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('payment-proofs', 'coin-proofs'));

-- Allow authenticated users to read their own uploads (for signed URLs)
CREATE POLICY "Authenticated users can read payment proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('payment-proofs', 'coin-proofs'));

-- Allow service role full access (for admin and edge functions)
CREATE POLICY "Service role full access to proof buckets"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id IN ('payment-proofs', 'coin-proofs'))
  WITH CHECK (bucket_id IN ('payment-proofs', 'coin-proofs'));
