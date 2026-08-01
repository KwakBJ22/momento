-- Participation design §1: the backend, not the frontend URL pattern, decides a
-- share link's permissions. 'contribute' links may add photos + per-photo memories;
-- 'view' links are read-only (reactions/guestbook come in a later step).
BEGIN;

ALTER TABLE public.share_links
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'contribute'
  CHECK (kind IN ('view', 'contribute'));

-- Existing links have already been sent (e.g. via KakaoTalk) and were used for
-- contribution. Backfill them to 'contribute' so none of them break.
UPDATE public.share_links SET kind = 'contribute' WHERE kind IS NULL;

COMMIT;
