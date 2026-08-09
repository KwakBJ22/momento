-- K-17 되돌리기.
--
-- ★ 되돌리면 **탈퇴가 다시 막힌다** — 남의 앨범에 계정으로 참여한 적이 있는 사람은
--   `album_contributors_identity_check` 때문에 프로필을 지울 수 없다. 그것이
--   K-17 이전의 상태다.
-- ★ 이미 탈퇴로 이름이 비어 있는 행이 있으면 아래 CHECK 를 다시 걸 수 없다.
--   그런 행은 되돌리기 전에 사람이 판단해야 한다(지울지, 이름을 넣을지) —
--   여기서 임의로 채우지 않는다. 개인정보를 되살리는 일이기 때문이다.
BEGIN;

ALTER TABLE public.album_contributors DROP CONSTRAINT album_contributors_identity_check;
ALTER TABLE public.album_contributors
  ADD CONSTRAINT album_contributors_identity_check
  CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL);

ALTER TABLE public.album_contributors DROP CONSTRAINT album_contributors_display_name_len;
ALTER TABLE public.album_contributors
  ADD CONSTRAINT album_contributors_display_name_len
  CHECK (char_length(btrim(display_name)) >= 1 AND char_length(btrim(display_name)) <= 40);

ALTER TABLE public.photo_memories DROP CONSTRAINT photo_memories_author_name_len;
ALTER TABLE public.photo_memories
  ADD CONSTRAINT photo_memories_author_name_len
  CHECK (char_length(btrim(author_name)) >= 1 AND char_length(btrim(author_name)) <= 40);

COMMIT;
