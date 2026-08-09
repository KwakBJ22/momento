-- K-2 되돌리기 — FK 를 다시 `RESTRICT` 로, RPC 에 삭제 순서를 다시 적는다.
--
-- ★ 되돌리면 **앨범 삭제가 다시 RPC 의 손 열거에 기댄다.** 그래서 아래 두 함수의
--   본문은 K-2 이전의 것과 글자 그대로 같아야 한다 — 하나라도 빠지면 그때부터
--   프로덕션에서 앨범 삭제가 조용히 실패한다.
BEGIN;

ALTER TABLE public.album_media
  DROP CONSTRAINT album_media_album_id_fkey,
  ADD CONSTRAINT album_media_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE RESTRICT;

ALTER TABLE public.album_members
  DROP CONSTRAINT album_members_album_id_fkey,
  ADD CONSTRAINT album_members_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE RESTRICT;

ALTER TABLE public.album_photos
  DROP CONSTRAINT album_photos_album_id_fkey,
  ADD CONSTRAINT album_photos_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE RESTRICT;

ALTER TABLE public.album_story_inputs
  DROP CONSTRAINT album_story_inputs_album_id_fkey,
  ADD CONSTRAINT album_story_inputs_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE RESTRICT;

ALTER TABLE public.guest_album_sessions
  DROP CONSTRAINT guest_album_sessions_album_id_fkey,
  ADD CONSTRAINT guest_album_sessions_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE RESTRICT;

ALTER TABLE public.guest_memory_submissions
  DROP CONSTRAINT guest_memory_submissions_album_id_fkey,
  ADD CONSTRAINT guest_memory_submissions_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE RESTRICT;

ALTER TABLE public.memory_questions
  DROP CONSTRAINT memory_questions_album_id_fkey,
  ADD CONSTRAINT memory_questions_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE RESTRICT;

ALTER TABLE public.share_links
  DROP CONSTRAINT share_links_album_id_fkey,
  ADD CONSTRAINT share_links_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE RESTRICT;

ALTER TABLE public.memory_answers
  DROP CONSTRAINT memory_answers_question_id_fkey,
  ADD CONSTRAINT memory_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.memory_questions(id) ON DELETE RESTRICT;

ALTER TABLE public.memory_questions
  DROP CONSTRAINT memory_questions_media_id_fkey,
  ADD CONSTRAINT memory_questions_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.album_media(id) ON DELETE RESTRICT;

ALTER TABLE public.guest_memory_submissions
  DROP CONSTRAINT guest_memory_submissions_share_link_id_fkey,
  ADD CONSTRAINT guest_memory_submissions_share_link_id_fkey FOREIGN KEY (share_link_id) REFERENCES public.share_links(id) ON DELETE RESTRICT;

ALTER TABLE public.photo_memories
  DROP CONSTRAINT photo_memories_contributor_id_fkey,
  ADD CONSTRAINT photo_memories_contributor_id_fkey FOREIGN KEY (contributor_id) REFERENCES public.album_contributors(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.delete_album_cascade(p_album_id uuid, p_actor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_abandoned_guest_album(p_album_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
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
$function$;

COMMIT;
