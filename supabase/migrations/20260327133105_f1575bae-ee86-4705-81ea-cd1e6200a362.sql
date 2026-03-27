
-- Create sequences for simple short IDs
CREATE SEQUENCE IF NOT EXISTS sub_order_seq START 1;
CREATE SEQUENCE IF NOT EXISTS coin_order_seq START 1;

-- Set sequences to continue from existing count
SELECT setval('sub_order_seq', COALESCE((SELECT COUNT(*) FROM subscription_orders), 0) + 1, false);
SELECT setval('coin_order_seq', COALESCE((SELECT COUNT(*) FROM coin_orders), 0) + 1, false);

-- Update trigger for subscription_orders: generates a1, a2, a3...
CREATE OR REPLACE FUNCTION public.generate_sub_order_short_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.short_id := 'a' || nextval('sub_order_seq');
  RETURN NEW;
END;
$$;

-- Update trigger for coin_orders: generates k1, k2, k3...
CREATE OR REPLACE FUNCTION public.generate_coin_order_short_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.short_id := 'k' || nextval('coin_order_seq');
  RETURN NEW;
END;
$$;

-- Update existing subscription_orders short_ids
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
  FROM subscription_orders
)
UPDATE subscription_orders SET short_id = 'a' || numbered.rn
FROM numbered WHERE subscription_orders.id = numbered.id;

-- Update existing coin_orders short_ids
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
  FROM coin_orders
)
UPDATE coin_orders SET short_id = 'k' || numbered.rn
FROM numbered WHERE coin_orders.id = numbered.id;
