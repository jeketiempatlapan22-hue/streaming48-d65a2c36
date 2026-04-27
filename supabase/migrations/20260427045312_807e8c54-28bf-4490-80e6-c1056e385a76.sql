REVOKE EXECUTE ON FUNCTION public.reseller_create_token_by_id(uuid, uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reseller_create_token_by_id(uuid, uuid, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reseller_create_token_by_id(uuid, uuid, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reseller_create_token_by_id(uuid, uuid, integer, integer) TO service_role;