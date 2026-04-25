-- Drop redundant duplicates (kept the more descriptive names)
DROP INDEX IF EXISTS public.idx_quiz_attempts_lookup;        -- duplicate of idx_quiz_attempts_quiz_user_time
DROP INDEX IF EXISTS public.idx_quiz_winners_quiz_rank;      -- duplicate of unique uq_quiz_winners_quiz_rank
DROP INDEX IF EXISTS public.idx_quiz_winners_quiz;           -- prefix already covered by (quiz_id, user_id) unique

-- Covering index so count(*) per quiz is index-only
CREATE INDEX IF NOT EXISTS idx_quiz_winners_quiz_rank_covering
  ON public.quiz_winners (quiz_id) INCLUDE (rank);

ANALYZE public.quiz_winners;
ANALYZE public.quiz_attempts;