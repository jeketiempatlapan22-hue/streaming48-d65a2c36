
-- Explicit deny policies for sensitive admin-only tables
-- This prevents any accidental exposure if policies change

-- password_reset_requests: block non-admin reads
CREATE POLICY "Non-admins cannot read reset requests"
ON public.password_reset_requests
FOR SELECT
TO anon
USING (false);

CREATE POLICY "Authenticated non-admins cannot read reset requests"
ON public.password_reset_requests
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- admin_notifications: block non-admin reads
CREATE POLICY "Non-admins cannot read admin notifications"
ON public.admin_notifications
FOR SELECT
TO anon
USING (false);

CREATE POLICY "Auth non-admins cannot read admin notifications"
ON public.admin_notifications
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- token_sessions: block non-admin reads
CREATE POLICY "Non-admins cannot read token sessions"
ON public.token_sessions
FOR SELECT
TO anon
USING (false);

CREATE POLICY "Auth non-admins cannot read token sessions"
ON public.token_sessions
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
