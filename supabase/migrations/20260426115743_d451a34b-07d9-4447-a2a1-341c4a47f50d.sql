-- Tabel feedback (Kritik & Saran) global
CREATE TABLE public.feedback_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'saran',
  page_url TEXT NOT NULL DEFAULT '',
  user_id UUID,
  username TEXT,
  user_agent TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index untuk performa filter
CREATE INDEX idx_feedback_created_at ON public.feedback_messages (created_at DESC);
CREATE INDEX idx_feedback_unread ON public.feedback_messages (is_read, is_archived);
CREATE INDEX idx_feedback_user_id ON public.feedback_messages (user_id);

-- Enable RLS
ALTER TABLE public.feedback_messages ENABLE ROW LEVEL SECURITY;

-- Trigger validasi konten + rate limit (maks 5 per jam per user_id atau ip approximated via username/user_agent fallback)
CREATE OR REPLACE FUNCTION public.validate_feedback_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  -- Trim & validasi panjang pesan
  NEW.message := btrim(NEW.message);
  IF length(NEW.message) < 5 OR length(NEW.message) > 1000 THEN
    RAISE EXCEPTION 'Pesan harus 5-1000 karakter';
  END IF;

  -- Validasi kategori
  IF NEW.category NOT IN ('saran', 'kritik', 'bug', 'lainnya') THEN
    NEW.category := 'saran';
  END IF;

  -- Validasi panjang lain
  IF NEW.username IS NOT NULL AND length(NEW.username) > 50 THEN
    NEW.username := substring(NEW.username FROM 1 FOR 50);
  END IF;
  IF NEW.page_url IS NOT NULL AND length(NEW.page_url) > 500 THEN
    NEW.page_url := substring(NEW.page_url FROM 1 FOR 500);
  END IF;
  IF NEW.user_agent IS NOT NULL AND length(NEW.user_agent) > 500 THEN
    NEW.user_agent := substring(NEW.user_agent FROM 1 FOR 500);
  END IF;

  -- Force defaults pada insert dari klien
  NEW.is_read := false;
  NEW.is_archived := false;

  -- Rate limit: 5 per jam per user_id (kalau login) atau per user_agent (kalau anon)
  IF NEW.user_id IS NOT NULL THEN
    SELECT COUNT(*) INTO recent_count
    FROM public.feedback_messages
    WHERE user_id = NEW.user_id
      AND created_at > now() - interval '1 hour';
  ELSE
    SELECT COUNT(*) INTO recent_count
    FROM public.feedback_messages
    WHERE user_id IS NULL
      AND user_agent = NEW.user_agent
      AND created_at > now() - interval '1 hour';
  END IF;

  IF recent_count >= 5 THEN
    RAISE EXCEPTION 'Terlalu banyak pengiriman. Coba lagi dalam 1 jam.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_feedback_insert
BEFORE INSERT ON public.feedback_messages
FOR EACH ROW
EXECUTE FUNCTION public.validate_feedback_insert();

-- RLS Policies
-- Anon dapat insert (tanpa user_id)
CREATE POLICY "Anon can submit feedback"
ON public.feedback_messages
FOR INSERT
TO anon
WITH CHECK (user_id IS NULL);

-- Authenticated dapat insert (dengan user_id sendiri)
CREATE POLICY "Authenticated can submit feedback"
ON public.feedback_messages
FOR INSERT
TO authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- Admin dapat baca semua
CREATE POLICY "Admins can view feedback"
ON public.feedback_messages
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Anon & non-admin tidak boleh baca
CREATE POLICY "Block anon read feedback"
ON public.feedback_messages
FOR SELECT
TO anon
USING (false);

-- Admin dapat update (mark read / archive)
CREATE POLICY "Admins can update feedback"
ON public.feedback_messages
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Admin dapat delete
CREATE POLICY "Admins can delete feedback"
ON public.feedback_messages
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Aktifkan realtime untuk admin notifikasi
ALTER PUBLICATION supabase_realtime ADD TABLE public.feedback_messages;