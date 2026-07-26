-- Sprint 5: optional user-authored context for story generation.
BEGIN;

CREATE TABLE IF NOT EXISTS public.album_story_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE RESTRICT,
  author_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  input_key text NOT NULL CHECK (input_key IN ('memory_hint', 'people', 'highlight')),
  value text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT album_story_inputs_unique_key UNIQUE (album_id, author_profile_id, input_key)
);

CREATE INDEX IF NOT EXISTS album_story_inputs_album_idx ON public.album_story_inputs (album_id, updated_at DESC);
DROP TRIGGER IF EXISTS album_story_inputs_set_updated_at ON public.album_story_inputs;
CREATE TRIGGER album_story_inputs_set_updated_at
  BEFORE UPDATE ON public.album_story_inputs
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();
ALTER TABLE public.album_story_inputs ENABLE ROW LEVEL SECURITY;
-- Access is mediated by the family/album authorization API.

COMMIT;
