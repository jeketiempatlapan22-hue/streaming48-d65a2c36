-- Telegram bot state table
CREATE TABLE IF NOT EXISTS public.telegram_bot_state (
  id integer PRIMARY KEY,
  update_offset bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.telegram_bot_state (id, update_offset) VALUES (1, 0) ON CONFLICT DO NOTHING;

ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;

-- Telegram messages table
CREATE TABLE IF NOT EXISTS public.telegram_messages (
  update_id bigint PRIMARY KEY,
  chat_id bigint NOT NULL,
  text text,
  raw_update jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_chat_id ON public.telegram_messages (chat_id);

ALTER TABLE public.telegram_messages ENABLE ROW LEVEL SECURITY;

-- Add short_id and phone to coin_orders
ALTER TABLE public.coin_orders ADD COLUMN IF NOT EXISTS short_id text;
ALTER TABLE public.coin_orders ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.coin_orders ADD COLUMN IF NOT EXISTS price text;

-- Add short_id to subscription_orders  
ALTER TABLE public.subscription_orders ADD COLUMN IF NOT EXISTS short_id text;

-- Auto-generate short_id for coin_orders
CREATE OR REPLACE FUNCTION public.generate_coin_order_short_id()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.short_id := lower(substr(replace(NEW.id::text, '-', ''), 1, 6));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coin_order_short_id ON public.coin_orders;
CREATE TRIGGER trg_coin_order_short_id
  BEFORE INSERT ON public.coin_orders
  FOR EACH ROW WHEN (NEW.short_id IS NULL)
  EXECUTE FUNCTION public.generate_coin_order_short_id();

-- Auto-generate short_id for subscription_orders
CREATE OR REPLACE FUNCTION public.generate_sub_order_short_id()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.short_id := lower(substr(replace(NEW.id::text, '-', ''), 1, 6));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sub_order_short_id ON public.subscription_orders;
CREATE TRIGGER trg_sub_order_short_id
  BEFORE INSERT ON public.subscription_orders
  FOR EACH ROW WHEN (NEW.short_id IS NULL)
  EXECUTE FUNCTION public.generate_sub_order_short_id();

-- Storage bucket for payment proofs
INSERT INTO storage.buckets (id, name, public) VALUES ('payment-proofs', 'payment-proofs', true) ON CONFLICT DO NOTHING;

-- Enable realtime for telegram_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.telegram_messages;