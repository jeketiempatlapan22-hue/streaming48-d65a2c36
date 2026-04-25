-- 1. Tabel log percobaan jawaban quiz (untuk rate limiting)
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.live_quizzes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_lookup
  ON public.quiz_attempts(quiz_id, user_id, attempted_at DESC);

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

-- Hanya admin yang bisa melihat; trigger SECURITY DEFINER yang menulis
DROP POLICY IF EXISTS "Admins view quiz attempts" ON public.quiz_attempts;
CREATE POLICY "Admins view quiz attempts"
  ON public.quiz_attempts FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Block direct write quiz attempts" ON public.quiz_attempts;
CREATE POLICY "Block direct write quiz attempts"
  ON public.quiz_attempts FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- 2. Update trigger jawaban quiz dengan rate-limit + cooldown
CREATE OR REPLACE FUNCTION public.submit_quiz_answer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q RECORD;
  norm_msg text;
  current_count int;
  new_rank int;
  is_match boolean := false;
  ans text;
  recent_attempts int;
  total_attempts int;
  COOLDOWN_WINDOW_SECONDS constant int := 5;
  COOLDOWN_MAX_ATTEMPTS  constant int := 3;
  HARD_MAX_ATTEMPTS      constant int := 10;
BEGIN
  -- Skip pesan admin / mod / tanpa user_id
  IF NEW.is_admin OR NEW.user_id IS NULL OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;

  -- Cari quiz aktif
  SELECT * INTO q FROM public.live_quizzes
  WHERE status='active' AND ends_at > now() AND started_at <= NEW.created_at
  ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Skip jika user sudah menang
  IF EXISTS (SELECT 1 FROM public.quiz_winners WHERE quiz_id=q.id AND user_id=NEW.user_id) THEN
    RETURN NEW;
  END IF;

  -- Cek slot tersisa
  SELECT count(*) INTO current_count FROM public.quiz_winners WHERE quiz_id=q.id;
  IF current_count >= q.max_winners THEN
    UPDATE public.live_quizzes SET status='ended', ended_at=now() WHERE id=q.id AND status='active';
    RETURN NEW;
  END IF;

  -- ===== RATE LIMIT =====
  -- Hitung percobaan total user pada quiz ini
  SELECT count(*) INTO total_attempts
  FROM public.quiz_attempts
  WHERE quiz_id = q.id AND user_id = NEW.user_id;

  IF total_attempts >= HARD_MAX_ATTEMPTS THEN
    -- Sudah melebihi batas total; jangan diproses & jangan dicatat lagi
    RETURN NEW;
  END IF;

  -- Hitung percobaan dalam window cooldown
  SELECT count(*) INTO recent_attempts
  FROM public.quiz_attempts
  WHERE quiz_id = q.id
    AND user_id = NEW.user_id
    AND attempted_at > now() - make_interval(secs => COOLDOWN_WINDOW_SECONDS);

  IF recent_attempts >= COOLDOWN_MAX_ATTEMPTS THEN
    -- Cooldown: terlalu banyak dalam waktu singkat; abaikan
    RETURN NEW;
  END IF;

  -- Catat percobaan (sebelum match, supaya jawaban salah pun terhitung)
  INSERT INTO public.quiz_attempts (quiz_id, user_id) VALUES (q.id, NEW.user_id);
  -- ===== END RATE LIMIT =====

  -- Match jawaban
  norm_msg := public.normalize_answer(NEW.message);
  FOREACH ans IN ARRAY q.answers LOOP
    IF length(public.normalize_answer(ans)) > 0
       AND norm_msg = public.normalize_answer(ans) THEN
      is_match := true;
      EXIT;
    END IF;
  END LOOP;

  IF NOT is_match THEN RETURN NEW; END IF;

  -- Insert pemenang (race-safe via UNIQUE)
  new_rank := current_count + 1;
  BEGIN
    INSERT INTO public.quiz_winners (quiz_id, user_id, username, message_id, rank, coins_awarded)
    VALUES (q.id, NEW.user_id, NEW.username, NEW.id, new_rank, q.coin_reward);
  EXCEPTION WHEN unique_violation THEN
    RETURN NEW;
  END;

  -- Award koin
  PERFORM public.award_quiz_coins(NEW.user_id, q.coin_reward, q.id);

  -- Tutup jika penuh
  IF new_rank >= q.max_winners THEN
    UPDATE public.live_quizzes SET status='ended', ended_at=now() WHERE id=q.id AND status='active';
  END IF;

  RETURN NEW;
END;
$$;