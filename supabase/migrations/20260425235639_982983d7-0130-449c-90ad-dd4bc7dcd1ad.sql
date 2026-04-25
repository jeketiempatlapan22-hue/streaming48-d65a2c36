-- Cegah listing seluruh isi bucket; izinkan akses object langsung lewat URL publik via storage CDN.
-- Pola yang sama dipakai bucket publik lain (mis. avatars/media) di project ini.
DROP POLICY IF EXISTS "Hero videos public read" ON storage.objects;

-- Tidak perlu policy SELECT eksplisit untuk publik:
-- objek di bucket public.* tetap dapat diakses via /storage/v1/object/public/<bucket>/<path>
-- selama bucket.public = true. Yang dibatasi adalah kemampuan listing.