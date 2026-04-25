
-- 1. Tambah kolom AI tag ke chat_messages
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS ai_tag text,
  ADD COLUMN IF NOT EXISTS ai_tag_confidence numeric;

-- 2. Tabel live_quizzes
CREATE TABLE IF NOT EXISTS public.live_quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  source text NOT NULL DEFAULT 'manual', -- 'ai' | 'manual'
  theme text,
  difficulty text,
  question text NOT NULL,
  answers text[] NOT NULL DEFAULT '{}',
  max_winners int NOT NULL DEFAULT 1,
  coin_reward int NOT NULL DEFAULT 10,
  duration_seconds int NOT NULL DEFAULT 60,
  status text NOT NULL DEFAULT 'draft', -- 'draft' | 'active' | 'ended' | 'cancelled'
  started_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_live_quizzes_status ON public.live_quizzes(status);
CREATE INDEX IF NOT EXISTS idx_live_quizzes_created_at ON public.live_quizzes(created_at DESC);

ALTER TABLE public.live_quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage quizzes"
  ON public.live_quizzes FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view active or recent quizzes"
  ON public.live_quizzes FOR SELECT
  TO anon, authenticated
  USING (status IN ('active','ended'));

-- 3. Tabel quiz_winners
CREATE TABLE IF NOT EXISTS public.quiz_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.live_quizzes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  username text NOT NULL,
  message_id uuid,
  rank int NOT NULL,
  coins_awarded int NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(quiz_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_winners_quiz ON public.quiz_winners(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_winners_user ON public.quiz_winners(user_id);

ALTER TABLE public.quiz_winners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view all winners"
  ON public.quiz_winners FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users view own wins"
  ON public.quiz_winners FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Anyone can view winners of active/ended quizzes"
  ON public.quiz_winners FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.live_quizzes q
    WHERE q.id = quiz_winners.quiz_id AND q.status IN ('active','ended')
  ));

-- 4. Function helper: normalisasi text untuk match
CREATE OR REPLACE FUNCTION public.normalize_answer(t text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(coalesce(t,''), '[^a-z0-9\s]', '', 'gi'))
$$;

-- 5. Function: award koin ke pemenang quiz (atomik)
CREATE OR REPLACE FUNCTION public.award_quiz_coins(_user_id uuid, _amount int, _quiz_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _amount <= 0 THEN RETURN; END IF;

  -- Insert transaksi
  INSERT INTO public.coin_transactions (user_id, amount, type, description, reference_id)
  VALUES (_user_id, _amount, 'quiz_reward', 'Hadiah quiz live', _quiz_id::text);

  -- Update / insert balance
  INSERT INTO public.coin_balances (user_id, balance)
  VALUES (_user_id, _amount)
  ON CONFLICT (user_id)
  DO UPDATE SET balance = public.coin_balances.balance + _amount, updated_at = now();
END;
$$;

-- Pastikan coin_balances unique user_id (untuk ON CONFLICT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='coin_balances' AND indexname='coin_balances_user_id_key'
  ) THEN
    BEGIN
      ALTER TABLE public.coin_balances ADD CONSTRAINT coin_balances_user_id_key UNIQUE (user_id);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- 6. Trigger function: cek jawaban quiz tiap chat baru
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
BEGIN
  -- Skip pesan admin / mod / tanpa user_id
  IF NEW.is_admin OR NEW.user_id IS NULL OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;

  -- Cari quiz aktif (1 saja)
  SELECT * INTO q FROM public.live_quizzes
  WHERE status='active' AND ends_at > now() AND started_at <= NEW.created_at
  ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Cek apakah user sudah menang
  IF EXISTS (SELECT 1 FROM public.quiz_winners WHERE quiz_id=q.id AND user_id=NEW.user_id) THEN
    RETURN NEW;
  END IF;

  -- Cek slot tersisa
  SELECT count(*) INTO current_count FROM public.quiz_winners WHERE quiz_id=q.id;
  IF current_count >= q.max_winners THEN
    -- Tutup quiz otomatis jika penuh
    UPDATE public.live_quizzes SET status='ended', ended_at=now() WHERE id=q.id AND status='active';
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS trg_submit_quiz_answer ON public.chat_messages;
CREATE TRIGGER trg_submit_quiz_answer
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.submit_quiz_answer();

-- 7. Function: end expired quizzes (dipanggil oleh client/admin atau cron)
CREATE OR REPLACE FUNCTION public.end_expired_quizzes()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  UPDATE public.live_quizzes
  SET status='ended', ended_at=now()
  WHERE status='active' AND ends_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- 8. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_quizzes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quiz_winners;
