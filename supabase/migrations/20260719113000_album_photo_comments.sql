-- Photo-level comments are additive. `caption` is kept for legacy clients.
BEGIN;

ALTER TABLE public.album_photos
  ADD COLUMN IF NOT EXISTS comment text;

-- Preserve existing descriptions as comments while normalizing empty strings to NULL.
UPDATE public.album_photos
SET comment = NULLIF(btrim(caption), '')
WHERE comment IS NULL AND caption IS NOT NULL;

ALTER TABLE public.album_photos
  ADD CONSTRAINT album_photos_comment_length_check
  CHECK (comment IS NULL OR char_length(comment) <= 300) NOT VALID;

ALTER TABLE public.album_photos
  VALIDATE CONSTRAINT album_photos_comment_length_check;

COMMIT;
