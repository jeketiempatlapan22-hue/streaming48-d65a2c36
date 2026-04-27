-- 1. Add expires_at columns
ALTER TABLE public.subscription_orders 
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE public.coin_orders 
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 2. Indexes for fast cleanup
CREATE INDEX IF NOT EXISTS idx_sub_orders_expires_pending
  ON public.subscription_orders(expires_at)
  WHERE payment_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_coin_orders_expires_pending
  ON public.coin_orders(expires_at)
  WHERE status = 'pending';

-- 3. Cleanup function: delete expired pending dynamic-QRIS orders
CREATE OR REPLACE FUNCTION public.cleanup_expired_qris_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sub INT := 0;
  _coin INT := 0;
BEGIN
  WITH d AS (
    DELETE FROM public.subscription_orders
    WHERE payment_status = 'pending'
      AND COALESCE(payment_method, '') = 'qris_dynamic'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO _sub FROM d;

  WITH d AS (
    DELETE FROM public.coin_orders
    WHERE status = 'pending'
      AND expires_at IS NOT NULL
      AND expires_at < now()
      -- Only delete coin orders without payment proof (i.e. dynamic QRIS, not static upload)
      AND payment_proof_url IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO _coin FROM d;

  RETURN jsonb_build_object(
    'subscription_deleted', _sub,
    'coin_deleted', _coin,
    'ran_at', now()
  );
END;
$$;

-- 4. Cancel a pending dynamic-QRIS order on user close
CREATE OR REPLACE FUNCTION public.cancel_pending_qris_order(
  _order_id uuid,
  _order_kind text DEFAULT 'subscription'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted INT := 0;
BEGIN
  IF _order_kind = 'coin' THEN
    DELETE FROM public.coin_orders
    WHERE id = _order_id
      AND status = 'pending'
      AND payment_proof_url IS NULL;
    GET DIAGNOSTICS _deleted = ROW_COUNT;
  ELSE
    DELETE FROM public.subscription_orders
    WHERE id = _order_id
      AND payment_status = 'pending'
      AND COALESCE(payment_method, '') = 'qris_dynamic';
    GET DIAGNOSTICS _deleted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('deleted', _deleted);
END;
$$;

-- 5. Schedule cleanup every minute (idempotent: unschedule first if exists)
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-expired-qris-orders');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cleanup-expired-qris-orders',
  '* * * * *',
  $$ SELECT public.cleanup_expired_qris_orders(); $$
);