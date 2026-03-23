-- Fix coin order status constraint to match app logic
ALTER TABLE public.coin_orders
DROP CONSTRAINT IF EXISTS coin_orders_status_check;

ALTER TABLE public.coin_orders
ADD CONSTRAINT coin_orders_status_check
CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'rejected'::text]));