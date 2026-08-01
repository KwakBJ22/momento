-- Rollback for 20260802100000_album_guestbook.sql. Emergency use only.
-- Restores delete_album_cascade without the guestbook delete, then drops the table.
BEGIN;

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
    SELECT 1 FROM public.albums AS a
    WHERE a.id = p_album_id
      AND (
        a.owner_id = p_actor_id OR a.created_by = p_actor_id
        OR EXISTS (SELECT 1 FROM public.album_members AS am WHERE am.album_id = a.id AND am.profile_id = p_actor_id AND am.status = 'active' AND am.role = 'owner')
        OR EXISTS (SELECT 1 FROM public.family_members AS fm WHERE fm.family_id = a.family_id AND fm.profile_id = p_actor_id AND fm.status = 'active' AND fm.role = 'owner')
      )
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.albums SET cover_photo_id = NULL WHERE id = p_album_id;

  DELETE FROM public.guest_memory_submissions WHERE album_id = p_album_id;
  DELETE FROM public.share_reactions WHERE album_id = p_album_id;
  DELETE FROM public.share_links WHERE album_id = p_album_id;
  DELETE FROM public.guest_album_sessions WHERE album_id = p_album_id;
  DELETE FROM public.photo_memories WHERE album_id = p_album_id;
  DELETE FROM public.memory_answers WHERE question_id IN (SELECT id FROM public.memory_questions WHERE album_id = p_album_id);
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

DROP TABLE IF EXISTS public.album_guestbook_entries;

COMMIT;
