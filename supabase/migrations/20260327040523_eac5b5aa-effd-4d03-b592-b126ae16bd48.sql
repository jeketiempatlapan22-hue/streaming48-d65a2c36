
-- FIX #1: Remove public INSERT on password_reset_requests
DROP POLICY IF EXISTS "Anyone can create reset request" ON public.password_reset_requests;

-- FIX #2: Block sensitive keys from public read
DROP POLICY IF EXISTS "Public can view non-sensitive settings" ON public.site_settings;
CREATE POLICY "Public can view non-sensitive settings"
ON public.site_settings
FOR SELECT
TO anon, authenticated
USING (
  key NOT IN ('whatsapp_admin_numbers', 'whatsapp_number', 'fonnte_api_token', 'telegram_bot_token', 'admin_telegram_chat_id')
);
