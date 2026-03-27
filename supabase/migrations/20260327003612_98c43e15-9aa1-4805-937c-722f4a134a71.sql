
-- Drop the public policy that exposes all columns
DROP POLICY IF EXISTS "Anyone can view order counts" ON public.subscription_orders;

-- Create a secure RPC function that only returns the count
CREATE OR REPLACE FUNCTION public.get_confirmed_order_count(_show_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(COUNT(*)::integer, 0)
  FROM public.subscription_orders
  WHERE show_id = _show_id AND status = 'confirmed';
$$;
