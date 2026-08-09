-- 회원 탈퇴가 **실제로 막히던 자리** (K-17 · SCREEN_SPEC §5 27차).
--
-- ★ 막은 것은 FK 가 아니라 **CHECK 였다.** 프로덕션에서 예행해 확인했다(2026-08-10):
--
--     ERROR: 23514 new row for relation "album_contributors"
--            violates check constraint "album_contributors_identity_check"
--     CONTEXT: SQL statement "UPDATE ONLY album_contributors SET user_id = NULL ..."
--
--   `album_contributors.user_id` 는 `ON DELETE SET NULL` 이다. 그런데
--   `CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL)` 이 걸려 있어서,
--   프로필을 지우는 순간 그 SET NULL 이 **자기 테이블의 CHECK 를 어긴다.**
--
--   즉 **남의 앨범에 계정으로 참여한 적이 있는 사람은 탈퇴가 아예 안 된다.**
--   (`profiles` 를 가리키는 RESTRICT 넷은 탈퇴 코드가 이미 순서대로 지우고 있었다.)
--
-- ★ 그 행을 **지워서** 푸는 길은 택하지 않는다. `photo_memories` 가 참여자 행을
--   가리키고(K-2 에서 CASCADE), 그러면 **남의 앨범에 남긴 한마디가 함께 사라진다.**
--   §5 는 "남의 앨범의 사진·한 줄을 지우지 않는다. 이름만 끊는다" 이다.
--
-- 그래서 **이름 없는 참여자**라는 상태를 정식으로 허용한다. 탈퇴한 사람의 행은
-- 누구인지도 모르고 이름도 없다 — 사진은 그 앨범의 것으로 남는다.
--
-- ★ 원래 의도는 지킨다. `누구인지 모르는 행은 **이름도 없어야 한다**` 로 바꿀 뿐이다.
--   이름을 가진 유령 참여자는 여전히 만들 수 없다.
BEGIN;

-- ① 이름을 **비울 수 있게** 한다. 길이 상한 40 은 그대로다.
--    (`탈퇴한 사용자` 같은 글자를 남기지 않는다 — 그 말은 남의 추억에 박히고
--     인쇄물에도 들어간다. 비우면 `함께 만든 사람` 줄이 그 자리를 건너뛴다.)
ALTER TABLE public.album_contributors DROP CONSTRAINT album_contributors_display_name_len;
ALTER TABLE public.album_contributors
  ADD CONSTRAINT album_contributors_display_name_len
  CHECK (char_length(btrim(display_name)) <= 40);

ALTER TABLE public.photo_memories DROP CONSTRAINT photo_memories_author_name_len;
ALTER TABLE public.photo_memories
  ADD CONSTRAINT photo_memories_author_name_len
  CHECK (char_length(btrim(author_name)) <= 40);

-- ② 이름 없는 참여자를 허용한다 — **그때만** 신원이 없을 수 있다.
ALTER TABLE public.album_contributors DROP CONSTRAINT album_contributors_identity_check;
ALTER TABLE public.album_contributors
  ADD CONSTRAINT album_contributors_identity_check
  CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL OR btrim(display_name) = '');

COMMENT ON CONSTRAINT album_contributors_identity_check ON public.album_contributors IS
  '참여자는 계정이거나 게스트다. 단 탈퇴로 이름까지 지워진 행은 둘 다 없을 수 있다(K-17).';

COMMIT;
