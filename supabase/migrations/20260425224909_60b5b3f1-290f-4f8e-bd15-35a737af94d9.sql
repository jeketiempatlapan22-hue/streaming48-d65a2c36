
-- 1. Tabel cache state singleton
CREATE TABLE IF NOT EXISTS public.live_quiz_state (
  id int PRIMARY KEY DEFAULT 1,
  active_quiz_id uuid,
  ends_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_quiz_state_singleton CHECK (id = 1)
);

INSERT INTO public.live_quiz_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.live_quiz_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view quiz state" ON public.live_quiz_state;
CREATE POLICY "Anyone can view quiz state"
  ON public.live_quiz_state FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Block direct write quiz state" ON public.live_quiz_state;
CREATE POLICY "Block direct write quiz state"
  ON public.live_quiz_state FOR ALL
  TO anon, authenticated USING (false) WITH CHECK (false);

-- 2. Helper biasa untuk refresh cache
CREATE OR REPLACE FUNCTION public.refresh_live_quiz_state()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q RECORD;
BEGIN
  SELECT id, ends_at INTO q FROM public.live_quizzes
  WHERE status = 'active' AND ends_at > now()
  ORDER BY started_at DESC LIMIT 1;

  UPDATE public.live_quiz_state
    SET active_quiz_id = q.id,
        ends_at = q.ends_at,
        updated_at = now()
    WHERE id = 1;
END;
$$;

-- 3. Trigger wrapper
CREATE OR REPLACE FUNCTION public.trg_sync_live_quiz_state_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_live_quiz_state();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_live_quiz_state ON public.live_quizzes;
CREATE TRIGGER trg_sync_live_quiz_state
  AFTER INSERT OR UPDATE OR DELETE ON public.live_quizzes
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sync_live_quiz_state_fn();

-- Sync awal
SELECT public.refresh_live_quiz_state();

-- 4. Indeks tambahan
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_winners_quiz_rank ON public.quiz_winners(quiz_id, rank);

-- 5. Optimasi trigger submit_quiz_answer
CREATE OR REPLACE FUNCTION public.submit_quiz_answer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  st RECORD;
  q RECORD;
  norm_msg text;
  current_count int;
  new_rank int;
  is_match boolean := false;
  ans text;
  recent_attempts int;
  total_attempts int;
  msg_len int;
  COOLDOWN_WINDOW_SECONDS constant int := 4;
  COOLDOWN_MAX_ATTEMPTS  constant int := 6;
  HARD_MAX_ATTEMPTS      constant int := 20;
BEGIN
  IF NEW.is_admin OR NEW.user_id IS NULL OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;

  -- Cache lookup (1 row, very fast)
  SELECT active_quiz_id, ends_at INTO st FROM public.live_quiz_state WHERE id = 1;
  IF st.active_quiz_id IS NULL OR st.ends_at IS NULL OR st.ends_at <= now() THEN
    RETURN NEW;
  END IF;

  msg_len := length(coalesce(NEW.message, ''));
  IF msg_len = 0 OR msg_len > 60 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO q FROM public.live_quizzes
  WHERE id = st.active_quiz_id AND status = 'active';
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.quiz_winners WHERE quiz_id = q.id AND user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO current_count FROM public.quiz_winners WHERE quiz_id = q.id;
  IF current_count >= q.max_winners THEN
    UPDATE public.live_quizzes SET status = 'ended', ended_at = now()
      WHERE id = q.id AND status = 'active';
    RETURN NEW;
  END IF;

  norm_msg := public.normalize_answer(NEW.message);
  IF length(norm_msg) = 0 THEN RETURN NEW; END IF;

  FOREACH ans IN ARRAY q.answers LOOP
    IF length(public.normalize_answer(ans)) > 0
       AND norm_msg = public.normalize_answer(ans) THEN
      is_match := true;
      EXIT;
    END IF;
  END LOOP;

  IF is_match THEN
    SELECT count(*) INTO total_attempts FROM public.quiz_attempts
      WHERE quiz_id = q.id AND user_id = NEW.user_id;

    IF total_attempts >= HARD_MAX_ATTEMPTS THEN
      RETURN NEW;
    END IF;

    SELECT count(*) INTO recent_attempts FROM public.quiz_attempts
      WHERE quiz_id = q.id AND user_id = NEW.user_id
        AND attempted_at > now() - make_interval(secs => COOLDOWN_WINDOW_SECONDS);

    IF recent_attempts >= COOLDOWN_MAX_ATTEMPTS THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.quiz_attempts (quiz_id, user_id) VALUES (q.id, NEW.user_id);

    new_rank := current_count + 1;
    BEGIN
      INSERT INTO public.quiz_winners (quiz_id, user_id, username, message_id, rank, coins_awarded)
      VALUES (q.id, NEW.user_id, NEW.username, NEW.id, new_rank, q.coin_reward);
    EXCEPTION WHEN unique_violation THEN
      RETURN NEW;
    END;

    PERFORM public.award_quiz_coins(NEW.user_id, q.coin_reward, q.id);

    IF new_rank >= q.max_winners THEN
      UPDATE public.live_quizzes SET status = 'ended', ended_at = now()
        WHERE id = q.id AND status = 'active';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 6. RPC admin manual award
CREATE OR REPLACE FUNCTION public.admin_award_quiz_winner(
  _quiz_id uuid,
  _user_id uuid,
  _username text,
  _message_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q RECORD;
  current_count int;
  new_rank int;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT * INTO q FROM public.live_quizzes WHERE id = _quiz_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'quiz not found'); END IF;
  IF q.status NOT IN ('active','ended') THEN
    RETURN jsonb_build_object('error', 'quiz not awardable');
  END IF;

  IF EXISTS (SELECT 1 FROM public.quiz_winners WHERE quiz_id = q.id AND user_id = _user_id) THEN
    RETURN jsonb_build_object('error', 'user already winner');
  END IF;

  SELECT count(*) INTO current_count FROM public.quiz_winners WHERE quiz_id = q.id;
  IF current_count >= q.max_winners THEN
    RETURN jsonb_build_object('error', 'slots full');
  END IF;

  new_rank := current_count + 1;
  INSERT INTO public.quiz_winners (quiz_id, user_id, username, message_id, rank, coins_awarded)
  VALUES (q.id, _user_id, _username, _message_id, new_rank, q.coin_reward);

  PERFORM public.award_quiz_coins(_user_id, q.coin_reward, q.id);

  IF new_rank >= q.max_winners AND q.status = 'active' THEN
    UPDATE public.live_quizzes SET status = 'ended', ended_at = now()
      WHERE id = q.id AND status = 'active';
  END IF;

  RETURN jsonb_build_object('ok', true, 'rank', new_rank, 'coins', q.coin_reward);
END;
$$;
