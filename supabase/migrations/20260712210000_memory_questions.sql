-- Sprint 4: memory questions and answers for AI-guided family memories.

BEGIN;

CREATE TABLE IF NOT EXISTS public.memory_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE RESTRICT,
  media_id uuid NOT NULL REFERENCES public.album_media(id) ON DELETE RESTRICT,
  question text NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  ai_prompt text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_questions_album_media_sort_key UNIQUE (album_id, media_id, sort_order)
);

CREATE INDEX IF NOT EXISTS memory_questions_album_status_sort_idx
  ON public.memory_questions (album_id, status, sort_order);
CREATE INDEX IF NOT EXISTS memory_questions_media_status_idx
  ON public.memory_questions (media_id, status);

CREATE TABLE IF NOT EXISTS public.memory_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.memory_questions(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  answer text NOT NULL DEFAULT '',
  answer_type text NOT NULL DEFAULT 'text'
    CHECK (answer_type IN ('text', 'voice')),
  voice_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_answers_question_profile_key UNIQUE (question_id, profile_id)
);

CREATE INDEX IF NOT EXISTS memory_answers_question_created_idx
  ON public.memory_answers (question_id, created_at);
CREATE INDEX IF NOT EXISTS memory_answers_profile_created_idx
  ON public.memory_answers (profile_id, created_at DESC);

DROP TRIGGER IF EXISTS memory_answers_set_updated_at ON public.memory_answers;
CREATE TRIGGER memory_answers_set_updated_at
  BEFORE UPDATE ON public.memory_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();

ALTER TABLE public.memory_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_questions_select_album_access ON public.memory_questions;
CREATE POLICY memory_questions_select_album_access ON public.memory_questions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.albums AS a
      WHERE a.id = album_id
        AND (
          public.is_active_family_member(a.family_id)
          OR public.get_active_album_role(a.id, auth.uid()) IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS memory_answers_select_album_access ON public.memory_answers;
CREATE POLICY memory_answers_select_album_access ON public.memory_answers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.memory_questions AS mq
      JOIN public.albums AS a ON a.id = mq.album_id
      WHERE mq.id = question_id
        AND (
          public.is_active_family_member(a.family_id)
          OR public.get_active_album_role(a.id, auth.uid()) IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS memory_answers_insert_family ON public.memory_answers;
CREATE POLICY memory_answers_insert_family ON public.memory_answers
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.memory_questions AS mq
      JOIN public.albums AS a ON a.id = mq.album_id
      WHERE mq.id = question_id
        AND mq.status = 'active'
        AND (
          public.is_active_family_member(a.family_id)
          OR public.get_active_album_role(a.id, auth.uid()) IS NOT NULL
        )
    )
  );

DROP POLICY IF EXISTS memory_answers_update_author_or_editor ON public.memory_answers;
CREATE POLICY memory_answers_update_author_or_editor ON public.memory_answers
  FOR UPDATE TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.memory_questions AS mq
      JOIN public.albums AS a ON a.id = mq.album_id
      WHERE mq.id = question_id
        AND (
          public.get_active_album_role(a.id, auth.uid()) IN ('owner', 'editor')
          OR public.is_active_family_manager(a.family_id)
        )
    )
  )
  WITH CHECK (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.memory_questions AS mq
      JOIN public.albums AS a ON a.id = mq.album_id
      WHERE mq.id = question_id
        AND (
          public.get_active_album_role(a.id, auth.uid()) IN ('owner', 'editor')
          OR public.is_active_family_manager(a.family_id)
        )
    )
  );

COMMIT;
