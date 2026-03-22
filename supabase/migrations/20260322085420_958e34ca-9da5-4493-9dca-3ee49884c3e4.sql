
-- Admin notifications table
CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'general',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage notifications"
  ON public.admin_notifications FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;

-- Moderators table (accounts with login credentials)
CREATE TABLE public.moderators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  username text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.moderators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage moderators"
  ON public.moderators FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
