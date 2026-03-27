
-- Enable pgcrypto extension first
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Recreate hash function using extensions.digest
CREATE OR REPLACE FUNCTION public.hash_token(_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT encode(extensions.digest(_token::bytea, 'sha256'), 'hex');
$$;
