-- Rollback for 20260809100000_album_bookmarks.sql.
-- 되돌리면 사람들이 담아 둔 목록이 사라진다. 앨범 자체는 그대로다(표시일 뿐이므로).
BEGIN;

DROP TABLE IF EXISTS public.album_bookmarks;

COMMIT;
