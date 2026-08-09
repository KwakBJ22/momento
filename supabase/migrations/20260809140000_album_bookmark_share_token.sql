-- 담아둔 앨범을 **담은 그 링크로** 연다 (K-7b · SCREEN_SPEC §1).
--
-- `album_bookmarks` 는 `user_id + album_id` 만 갖고 있었다. 그런데 담아두는 사람은
-- **구경꾼**이라 멤버가 아니다 — `/album/{id}` 로 열면 403 이다.
-- 담아두기가 한 번도 성공한 적이 없어서(행 0건) 이 자리는 실행된 적이 없었다.
--
-- ★ 그래서 **어떤 공유 링크로 담았는지**를 함께 저장하고, 목록에서 열 때 그 링크로 연다.
--   §1 의 "담아둬도 권한은 바뀌지 않는다"와 맞는다 — 구경꾼은 계속 구경꾼이다.
--
-- ★ 왜 `share_link_id` 가 아니라 **토큰**인가:
--   `share_links` 는 `token_hash` 만 저장한다(원본 토큰은 어디에도 없다).
--   id 만으로는 `/s/{token}` 을 다시 만들 수 없다. 열려면 토큰 자체가 있어야 한다.
--   이 값은 그 사람이 이미 받은 링크이고, 행은 그 사람의 `user_id` 에 묶여 있다.
--
-- ★ 링크가 죽으면(만료·중단·앨범 삭제) J-9 이 만든 세 갈래 문구가 그대로 뜬다.
--   여기서 새로 만들지 않는다.
BEGIN;

ALTER TABLE public.album_bookmarks
  ADD COLUMN IF NOT EXISTS share_token text;

COMMENT ON COLUMN public.album_bookmarks.share_token IS
  '담을 때 쓴 구경용 링크 토큰. 목록에서 /s/{token} 으로 연다(K-7b). 없으면 옛 행이다.';

COMMIT;
