-- Fungsi reset diperbarui: lebih robust, gunakan TRUNCATE untuk chat
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
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  SELECT count(*)::int INTO v_chat_count FROM public.chat_messages;
  SELECT count(*)::int INTO v_quiz_count FROM public.live_quizzes;
  SELECT count(*)::int INTO v_winner_count FROM public.quiz_winners;
  SELECT count(*)::int INTO v_attempt_count FROM public.quiz_attempts;

  -- Hapus jawaban quiz dulu (referensi quiz_id ke live_quizzes)
  BEGIN
    DELETE FROM public.quiz_attempts;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.quiz_winners;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    DELETE FROM public.live_quizzes;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    UPDATE public.live_quiz_state
    SET active_quiz_id = NULL, ends_at = NULL, updated_at = now()
    WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- TRUNCATE chat lebih cepat & menghindari long-running delete
  BEGIN
    TRUNCATE TABLE public.chat_messages RESTART IDENTITY;
  EXCEPTION WHEN OTHERS THEN
    -- fallback ke DELETE bila TRUNCATE gagal (mis. lock)
    DELETE FROM public.chat_messages;
  END;

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

-- Fungsi pembersih harian (dipanggil cron). Tidak butuh admin check.
CREATE OR REPLACE FUNCTION public.cleanup_live_chat_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chat_count integer := 0;
BEGIN
  SELECT count(*)::int INTO v_chat_count FROM public.chat_messages;
  BEGIN
    TRUNCATE TABLE public.chat_messages RESTART IDENTITY;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM public.chat_messages;
  END;
  RETURN jsonb_build_object('chat_deleted', v_chat_count, 'cleared_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_live_chat_daily() FROM PUBLIC;

-- Pastikan extension pg_cron aktif
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Hapus job lama bila ada
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'cleanup-live-chat-daily-wib' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- Jadwalkan: tiap hari pukul 17:00 UTC = 00:00 WIB
SELECT cron.schedule(
  'cleanup-live-chat-daily-wib',
  '0 17 * * *',
  $cron$ SELECT public.cleanup_live_chat_daily(); $cron$
);