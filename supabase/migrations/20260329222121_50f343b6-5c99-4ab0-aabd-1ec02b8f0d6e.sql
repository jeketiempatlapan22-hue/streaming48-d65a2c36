ALTER TABLE public.subscription_orders
  ADD COLUMN IF NOT EXISTS qr_string TEXT,
  ADD COLUMN IF NOT EXISTS payment_gateway_order_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';