-- Participation design §3: album guestbook. A short message on the whole album,
-- distinct from per-photo memories (photo_memories). Anyone — including view-link
-- visitors — can leave one. Ownership for self-delete is a per-browser session hash
-- (same idea as share_reactions), not the contributor system, so a pure viewer is
-- never blocked by contributor limits or collaboration status. contributor_id is a
-- nullable attribution link only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.album_guestbook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  contributor_id uuid REFERENCES public.album_contributors(id) ON DELETE SET NULL,
  author_name text NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 40),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 200),
  session_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS album_guestbook_album_idx
  ON public.album_guestbook_entries (album_id, created_at DESC) WHERE deleted_at IS NULL;

-- delete_album_cascade must remove guestbook rows or deleting an album (and
-- therefore withdrawing an account that owns it) fails on the album_id FK.
-- (album_id is ON DELETE CASCADE as a backstop; this explicit delete keeps the
-- cascade function authoritative and ordered.)
CREATE OR REPLACE FUNCTION public.delete_album_cascade(
  p_album_id uuid,
  p_actor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.albums AS a
    WHERE a.id = p_album_id
      AND (
        a.owner_id = p_actor_id
        OR a.created_by = p_actor_id
        OR EXISTS (
          SELECT 1 FROM public.album_members AS am
          WHERE am.album_id = a.id AND am.profile_id = p_actor_id
            AND am.status = 'active' AND am.role = 'owner'
        )
        OR EXISTS (
          SELECT 1 FROM public.family_members AS fm
          WHERE fm.family_id = a.family_id AND fm.profile_id = p_actor_id
            AND fm.status = 'active' AND fm.role = 'owner'
        )
      )
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.albums SET cover_photo_id = NULL WHERE id = p_album_id;

  DELETE FROM public.album_guestbook_entries WHERE album_id = p_album_id;
  DELETE FROM public.guest_memory_submissions WHERE album_id = p_album_id;
  DELETE FROM public.share_reactions WHERE album_id = p_album_id;
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

REVOKE ALL ON FUNCTION public.delete_album_cascade(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_album_cascade(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_album_cascade(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_album_cascade(uuid, uuid) TO service_role;

COMMIT;
