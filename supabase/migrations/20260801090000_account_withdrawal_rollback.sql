-- Rollback for 20260801090000_account_withdrawal.sql.
--
-- Restoring NOT NULL fails if any withdrawal already ran and left NULL rows.
-- Those rows are memories that belong to albums whose owners are still active,
-- so they are backfilled to a placeholder profile rather than deleted.  Set
-- `momento.withdrawn_placeholder_profile_id` to an existing profile id before
-- running this, or the backfill is skipped and NOT NULL is left off.

BEGIN;

DROP FUNCTION IF EXISTS public.delete_profile_cascade(uuid);

ALTER TABLE public.families DROP CONSTRAINT IF EXISTS families_created_by_fkey;
ALTER TABLE public.families
  ADD CONSTRAINT families_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.share_links DROP CONSTRAINT IF EXISTS share_links_created_by_fkey;
ALTER TABLE public.share_links
  ADD CONSTRAINT share_links_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.memory_answers DROP CONSTRAINT IF EXISTS memory_answers_profile_id_fkey;
ALTER TABLE public.memory_answers
  ADD CONSTRAINT memory_answers_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.album_story_inputs DROP CONSTRAINT IF EXISTS album_story_inputs_author_profile_id_fkey;
ALTER TABLE public.album_story_inputs
  ADD CONSTRAINT album_story_inputs_author_profile_id_fkey
  FOREIGN KEY (author_profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

DO $$
DECLARE
  v_placeholder uuid := nullif(current_setting('momento.withdrawn_placeholder_profile_id', true), '')::uuid;
BEGIN
  IF v_placeholder IS NULL THEN
    RAISE NOTICE 'momento.withdrawn_placeholder_profile_id is not set; NOT NULL is left off.';
    RETURN;
  END IF;

  UPDATE public.album_story_inputs SET author_profile_id = v_placeholder WHERE author_profile_id IS NULL;
  UPDATE public.memory_answers SET profile_id = v_placeholder WHERE profile_id IS NULL;
  UPDATE public.share_links SET created_by = v_placeholder WHERE created_by IS NULL;
  UPDATE public.families SET created_by = v_placeholder WHERE created_by IS NULL;

  ALTER TABLE public.album_story_inputs ALTER COLUMN author_profile_id SET NOT NULL;
  ALTER TABLE public.memory_answers ALTER COLUMN profile_id SET NOT NULL;
  ALTER TABLE public.share_links ALTER COLUMN created_by SET NOT NULL;
  ALTER TABLE public.families ALTER COLUMN created_by SET NOT NULL;
END;
$$;

COMMIT;
