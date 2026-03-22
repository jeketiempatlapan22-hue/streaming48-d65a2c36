-- Create security_events table
CREATE TABLE public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  description text NOT NULL,
  ip_address text,
  severity text NOT NULL DEFAULT 'low',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage security events" ON public.security_events FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Create chat_moderators table
CREATE TABLE public.chat_moderators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_moderators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage chat moderators" ON public.chat_moderators FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone can view moderators" ON public.chat_moderators FOR SELECT TO public USING (true);

-- Create landing_descriptions table
CREATE TABLE public.landing_descriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '✨',
  image_url text DEFAULT '',
  text_align text DEFAULT 'left',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.landing_descriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active descriptions" ON public.landing_descriptions FOR SELECT TO public USING (is_active = true);
CREATE POLICY "Admins can manage descriptions" ON public.landing_descriptions FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Enable realtime for security_events
ALTER PUBLICATION supabase_realtime ADD TABLE public.security_events;