-- K-7b 되돌리기 — 담은 링크 기억을 뺀다.
-- ★ 이 열을 빼면 담아둔 앨범을 **다시 열 수 없다**(구경꾼은 /album/{id} 로 403).
--   되돌릴 때는 담아두기 화면도 함께 되돌려야 한다.
BEGIN;

ALTER TABLE public.album_bookmarks DROP COLUMN IF EXISTS share_token;

COMMIT;
