-- Album visual/story style: warm | joyful | special
BEGIN;

ALTER TABLE public.albums
  ADD COLUMN IF NOT EXISTS template_type text;

UPDATE public.albums
SET template_type = CASE upper(coalesce(template, 'B'))
  WHEN 'A' THEN 'warm'
  WHEN 'C' THEN 'special'
  ELSE 'joyful'
END
WHERE template_type IS NULL;

ALTER TABLE public.albums
  DROP CONSTRAINT IF EXISTS albums_template_type_check;

ALTER TABLE public.albums
  ADD CONSTRAINT albums_template_type_check
  CHECK (
    template_type IS NULL OR template_type IN ('warm', 'joyful', 'special')
  ) NOT VALID;

ALTER TABLE public.albums
  VALIDATE CONSTRAINT albums_template_type_check;

COMMIT;
