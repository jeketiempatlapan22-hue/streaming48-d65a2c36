-- RPC untuk reset live chat sekaligus riwayat quiz secara aman (admin only)
CREATE OR REPLACE FUNCTION public.admin_reset_live_chat_and_quiz()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chat_count integer := 0;
  v_quiz_count integer := 0;
  v_winner_count integer := 0;
  v_attempt_count integer := 0;
BEGIN
  -- Pastikan caller adalah admin
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  -- Hapus jawaban quiz
  DELETE FROM public.quiz_attempts;
  GET DIAGNOSTICS v_attempt_count = ROW_COUNT;

  -- Hapus pemenang
  DELETE FROM public.quiz_winners;
  GET DIAGNOSTICS v_winner_count = ROW_COUNT;

  -- Hapus seluruh history quiz (active, ended, draft, cancelled)
  DELETE FROM public.live_quizzes;
  GET DIAGNOSTICS v_quiz_count = ROW_COUNT;

  -- Reset state quiz aktif
  UPDATE public.live_quiz_state
  SET active_quiz_id = NULL, ends_at = NULL, updated_at = now()
  WHERE id = 1;

  -- Hapus seluruh chat messages
  DELETE FROM public.chat_messages;
  GET DIAGNOSTICS v_chat_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'chat_deleted', v_chat_count,
    'quiz_deleted', v_quiz_count,
    'winners_deleted', v_winner_count,
    'attempts_deleted', v_attempt_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_live_chat_and_quiz() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_live_chat_and_quiz() TO authenticated;