-- Album memory category for MVP onboarding (family/friend/couple/...).
BEGIN;

ALTER TABLE public.albums
  ADD COLUMN IF NOT EXISTS category text;

UPDATE public.albums
SET category = CASE meeting_type
  WHEN 'family' THEN 'family'
  WHEN 'friend' THEN 'friend'
  WHEN 'work' THEN 'colleague'
  WHEN 'university' THEN 'friend'
  ELSE 'other'
END
WHERE category IS NULL;

ALTER TABLE public.albums
  DROP CONSTRAINT IF EXISTS albums_category_check;

ALTER TABLE public.albums
  ADD CONSTRAINT albums_category_check
  CHECK (
    category IS NULL OR category IN (
      'family', 'friend', 'couple', 'colleague', 'pet', 'travel', 'other'
    )
  ) NOT VALID;

ALTER TABLE public.albums
  VALIDATE CONSTRAINT albums_category_check;

-- Allow guest-created share links without a profile owner.
ALTER TABLE public.share_links
  ALTER COLUMN created_by DROP NOT NULL;

COMMIT;
