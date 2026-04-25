CREATE OR REPLACE FUNCTION public.get_quiz_attempt_status(_quiz_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_total int := 0;
  v_recent int := 0;
  v_oldest_recent timestamptz;
  v_already_won boolean := false;
  v_quiz RECORD;
  v_winner_count int := 0;
  v_quiz_open boolean := false;
  v_reset_at timestamptz;
  COOLDOWN_WINDOW_SECONDS constant int := 4;
  COOLDOWN_MAX_ATTEMPTS  constant int := 6;
  HARD_MAX_ATTEMPTS      constant int := 20;
BEGIN
  IF v_uid IS NULL OR _quiz_id IS NULL THEN
    RETURN jsonb_build_object('can_submit', false, 'reason', 'unauthenticated');
  END IF;

  SELECT id, status, max_winners, ends_at INTO v_quiz
  FROM public.live_quizzes WHERE id = _quiz_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_submit', false, 'reason', 'quiz_not_found');
  END IF;

  v_quiz_open := v_quiz.status = 'active'
    AND v_quiz.ends_at IS NOT NULL
    AND v_quiz.ends_at > now();

  SELECT count(*) INTO v_winner_count FROM public.quiz_winners WHERE quiz_id = v_quiz.id;

  IF NOT v_quiz_open THEN
    RETURN jsonb_build_object(
      'can_submit', false, 'reason', 'quiz_ended',
      'winner_count', v_winner_count, 'max_winners', v_quiz.max_winners
    );
  END IF;

  IF v_winner_count >= v_quiz.max_winners THEN
    RETURN jsonb_build_object(
      'can_submit', false, 'reason', 'winners_full',
      'winner_count', v_winner_count, 'max_winners', v_quiz.max_winners
    );
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.quiz_winners WHERE quiz_id = v_quiz.id AND user_id = v_uid)
    INTO v_already_won;
  IF v_already_won THEN
    RETURN jsonb_build_object('can_submit', false, 'reason', 'already_won');
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE attempted_at > now() - make_interval(secs => COOLDOWN_WINDOW_SECONDS)),
    min(attempted_at) FILTER (WHERE attempted_at > now() - make_interval(secs => COOLDOWN_WINDOW_SECONDS))
    INTO v_total, v_recent, v_oldest_recent
  FROM public.quiz_attempts
  WHERE quiz_id = v_quiz.id AND user_id = v_uid;

  IF v_total >= HARD_MAX_ATTEMPTS THEN
    RETURN jsonb_build_object(
      'can_submit', false, 'reason', 'hard_limit',
      'total_attempts', v_total, 'hard_limit', HARD_MAX_ATTEMPTS
    );
  END IF;

  IF v_recent >= COOLDOWN_MAX_ATTEMPTS THEN
    v_reset_at := COALESCE(v_oldest_recent, now()) + make_interval(secs => COOLDOWN_WINDOW_SECONDS);
    RETURN jsonb_build_object(
      'can_submit', false, 'reason', 'cooldown',
      'recent_attempts', v_recent, 'cooldown_max', COOLDOWN_MAX_ATTEMPTS,
      'reset_at', v_reset_at,
      'reset_in_ms', GREATEST(0, EXTRACT(EPOCH FROM (v_reset_at - now()))::int * 1000)
    );
  END IF;

  RETURN jsonb_build_object(
    'can_submit', true,
    'total_attempts', v_total, 'hard_limit', HARD_MAX_ATTEMPTS,
    'recent_attempts', v_recent, 'cooldown_max', COOLDOWN_MAX_ATTEMPTS,
    'remaining_total', HARD_MAX_ATTEMPTS - v_total,
    'remaining_window', COOLDOWN_MAX_ATTEMPTS - v_recent
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_quiz_attempt_status(uuid) TO authenticated, anon;