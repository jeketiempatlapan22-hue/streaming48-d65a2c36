
-- Fix: Allow whatsapp_number (customer-facing) to be read publicly
-- Only block truly sensitive admin keys
DROP POLICY IF EXISTS "Public can view non-sensitive settings" ON public.site_settings;
CREATE POLICY "Public can view non-sensitive settings"
ON public.site_settings
FOR SELECT
TO anon, authenticated
USING (
  key NOT IN ('whatsapp_admin_numbers', 'fonnte_api_token', 'telegram_bot_token', 'admin_telegram_chat_id')
);
