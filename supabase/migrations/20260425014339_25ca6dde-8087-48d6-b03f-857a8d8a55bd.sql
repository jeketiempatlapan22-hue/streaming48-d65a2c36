ALTER TABLE public.admin_notifications
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_admin_notifications_expires_at
  ON public.admin_notifications (expires_at)
  WHERE expires_at IS NOT NULL;