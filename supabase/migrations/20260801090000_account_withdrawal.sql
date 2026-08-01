-- Account withdrawal.
--
-- Withdrawal has to remove the profile row itself, not just blank it out, so
-- that `auth.users` can be hard deleted afterwards (profiles.id references
-- auth.users(id) ON DELETE RESTRICT).
--
-- Four columns blocked that deletion with NOT NULL + ON DELETE RESTRICT even
-- though the rows they belong to are other people's albums.  They become
-- nullable with ON DELETE SET NULL: the memory stays inside the album that
-- owns it, and only the link back to the withdrawn person disappears.
--
-- Membership rows (album_members, family_members, family_invitations) carry no
-- memory of their own and are deleted outright by delete_profile_cascade.

BEGIN;

-- album_story_inputs: story hints the user wrote inside an album.
ALTER TABLE public.album_story_inputs ALTER COLUMN author_profile_id DROP NOT NULL;
ALTER TABLE public.album_story_inputs DROP CONSTRAINT IF EXISTS album_story_inputs_author_profile_id_fkey;
ALTER TABLE public.album_story_inputs
  ADD CONSTRAINT album_story_inputs_author_profile_id_fkey
  FOREIGN KEY (author_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- memory_answers: answers the user left on an album's questions.
ALTER TABLE public.memory_answers ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE public.memory_answers DROP CONSTRAINT IF EXISTS memory_answers_profile_id_fkey;
ALTER TABLE public.memory_answers
  ADD CONSTRAINT memory_answers_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- share_links: a link the user created on an album they do not own.
ALTER TABLE public.share_links ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.share_links DROP CONSTRAINT IF EXISTS share_links_created_by_fkey;
ALTER TABLE public.share_links
  ADD CONSTRAINT share_links_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- families: a shared family must outlive the member who created it.
ALTER TABLE public.families ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.families DROP CONSTRAINT IF EXISTS families_created_by_fkey;
ALTER TABLE public.families
  ADD CONSTRAINT families_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


-- Remove one profile and its membership rows atomically.
--
-- Albums are deliberately not handled here.  The API deletes them first, one
-- by one, because each album also owns Storage objects that must be collected
-- before its rows disappear.  If any album is still owned by this profile the
-- function refuses rather than orphaning it.
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
