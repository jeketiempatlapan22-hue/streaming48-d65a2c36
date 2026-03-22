
-- Enable realtime for shows
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.shows;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enable realtime for streams
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.streams;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
