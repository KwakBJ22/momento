-- Rollback for 20260801110000_share_reactions_album.sql. Emergency use only.
-- Safe only while share_reactions is effectively empty.
BEGIN;

ALTER TABLE public.share_reactions DROP CONSTRAINT IF EXISTS share_reactions_one_per_album_session;
DROP INDEX IF EXISTS public.share_reactions_album_reaction_idx;
ALTER TABLE public.share_reactions DROP CONSTRAINT IF EXISTS share_reactions_album_id_fkey;
ALTER TABLE public.share_reactions DROP COLUMN IF EXISTS album_id;

ALTER TABLE public.share_reactions DROP CONSTRAINT IF EXISTS share_reactions_share_link_id_fkey;
ALTER TABLE public.share_reactions ALTER COLUMN share_link_id SET NOT NULL;
ALTER TABLE public.share_reactions
  ADD CONSTRAINT share_reactions_share_link_id_fkey
  FOREIGN KEY (share_link_id) REFERENCES public.share_links(id) ON DELETE RESTRICT;

ALTER TABLE public.share_reactions DROP CONSTRAINT IF EXISTS share_reactions_reaction_check;
ALTER TABLE public.share_reactions
  ADD CONSTRAINT share_reactions_reaction_check CHECK (reaction IN ('remember', 'warm', 'smile'));
ALTER TABLE public.share_reactions
  ADD CONSTRAINT share_reactions_one_per_session UNIQUE (share_link_id, session_hash, reaction);

COMMIT;
