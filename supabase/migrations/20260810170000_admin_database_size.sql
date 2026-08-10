-- Read-only measurement for the admin data-health panel.  This does not expose
-- any table data and is callable only by the backend service role.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_database_size_bytes()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT pg_database_size(current_database());
$$;

REVOKE ALL ON FUNCTION public.admin_database_size_bytes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_database_size_bytes() FROM anon;
REVOKE ALL ON FUNCTION public.admin_database_size_bytes() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_database_size_bytes() TO service_role;

COMMIT;
