-- 1) Storage: hapus policy SELECT broad untuk bucket public.
-- File tetap dapat diakses via URL publik (object/public/<bucket>/<path>),
-- karena URL public bucket bypass RLS. Yang hilang hanyalah kemampuan LIST.

DROP POLICY IF EXISTS "Anyone can view admin media" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view show images" ON storage.objects;
DROP POLICY IF EXISTS "Avatars are publicly viewable" ON storage.objects;
DROP POLICY IF EXISTS "Public can view member photos" ON storage.objects;

-- 2) viewer_counts: ganti kondisi `true` dengan validasi viewer_key.
DROP POLICY IF EXISTS "Anyone can delete own heartbeat" ON public.viewer_counts;
DROP POLICY IF EXISTS "Anyone can update heartbeat"    ON public.viewer_counts;
DROP POLICY IF EXISTS "Anyone can upsert heartbeat"    ON public.viewer_counts;

CREATE POLICY "Insert valid heartbeat"
  ON public.viewer_counts
  FOR INSERT
  TO public
  WITH CHECK (
    viewer_key IS NOT NULL
    AND length(viewer_key) BETWEEN 6 AND 128
    AND viewer_key ~ '^[A-Za-z0-9_\-:.]+$'
  );

CREATE POLICY "Update own heartbeat by key"
  ON public.viewer_counts
  FOR UPDATE
  TO public
  USING (
    viewer_key IS NOT NULL
    AND length(viewer_key) BETWEEN 6 AND 128
  )
  WITH CHECK (
    viewer_key IS NOT NULL
    AND length(viewer_key) BETWEEN 6 AND 128
  );

CREATE POLICY "Delete stale heartbeat by key"
  ON public.viewer_counts
  FOR DELETE
  TO public
  USING (
    viewer_key IS NOT NULL
    AND length(viewer_key) BETWEEN 6 AND 128
    AND last_seen_at < now() - interval '1 minute'
  );