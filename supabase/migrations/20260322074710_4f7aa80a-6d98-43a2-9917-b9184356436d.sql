-- Add missing columns to chat_messages for live chat features
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS token_id text;

-- Add description column to streams
ALTER TABLE public.streams ADD COLUMN IF NOT EXISTS description text;