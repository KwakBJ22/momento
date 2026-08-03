-- Rollback for 20260803130001_delete_abandoned_guest_album.sql.
BEGIN;

DROP FUNCTION IF EXISTS public.delete_abandoned_guest_album(uuid);

COMMIT;
