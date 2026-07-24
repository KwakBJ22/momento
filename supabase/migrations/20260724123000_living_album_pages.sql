-- Living Album: small collaboration updates are appended after the epilogue.
-- The existing album_version_history keeps full-edition snapshots; this column
-- only stores the lightweight pages currently attached to the latest edition.
ALTER TABLE public.albums
  ADD COLUMN IF NOT EXISTS living_append_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS living_latest_edition_previous integer NULL;

COMMENT ON COLUMN public.albums.living_append_pages IS
  'Append-only Living Album pages. Each page references stable photo and memory IDs.';
