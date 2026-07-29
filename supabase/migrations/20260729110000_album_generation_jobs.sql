BEGIN;

-- Initial album creation persists its work before the slow image and story
-- steps begin.  This lets a request return once originals are safely stored
-- and also prevents a Railway restart from losing the only record of work.
CREATE TABLE IF NOT EXISTS public.album_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress integer NOT NULL DEFAULT 20 CHECK (progress >= 0 AND progress <= 100),
  current_step text NOT NULL DEFAULT 'upload_completed',
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS album_generation_jobs_one_active_per_album
  ON public.album_generation_jobs (album_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS album_generation_jobs_status_updated_idx
  ON public.album_generation_jobs (status, updated_at);

DROP TRIGGER IF EXISTS album_generation_jobs_set_updated_at ON public.album_generation_jobs;
CREATE TRIGGER album_generation_jobs_set_updated_at
  BEFORE UPDATE ON public.album_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();

ALTER TABLE public.album_generation_jobs ENABLE ROW LEVEL SECURITY;

-- Initial uploads store originals first.  These nullable derivative paths are
-- populated by the background job; reads fall back to storage_path meanwhile.
ALTER TABLE public.album_photos
  ALTER COLUMN thumbnail_path DROP NOT NULL,
  ALTER COLUMN thumbnail_bucket DROP NOT NULL;

COMMIT;
