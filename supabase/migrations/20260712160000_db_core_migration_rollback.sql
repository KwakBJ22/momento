-- Rollback for 20260712160000_db_core_migration.sql
--
-- Use only before family-domain data is relied on. This preserves every legacy
-- public.albums row and all Storage objects, but drops phase-1 family/profile
-- data and therefore must be reviewed in a maintenance window.

BEGIN;

DROP POLICY IF EXISTS family_members_update_owner_or_manager ON public.family_members;
DROP POLICY IF EXISTS family_members_insert_owner_or_manager ON public.family_members;
DROP POLICY IF EXISTS family_members_select_member ON public.family_members;
DROP POLICY IF EXISTS families_update_owner ON public.families;
DROP POLICY IF EXISTS families_insert_creator ON public.families;
DROP POLICY IF EXISTS families_select_member ON public.families;
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
DROP POLICY IF EXISTS profiles_select_self_or_family ON public.profiles;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_auth_user_profile();
DROP FUNCTION IF EXISTS public.shares_active_family_with(uuid);
DROP FUNCTION IF EXISTS public.is_active_family_manager(uuid);
DROP FUNCTION IF EXISTS public.is_active_family_member(uuid);

DROP TRIGGER IF EXISTS albums_set_updated_at ON public.albums;
DROP TRIGGER IF EXISTS family_members_set_updated_at ON public.family_members;
DROP TRIGGER IF EXISTS families_set_updated_at ON public.families;
DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
DROP FUNCTION IF EXISTS public.set_db_core_updated_at();

DROP INDEX IF EXISTS public.albums_owner_id_idx;
DROP INDEX IF EXISTS public.albums_created_by_status_created_idx;
DROP INDEX IF EXISTS public.albums_family_status_event_created_idx;
ALTER TABLE public.albums DROP CONSTRAINT IF EXISTS albums_visibility_check;
ALTER TABLE public.albums DROP CONSTRAINT IF EXISTS albums_status_check;
ALTER TABLE public.albums DROP CONSTRAINT IF EXISTS albums_created_by_fkey;
ALTER TABLE public.albums DROP CONSTRAINT IF EXISTS albums_family_id_fkey;
ALTER TABLE public.albums DROP COLUMN IF EXISTS legacy_migrated_at;
ALTER TABLE public.albums DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE public.albums DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.albums DROP COLUMN IF EXISTS visibility;
ALTER TABLE public.albums DROP COLUMN IF EXISTS status;
ALTER TABLE public.albums DROP COLUMN IF EXISTS event_at;
ALTER TABLE public.albums DROP COLUMN IF EXISTS created_by;
ALTER TABLE public.albums DROP COLUMN IF EXISTS family_id;

DROP TABLE IF EXISTS public.family_members;
DROP TABLE IF EXISTS public.families;
DROP TABLE IF EXISTS public.profiles;

COMMIT;
