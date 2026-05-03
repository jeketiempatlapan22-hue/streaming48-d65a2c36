DROP POLICY IF EXISTS "Public can view non-sensitive settings" ON public.site_settings;

CREATE POLICY "Public can view non-sensitive settings"
  ON public.site_settings
  FOR SELECT
  TO anon, authenticated
  USING (
    key <> ALL (ARRAY[
      'whatsapp_admin_numbers',
      'whatsapp_number',
      'fonnte_api_token',
      'telegram_bot_token',
      'admin_telegram_chat_id'
    ])
  );