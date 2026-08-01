-- Participation design §2: reactions aggregate per ALBUM, not per (re-issuable)
-- share link, so rotating a link never fragments popularity counts. Reaction codes
-- move to the confirmed 3-set. share_reactions is empty (0 rows) so no backfill.
BEGIN;

-- remember -> love, warm -> moved, smile kept.
ALTER TABLE public.share_reactions DROP CONSTRAINT IF EXISTS share_reactions_reaction_check;
ALTER TABLE public.share_reactions
  ADD CONSTRAINT share_reactions_reaction_check CHECK (reaction IN ('love', 'moved', 'smile'));

-- album_id: the reaction's real owner. ON DELETE CASCADE keeps album deletion working.
ALTER TABLE public.share_reactions ADD COLUMN IF NOT EXISTS album_id uuid;
ALTER TABLE public.share_reactions ALTER COLUMN album_id SET NOT NULL;
ALTER TABLE public.share_reactions DROP CONSTRAINT IF EXISTS share_reactions_album_id_fkey;
ALTER TABLE public.share_reactions
  ADD CONSTRAINT share_reactions_album_id_fkey
  FOREIGN KEY (album_id) REFERENCES public.albums(id) ON DELETE CASCADE;

-- share_link_id is kept only as an optional acquisition-path record.
ALTER TABLE public.share_reactions ALTER COLUMN share_link_id DROP NOT NULL;
ALTER TABLE public.share_reactions DROP CONSTRAINT IF EXISTS share_reactions_share_link_id_fkey;
ALTER TABLE public.share_reactions
  ADD CONSTRAINT share_reactions_share_link_id_fkey
  FOREIGN KEY (share_link_id) REFERENCES public.share_links(id) ON DELETE SET NULL;

-- One reaction per (album, session, reaction) — dedupe survives link rotation.
ALTER TABLE public.share_reactions DROP CONSTRAINT IF EXISTS share_reactions_one_per_session;
ALTER TABLE public.share_reactions DROP CONSTRAINT IF EXISTS share_reactions_one_per_album_session;
ALTER TABLE public.share_reactions
  ADD CONSTRAINT share_reactions_one_per_album_session UNIQUE (album_id, session_hash, reaction);

CREATE INDEX IF NOT EXISTS share_reactions_album_reaction_idx
  ON public.share_reactions (album_id, reaction);

COMMIT;
