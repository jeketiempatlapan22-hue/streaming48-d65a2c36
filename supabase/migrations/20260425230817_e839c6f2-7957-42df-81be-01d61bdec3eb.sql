-- Ensure no duplicate rank within a quiz
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_winners_quiz_rank
  ON public.quiz_winners (quiz_id, rank);

-- Re-create submit_quiz_answer with race-safe ranking using advisory lock
CREATE OR REPLACE FUNCTION public.submit_quiz_answer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  st RECORD;
  q RECORD;
  norm_msg text;
  norm_answers text[];
  current_count int;
  new_rank int;
  is_match boolean := false;
  recent_attempts int;
  total_attempts int;
  msg_len int;
  lock_key bigint;
  COOLDOWN_WINDOW_SECONDS constant int := 4;
  COOLDOWN_MAX_ATTEMPTS  constant int := 6;
  HARD_MAX_ATTEMPTS      constant int := 20;
BEGIN
  IF NEW.is_admin OR NEW.user_id IS NULL OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;

  msg_len := length(coalesce(NEW.message, ''));
  IF msg_len = 0 OR msg_len > 60 THEN
    RETURN NEW;
  END IF;

  SELECT active_quiz_id, ends_at INTO st FROM public.live_quiz_state WHERE id = 1;
  IF st.active_quiz_id IS NULL OR st.ends_at IS NULL OR st.ends_at <= now() THEN
    RETURN NEW;
  END IF;

  SELECT id, answers, max_winners, coin_reward, status
    INTO q
    FROM public.live_quizzes
    WHERE id = st.active_quiz_id AND status = 'active';
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.quiz_winners WHERE quiz_id = q.id AND user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  norm_msg := public.normalize_answer(NEW.message);
  IF length(norm_msg) = 0 THEN RETURN NEW; END IF;

  SELECT array_agg(n) FILTER (WHERE n <> '')
    INTO norm_answers
    FROM (SELECT public.normalize_answer(a) AS n FROM unnest(q.answers) AS a) s;

  is_match := norm_answers IS NOT NULL AND norm_msg = ANY(norm_answers);

  IF NOT is_match THEN
    RETURN NEW;
  END IF;

  -- Rate-limit check (cheap, single scan)
  SELECT
    count(*),
    count(*) FILTER (WHERE attempted_at > now() - make_interval(secs => COOLDOWN_WINDOW_SECONDS))
    INTO total_attempts, recent_attempts
  FROM public.quiz_attempts
  WHERE quiz_id = q.id AND user_id = NEW.user_id;

  IF total_attempts >= HARD_MAX_ATTEMPTS OR recent_attempts >= COOLDOWN_MAX_ATTEMPTS THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.quiz_attempts (quiz_id, user_id) VALUES (q.id, NEW.user_id);

  -- Serialize concurrent winners on the SAME quiz to assign distinct ranks atomically.
  -- Uses transaction-scoped advisory lock keyed by quiz UUID hash; only correct matches reach here, so contention is minimal.
  lock_key := ('x' || substr(md5(q.id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(lock_key);

  -- Re-check inside the lock (fresh count + winners cap + duplicate-user guard)
  SELECT count(*) INTO current_count FROM public.quiz_winners WHERE quiz_id = q.id;
  IF current_count >= q.max_winners THEN
    UPDATE public.live_quizzes SET status = 'ended', ended_at = now()
      WHERE id = q.id AND status = 'active';
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.quiz_winners WHERE quiz_id = q.id AND user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

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

  RETURN NEW;
END;
$function$;