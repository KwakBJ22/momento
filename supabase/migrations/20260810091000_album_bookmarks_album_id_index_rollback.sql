-- K-4 되돌리기.
BEGIN;

DROP INDEX IF EXISTS public.album_bookmarks_album_id_idx;

COMMIT;
