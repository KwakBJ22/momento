-- Rollback for 20260712170000_auth_family_ownership.sql.
-- Do not run after new Auth users or default families have been created: it
-- removes automatic provisioning only and intentionally preserves all data.

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'Momento 사용자'
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.ensure_default_family(uuid);

COMMIT;
