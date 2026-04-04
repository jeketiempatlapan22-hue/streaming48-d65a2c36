
-- Table for member photo registry (name -> photo URL mapping)
CREATE TABLE public.member_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage member photos" ON public.member_photos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can view member photos" ON public.member_photos
  FOR SELECT TO public
  USING (true);

-- Storage bucket for member photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('member-photos', 'member-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Admins can upload member photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'member-photos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete member photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'member-photos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Public can view member photos" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'member-photos');
