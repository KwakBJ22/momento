-- Sprint 4.1: optional Vision analysis stored per album_media row.

BEGIN;

ALTER TABLE public.album_media
  ADD COLUMN IF NOT EXISTS media_analysis jsonb;

COMMIT;
