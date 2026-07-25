-- Backfill list ordering for albums created before updated_at was written on insert.
UPDATE public.albums
SET updated_at = created_at
WHERE updated_at IS NULL
  AND deleted_at IS NULL;
