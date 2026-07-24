-- MVP album cover selection and non-destructive collaboration rebuild history.
BEGIN;

ALTER TABLE public.albums
  ADD COLUMN IF NOT EXISTS cover_photo_id uuid,
  ADD COLUMN IF NOT EXISTS album_version_history jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS albums_cover_photo_id_idx
  ON public.albums (cover_photo_id)
  WHERE cover_photo_id IS NOT NULL;

-- This value now acts only as an in-progress rebuild lock, not a quota timer.
UPDATE public.albums
SET last_rebuild_started_at = NULL
WHERE last_rebuild_started_at IS NOT NULL;

COMMIT;
