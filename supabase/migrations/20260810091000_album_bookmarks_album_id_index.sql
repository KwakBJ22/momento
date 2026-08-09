-- `담아둔 앨범` 조회에 쓰는 인덱스 (K-4).
--
-- `담아둔 앨범` 은 `내 앨범` 을 열 때마다 조회한다. `album_bookmarks.album_id` 에
-- 인덱스가 없었다.
--
-- ★ FK 인덱스가 없는 컬럼이 16개인데 **나머지 15개는 죽은 테이블이거나
--   `created_by`·`invited_by` 같은 저빈도**다. 이 하나만 넣는다 —
--   안 쓰는 인덱스는 쓰기를 느리게 할 뿐이다.
BEGIN;

CREATE INDEX IF NOT EXISTS album_bookmarks_album_id_idx
  ON public.album_bookmarks (album_id);

COMMIT;
