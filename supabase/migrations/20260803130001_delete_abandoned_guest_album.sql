-- Service-role delete of an ABANDONED guest album (ownerless, unclaimed, expired).
--
-- Why a separate function: delete_album_cascade authorizes by actor = owner/created_by/
-- member-owner/family-owner. A guest album has owner_id AND created_by NULL and no owner
-- rows, so NO actor can authorize it — that function can never remove one. This function
-- has no actor; instead it re-checks the abandonment invariants in SQL so an owned or
-- claimed album can never be deleted even if a caller passes its id by mistake.
--
-- The child-delete block is intentionally identical to delete_album_cascade
-- (20260728120000). Keep the two in sync if the album child schema changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_abandoned_guest_album(
  p_album_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  -- Guard (the INVARIANT, enforced in SQL so a caller can never be trusted to have
  -- checked it): the album must be ownerless, have no claimed session, and have NO
  -- live (unexpired) session — never delete an album someone is still using. The
  -- 7-day grace after the last expiry is POLICY, kept in the Python service layer;
  -- this function only guarantees "not owned, not claimed, not live".
  IF NOT EXISTS (
    SELECT 1
    FROM public.albums AS a
    WHERE a.id = p_album_id
      AND a.owner_id IS NULL
      AND a.created_by IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.guest_album_sessions AS s
        WHERE s.album_id = a.id
          AND s.claimed_profile_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.guest_album_sessions AS s2
        WHERE s2.album_id = a.id
          AND s2.expires_at > now()
      )
  ) THEN
    RETURN false;
  END IF;

  -- Same child order as delete_album_cascade: RESTRICT children before the parent.
  UPDATE public.albums SET cover_photo_id = NULL WHERE id = p_album_id;

  DELETE FROM public.guest_memory_submissions WHERE album_id = p_album_id;
  DELETE FROM public.share_reactions
  WHERE share_link_id IN (SELECT id FROM public.share_links WHERE album_id = p_album_id);
  DELETE FROM public.share_links WHERE album_id = p_album_id;
  DELETE FROM public.guest_album_sessions WHERE album_id = p_album_id;

  DELETE FROM public.photo_memories WHERE album_id = p_album_id;
  DELETE FROM public.memory_answers
  WHERE question_id IN (SELECT id FROM public.memory_questions WHERE album_id = p_album_id);
  DELETE FROM public.memory_questions WHERE album_id = p_album_id;
  DELETE FROM public.album_story_inputs WHERE album_id = p_album_id;
  DELETE FROM public.album_members WHERE album_id = p_album_id;
  DELETE FROM public.album_media WHERE album_id = p_album_id;
  DELETE FROM public.album_photos WHERE album_id = p_album_id;

  DELETE FROM public.albums WHERE id = p_album_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_abandoned_guest_album(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_abandoned_guest_album(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_abandoned_guest_album(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_abandoned_guest_album(uuid) TO service_role;

COMMIT;
