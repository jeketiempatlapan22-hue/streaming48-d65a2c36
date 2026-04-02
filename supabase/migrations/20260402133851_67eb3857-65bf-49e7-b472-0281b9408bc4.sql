
-- Table for blocked IPs
CREATE TABLE public.blocked_ips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  reason text NOT NULL DEFAULT '',
  violation_count integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  auto_blocked boolean NOT NULL DEFAULT false,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  unblocked_at timestamptz,
  unblocked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ip_address)
);

-- Table for rate limit violation logs
CREATE TABLE public.rate_limit_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  endpoint text NOT NULL DEFAULT '',
  violation_key text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rlv_ip ON public.rate_limit_violations (ip_address);
CREATE INDEX idx_rlv_created ON public.rate_limit_violations (created_at);
CREATE INDEX idx_blocked_ips_active ON public.blocked_ips (is_active) WHERE is_active = true;

-- RLS for blocked_ips
ALTER TABLE public.blocked_ips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage blocked IPs" ON public.blocked_ips FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- RLS for rate_limit_violations
ALTER TABLE public.rate_limit_violations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view violations" ON public.rate_limit_violations FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role can insert violations" ON public.rate_limit_violations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Function to check and auto-block IPs
CREATE OR REPLACE FUNCTION public.record_rate_limit_violation(
  _ip text, _endpoint text, _violation_key text, _threshold integer DEFAULT 3, _window_minutes integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count integer;
  _already_blocked boolean;
BEGIN
  -- Check if already blocked
  SELECT EXISTS(SELECT 1 FROM public.blocked_ips WHERE ip_address = _ip AND is_active = true) INTO _already_blocked;
  IF _already_blocked THEN
    RETURN jsonb_build_object('blocked', true, 'auto_blocked', false);
  END IF;

  -- Record violation
  INSERT INTO public.rate_limit_violations (ip_address, endpoint, violation_key) VALUES (_ip, _endpoint, _violation_key);

  -- Count recent violations from this IP
  SELECT COUNT(*) INTO _count
  FROM public.rate_limit_violations
  WHERE ip_address = _ip AND created_at > now() - (_window_minutes || ' minutes')::interval;

  -- Auto-block if threshold exceeded
  IF _count >= _threshold THEN
    INSERT INTO public.blocked_ips (ip_address, reason, violation_count, auto_blocked)
    VALUES (_ip, 'Auto-blocked: ' || _count || ' rate limit violations in ' || _window_minutes || ' minutes', _count, true)
    ON CONFLICT (ip_address) DO UPDATE SET
      is_active = true, auto_blocked = true, violation_count = _count,
      reason = 'Auto-blocked: ' || _count || ' rate limit violations in ' || _window_minutes || ' minutes',
      blocked_at = now(), unblocked_at = null;
    RETURN jsonb_build_object('blocked', true, 'auto_blocked', true, 'violation_count', _count);
  END IF;

  RETURN jsonb_build_object('blocked', false, 'violation_count', _count);
END;
$$;

-- Function to check if IP is blocked
CREATE OR REPLACE FUNCTION public.is_ip_blocked(_ip text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.blocked_ips WHERE ip_address = _ip AND is_active = true);
$$;
