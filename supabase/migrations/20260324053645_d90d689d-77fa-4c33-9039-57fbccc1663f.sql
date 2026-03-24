
DROP POLICY "Anyone can insert auth metrics" ON public.auth_metrics;

CREATE POLICY "Validated insert auth metrics"
ON public.auth_metrics
FOR INSERT
TO anon, authenticated
WITH CHECK (
  event_type IS NOT NULL
  AND length(event_type) <= 50
  AND (error_message IS NULL OR length(error_message) <= 500)
  AND (source IS NULL OR source IN ('viewer', 'admin', 'system'))
  AND (duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 300000))
);
