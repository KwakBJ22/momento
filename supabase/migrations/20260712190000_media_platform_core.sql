-- Sprint 2.5: additive media platform core. `album_photos` remains the
-- compatibility source for existing photo APIs; new writes are dual-recorded.

BEGIN;

CREATE TABLE IF NOT EXISTS public.album_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE RESTRICT,
  uploader_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  media_type text NOT NULL CHECK (media_type IN ('image', 'gif', 'video', 'audio', 'document')),
  mime_type text NOT NULL,
  original_filename text,
  original_path text NOT NULL,
  preview_path text,
  thumbnail_path text,
  file_size bigint NOT NULL CHECK (file_size > 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_seconds numeric(12, 3),
  page_count integer CHECK (page_count IS NULL OR page_count > 0),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  processing_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT album_media_album_sort_order_key UNIQUE (album_id, sort_order)
);

CREATE INDEX IF NOT EXISTS album_media_album_sort_order_idx
  ON public.album_media (album_id, sort_order)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS album_media_uploader_created_idx
  ON public.album_media (uploader_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS album_media_original_path_key
  ON public.album_media (original_path)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS album_media_set_updated_at ON public.album_media;
CREATE TRIGGER album_media_set_updated_at
  BEFORE UPDATE ON public.album_media
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();

ALTER TABLE public.album_media ENABLE ROW LEVEL SECURITY;
-- Direct browser access remains denied; the API returns signed URLs after ownership checks.

INSERT INTO public.album_media (
  id, album_id, uploader_id, media_type, mime_type, original_filename,
  original_path, thumbnail_path, file_size, sort_order, processing_status,
  metadata, created_at, updated_at, deleted_at
)
SELECT
  p.id,
  p.album_id,
  p.contributor_profile_id,
  CASE WHEN p.mime_type = 'image/gif' THEN 'gif' ELSE 'image' END,
  p.mime_type,
  p.original_filename,
  p.storage_path,
  p.thumbnail_path,
  p.byte_size,
  p.sort_order,
  CASE WHEN p.status = 'ready' THEN 'ready' ELSE 'failed' END,
  jsonb_build_object('source', 'album_photos', 'legacy_author_label', p.legacy_author_label),
  p.created_at,
  p.updated_at,
  p.deleted_at
FROM public.album_photos AS p
ON CONFLICT (id) DO NOTHING;

COMMIT;
