
-- Fix Realtime: remove sensitive tables from publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.security_events;
ALTER PUBLICATION supabase_realtime DROP TABLE public.admin_notifications;
ALTER PUBLICATION supabase_realtime DROP TABLE public.suspicious_activity_log;
ALTER PUBLICATION supabase_realtime DROP TABLE public.coin_transactions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.telegram_messages;
ALTER PUBLICATION supabase_realtime DROP TABLE public.tokens;
