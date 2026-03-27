
-- Create triggers for auto-generating short_id on subscription_orders
DROP TRIGGER IF EXISTS trg_sub_order_short_id ON public.subscription_orders;
CREATE TRIGGER trg_sub_order_short_id
  BEFORE INSERT ON public.subscription_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_sub_order_short_id();

-- Create triggers for auto-generating short_id on coin_orders
DROP TRIGGER IF EXISTS trg_coin_order_short_id ON public.coin_orders;
CREATE TRIGGER trg_coin_order_short_id
  BEFORE INSERT ON public.coin_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_coin_order_short_id();

-- Create trigger for logging coin order transactions
DROP TRIGGER IF EXISTS trg_log_coin_order_transaction ON public.coin_orders;
CREATE TRIGGER trg_log_coin_order_transaction
  AFTER UPDATE ON public.coin_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.log_coin_order_transaction();

-- Backfill any existing subscription_orders without short_id
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
  FROM public.subscription_orders
  WHERE short_id IS NULL OR short_id = ''
)
UPDATE public.subscription_orders SET short_id = 'a' || numbered.rn
FROM numbered WHERE subscription_orders.id = numbered.id;

-- Backfill any existing coin_orders without short_id
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
  FROM public.coin_orders
  WHERE short_id IS NULL OR short_id = ''
)
UPDATE public.coin_orders SET short_id = 'k' || numbered.rn
FROM numbered WHERE coin_orders.id = numbered.id;
