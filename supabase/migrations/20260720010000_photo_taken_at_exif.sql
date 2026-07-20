-- Photo capture time and GPS from EXIF (nullable; missing EXIF stays null)
BEGIN;

ALTER TABLE public.album_photos
  ADD COLUMN IF NOT EXISTS taken_at timestamptz,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS orientation text,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer;

ALTER TABLE public.album_media
  ADD COLUMN IF NOT EXISTS taken_at timestamptz,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS orientation text;

ALTER TABLE public.album_photos
  DROP CONSTRAINT IF EXISTS album_photos_orientation_check;
ALTER TABLE public.album_photos
  ADD CONSTRAINT album_photos_orientation_check
  CHECK (
    orientation IS NULL OR orientation IN ('landscape', 'portrait', 'square')
  ) NOT VALID;
ALTER TABLE public.album_photos
  VALIDATE CONSTRAINT album_photos_orientation_check;

ALTER TABLE public.album_media
  DROP CONSTRAINT IF EXISTS album_media_orientation_check;
ALTER TABLE public.album_media
  ADD CONSTRAINT album_media_orientation_check
  CHECK (
    orientation IS NULL OR orientation IN ('landscape', 'portrait', 'square')
  ) NOT VALID;
ALTER TABLE public.album_media
  VALIDATE CONSTRAINT album_media_orientation_check;

CREATE INDEX IF NOT EXISTS album_photos_album_taken_at_idx
  ON public.album_photos (album_id, taken_at ASC NULLS LAST, sort_order ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS album_media_album_taken_at_idx
  ON public.album_media (album_id, taken_at ASC NULLS LAST, sort_order ASC)
  WHERE deleted_at IS NULL;

COMMIT;
