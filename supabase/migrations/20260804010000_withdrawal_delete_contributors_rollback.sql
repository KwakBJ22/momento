-- Rollback for 20260804010000_withdrawal_delete_contributors.sql. Restores the previous
-- delete_profile_cascade (20260801090000) WITHOUT the album_contributors delete.
-- Emergency use only: withdrawal for signed-in participants will fail again (23514).
BEGIN;

CREATE OR REPLACE FUNCTION public.delete_profile_cascade(p_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.albums AS a
    WHERE a.owner_id = p_profile_id OR a.created_by = p_profile_id
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM public.album_members WHERE profile_id = p_profile_id;
  DELETE FROM public.family_invitations WHERE inviter_id = p_profile_id;
  DELETE FROM public.family_members WHERE profile_id = p_profile_id;

  DELETE FROM public.families AS f
  WHERE f.created_by = p_profile_id
    AND NOT EXISTS (SELECT 1 FROM public.family_members AS fm WHERE fm.family_id = f.id)
    AND NOT EXISTS (SELECT 1 FROM public.albums AS a WHERE a.family_id = f.id);

  DELETE FROM public.profiles WHERE id = p_profile_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_profile_cascade(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_profile_cascade(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_profile_cascade(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_profile_cascade(uuid) TO service_role;

COMMIT;
