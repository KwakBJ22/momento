BEGIN;

ALTER TABLE public.album_photos
  ADD COLUMN IF NOT EXISTS display_bucket text,
  ADD COLUMN IF NOT EXISTS display_path text;

CREATE INDEX IF NOT EXISTS album_photos_display_path_idx
  ON public.album_photos (display_bucket, display_path)
  WHERE display_path IS NOT NULL;

COMMIT;
