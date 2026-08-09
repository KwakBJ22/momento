-- 앨범을 지우면 자식이 **DB 스스로** 사라진다 (K-2 · SCREEN_SPEC §9).
--
-- `albums` 를 가리키는 자식 17개 중 **여덟이 `RESTRICT`** 였고 의존이 두 겹이었다:
--
--     memory_answers → memory_questions → album_media → albums
--     guest_memory_submissions → share_links → albums
--
-- 그래서 삭제 RPC 가 **순서를 손으로 알고 있어야** 했다. 2026-08-09 에 PO 가 앨범을
-- 지우려다 두 번 막혔다.
--
-- ★ **DB 가 알려주지 않으면 사람은 반드시 틀린다.** 새 자식 테이블이 하나 얹히고 RPC 에
--   안 들어가면 그 순간부터 프로덕션에서 앨범 삭제가 **조용히 실패한다.** 테스트로도
--   안 잡힌다 — 테스트 DB 에는 그 테이블에 행이 없기 때문이다.
--
-- ★ **`SET NULL` 은 그대로 둔다** — `analytics_events` · `ai_usage_logs`.
--   통계는 앨범이 사라져도 남아야 한다(§9 — 데이터를 잃지 않는다).
-- ★ `profiles`·`users`·`families` 를 가리키는 RESTRICT 도 그대로 둔다. 이번 건은
--   **앨범을 지울 때** 무엇이 따라 사라지는가 하나다.
--
-- ★ 지금 프로덕션 앨범이 1건이라 이 바꿈이 값싸다. 늘어난 뒤에는 같은 일을 하기 어렵다.
BEGIN;

-- ① albums 의 자식 여덟
ALTER TABLE public.album_media
  DROP CONSTRAINT album_media_album_id_fkey,
  ADD CONSTRAINT album_media_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE CASCADE;

ALTER TABLE public.album_members
  DROP CONSTRAINT album_members_album_id_fkey,
  ADD CONSTRAINT album_members_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE CASCADE;

ALTER TABLE public.album_photos
  DROP CONSTRAINT album_photos_album_id_fkey,
  ADD CONSTRAINT album_photos_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE CASCADE;

ALTER TABLE public.album_story_inputs
  DROP CONSTRAINT album_story_inputs_album_id_fkey,
  ADD CONSTRAINT album_story_inputs_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE CASCADE;

ALTER TABLE public.guest_album_sessions
  DROP CONSTRAINT guest_album_sessions_album_id_fkey,
  ADD CONSTRAINT guest_album_sessions_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE CASCADE;

ALTER TABLE public.guest_memory_submissions
  DROP CONSTRAINT guest_memory_submissions_album_id_fkey,
  ADD CONSTRAINT guest_memory_submissions_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE CASCADE;

ALTER TABLE public.memory_questions
  DROP CONSTRAINT memory_questions_album_id_fkey,
  ADD CONSTRAINT memory_questions_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE CASCADE;

ALTER TABLE public.share_links
  DROP CONSTRAINT share_links_album_id_fkey,
  ADD CONSTRAINT share_links_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE CASCADE;

-- ② 자식들끼리의 RESTRICT — 두 겹이 되는 자리들이다. 여기가 남으면 ①만으로는 못 지운다.
ALTER TABLE public.memory_answers
  DROP CONSTRAINT memory_answers_question_id_fkey,
  ADD CONSTRAINT memory_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.memory_questions(id) ON DELETE CASCADE;

ALTER TABLE public.memory_questions
  DROP CONSTRAINT memory_questions_media_id_fkey,
  ADD CONSTRAINT memory_questions_media_id_fkey FOREIGN KEY (media_id) REFERENCES public.album_media(id) ON DELETE CASCADE;

ALTER TABLE public.guest_memory_submissions
  DROP CONSTRAINT guest_memory_submissions_share_link_id_fkey,
  ADD CONSTRAINT guest_memory_submissions_share_link_id_fkey FOREIGN KEY (share_link_id) REFERENCES public.share_links(id) ON DELETE CASCADE;

ALTER TABLE public.photo_memories
  DROP CONSTRAINT photo_memories_contributor_id_fkey,
  ADD CONSTRAINT photo_memories_contributor_id_fkey FOREIGN KEY (contributor_id) REFERENCES public.album_contributors(id) ON DELETE CASCADE;

-- ③ 손으로 적어 둔 삭제 순서를 지운다 — DB 가 하는 일을 코드가 또 하지 않는다.
--   ★ **가드는 남긴다.** 이 함수가 하는 진짜 일은 "지울 자격이 있는가"이고, 그것은
--     CASCADE 가 대신해 주지 않는다.
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

  -- 자식은 FK 가 지운다(K-2). 여기에 테이블 이름을 다시 적지 않는다 —
  -- 적기 시작하면 새 테이블이 생길 때마다 빠뜨린다.
  DELETE FROM public.albums WHERE id = p_album_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$function$;

-- 주인 없는 게스트 앨범도 같다. 가드(불변식)는 남기고 열거만 지운다.
CREATE OR REPLACE FUNCTION public.delete_abandoned_guest_album(p_album_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
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

  -- 자식은 FK 가 지운다(K-2).
  DELETE FROM public.albums WHERE id = p_album_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$function$;

COMMIT;
