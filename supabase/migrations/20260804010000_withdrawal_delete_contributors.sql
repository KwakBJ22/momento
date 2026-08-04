-- Withdrawal regression fix (500 on account deletion).
--
-- album_contributors has: CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL). A signed-in
-- participant's row has user_id set and guest_id NULL. delete_profile_cascade drops the
-- profile; the FK album_contributors.user_id is ON DELETE SET NULL, so user_id becomes NULL
-- while guest_id is already NULL → both NULL → the CHECK is violated (23514) → the whole
-- withdrawal fails with a 500. (The recent contribution-attribution work started filling
-- user_id, which is why this path was first hit in production.)
--
-- Fix (PO decision): remove the withdrawn person's contributor rows — they leave the
-- participant roster, exactly like album_members. Their photos (album_photos) and memories
-- (photo_memories) stay in the album; those author FKs are ON DELETE SET NULL, so only the
-- author attribution disappears (existing principle: never delete other people's
-- contributions, only unlink the author). We do NOT relax the CHECK — an identity-less
-- contributor row would force every reader to handle that state.
--
-- Audit (2026-08-04, prod): of the 14 columns that reference public.profiles with
-- ON DELETE SET NULL, album_contributors.user_id is the ONLY one involved in a CHECK a NULL
-- can violate, and NONE of those columns are NOT NULL — so no other table has this bug class.

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
  -- The withdrawn person leaves the participant roster. Their photos/memories remain in the
  -- album (author FKs are ON DELETE SET NULL); only this roster row goes. Without this, the
  -- SET NULL on user_id below would leave a row failing album_contributors_identity_check.
  DELETE FROM public.album_contributors WHERE user_id = p_profile_id;

  -- Only a family nobody else belongs to and no album points at is removed.
  -- A shared family survives with created_by set to NULL.
  DELETE FROM public.families AS f
  WHERE f.created_by = p_profile_id
    AND NOT EXISTS (SELECT 1 FROM public.family_members AS fm WHERE fm.family_id = f.id)
    AND NOT EXISTS (SELECT 1 FROM public.albums AS a WHERE a.family_id = f.id);

  -- Every remaining reference is ON DELETE SET NULL, so the contributions this
  -- person left in other people's albums stay where they are, unattributed.
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
