-- Sprint 2: private photo assets. Legacy `albums` bucket remains public for
-- existing shared album result images; originals and thumbnails use this new bucket.

BEGIN;

CREATE TABLE IF NOT EXISTS public.album_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE RESTRICT,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  thumbnail_bucket text NOT NULL,
  thumbnail_path text NOT NULL,
  original_filename text,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  checksum_sha256 text NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  caption text,
  contributor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  legacy_author_label text,
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('uploading', 'ready', 'failed', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT album_photos_album_sort_order_key UNIQUE (album_id, sort_order),
  CONSTRAINT album_photos_storage_path_key UNIQUE (storage_bucket, storage_path),
  CONSTRAINT album_photos_thumbnail_path_key UNIQUE (thumbnail_bucket, thumbnail_path)
);

CREATE INDEX IF NOT EXISTS album_photos_album_sort_order_idx
  ON public.album_photos (album_id, sort_order)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS album_photos_contributor_created_idx
  ON public.album_photos (contributor_profile_id, created_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS album_photos_set_updated_at ON public.album_photos;
CREATE TRIGGER album_photos_set_updated_at
  BEFORE UPDATE ON public.album_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();

ALTER TABLE public.album_photos ENABLE ROW LEVEL SECURITY;
-- No direct client policy: only the service-role API can issue scoped signed URLs.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'momento-private',
  'momento-private',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
