
-- 1. Tutup akses anonim ke bucket payment-proofs & coin-proofs
DROP POLICY IF EXISTS "Anon can read payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Anon can upload payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view coin proofs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload coin proofs" ON storage.objects;

-- Hanya admin yang boleh membaca file bukti pembayaran
CREATE POLICY "Admins can read proof buckets"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = ANY (ARRAY['payment-proofs'::text, 'coin-proofs'::text])
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- User terotentikasi boleh upload bukti, tetapi path harus diawali user_id mereka
CREATE POLICY "Users can upload own proof files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = ANY (ARRAY['payment-proofs'::text, 'coin-proofs'::text])
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Anon boleh upload bukti pembayaran (untuk guest order), path harus diawali 'guest/'
CREATE POLICY "Anon can upload guest proof files"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (
  bucket_id = 'payment-proofs'::text
  AND (storage.foldername(name))[1] = 'guest'
);

-- 2. Keluarkan tabel `shows` dari publikasi Realtime agar password tidak bocor
ALTER PUBLICATION supabase_realtime DROP TABLE public.shows;

-- 3. Tambahkan RLS policy pada realtime.messages agar user tidak bisa subscribe ke channel sembarangan
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can subscribe to public channels" ON realtime.messages;
CREATE POLICY "Authenticated can subscribe to public channels"
ON realtime.messages FOR SELECT
TO authenticated
USING (
  -- Channel publik yang aman: chat, polls, viewer counts, streams
  (extension = 'postgres_changes' AND topic IN (
    'realtime:public:chat_messages',
    'realtime:public:live_polls',
    'realtime:public:poll_votes',
    'realtime:public:streams',
    'realtime:public:landing_descriptions',
    'realtime:public:playlists',
    'realtime:public:site_settings'
  ))
  OR
  -- Channel admin hanya untuk admin
  (
    (topic LIKE 'realtime:public:admin_notifications%'
     OR topic LIKE 'realtime:public:user_bans%'
     OR topic LIKE 'realtime:public:subscription_orders%'
     OR topic LIKE 'realtime:public:tokens%'
     OR topic LIKE 'realtime:public:coin_transactions%'
     OR topic LIKE 'realtime:public:coin_balances%')
    AND has_role(auth.uid(), 'admin'::app_role)
  )
  OR
  -- Broadcast/presence channels umum
  extension IN ('broadcast', 'presence')
);

DROP POLICY IF EXISTS "Anon can subscribe to public broadcast channels" ON realtime.messages;
CREATE POLICY "Anon can subscribe to public broadcast channels"
ON realtime.messages FOR SELECT
TO anon
USING (
  (extension = 'postgres_changes' AND topic IN (
    'realtime:public:chat_messages',
    'realtime:public:live_polls',
    'realtime:public:poll_votes',
    'realtime:public:streams',
    'realtime:public:landing_descriptions',
    'realtime:public:site_settings'
  ))
  OR extension IN ('broadcast', 'presence')
);
