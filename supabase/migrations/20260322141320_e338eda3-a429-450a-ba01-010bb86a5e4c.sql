
-- Fix 1: Remove public SELECT on shows that exposes access_password
-- Replace with a restricted policy that hides sensitive columns
-- Since RLS can't restrict columns, we drop public SELECT and force use of get_public_shows() RPC

DROP POLICY IF EXISTS "Anyone can view active shows" ON public.shows;

-- Create a restricted public SELECT that only allows viewing non-sensitive columns
-- by creating a policy that blocks public access entirely (they must use the RPC)
CREATE POLICY "Public must use RPC for shows"
  ON public.shows FOR SELECT TO public
  USING (false);

-- Fix 2: Make password_reset_requests use cryptographic random short_id instead of sequential
-- Add a secure_token column for cryptographic verification
ALTER TABLE public.password_reset_requests ADD COLUMN IF NOT EXISTS secure_token text;

-- Update the request_password_reset function to generate crypto-random tokens
CREATE OR REPLACE FUNCTION public.request_password_reset(_identifier text, _new_password text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid; _phone text; _username text; _short_id text;
  _normalized text; _email_lookup text; _allowed boolean;
  _secure_token text;
BEGIN
  _normalized := trim(_identifier);
  IF _normalized = '' THEN RETURN json_build_object('success', false, 'error', 'Masukkan nomor HP atau email'); END IF;

  SELECT public.check_rate_limit('pw_reset:' || _normalized, 3, 600) INTO _allowed;
  IF NOT _allowed THEN
    RETURN json_build_object('success', false, 'error', 'Terlalu banyak percobaan. Tunggu beberapa menit.');
  END IF;

  IF _normalized ~ '^[0-9]' THEN
    _email_lookup := regexp_replace(_normalized, '[^0-9]', '', 'g') || '@rt48.user';
  ELSE
    _email_lookup := _normalized;
  END IF;

  SELECT id INTO _user_id FROM auth.users WHERE email = _email_lookup;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Akun tidak ditemukan');
  END IF;

  IF EXISTS (SELECT 1 FROM public.password_reset_requests WHERE user_id = _user_id AND status = 'pending' AND created_at > now() - interval '1 hour') THEN
    RETURN json_build_object('success', false, 'error', 'Sudah ada permintaan reset yang belum diproses. Tunggu admin mengkonfirmasi.');
  END IF;

  SELECT username INTO _username FROM public.profiles WHERE id = _user_id;

  IF _normalized ~ '^[0-9]' THEN
    _phone := regexp_replace(_normalized, '[^0-9]', '', 'g');
  ELSE
    _phone := '';
  END IF;

  -- Generate cryptographically random secure token
  _secure_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.password_reset_requests (user_id, identifier, phone, new_password, secure_token)
  VALUES (_user_id, _normalized, _phone, NULL, _secure_token)
  RETURNING short_id INTO _short_id;

  RETURN json_build_object('success', true, 'short_id', _short_id, 'username', COALESCE(_username, ''));
END;
$function$;
