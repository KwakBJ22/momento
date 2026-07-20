-- Collaborative album MVP: invites, contributors, photo_memories, album build cache.
-- Extends albums + album_photos; does not replace existing share_links/guest flows.

BEGIN;

-- ---------------------------------------------------------------------------
-- albums collaboration / build cache columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.albums
  ADD COLUMN IF NOT EXISTS collaboration_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collaboration_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS invite_token_hash text,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS dirty boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_built_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS photo_limit integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS contributor_limit integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS album_json jsonb,
  ADD COLUMN IF NOT EXISTS album_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_cache jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_rebuild_started_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'albums_collaboration_status_check'
  ) THEN
    ALTER TABLE public.albums
      ADD CONSTRAINT albums_collaboration_status_check
      CHECK (collaboration_status IN ('draft', 'collecting', 'ready', 'published', 'closed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS albums_invite_token_hash_idx
  ON public.albums (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS albums_dirty_idx
  ON public.albums (dirty)
  WHERE dirty = true;

-- ---------------------------------------------------------------------------
-- album_invites
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.album_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at timestamptz,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT album_invites_token_hash_key UNIQUE (token_hash),
  CONSTRAINT album_invites_max_uses_check CHECK (max_uses IS NULL OR max_uses > 0),
  CONSTRAINT album_invites_use_count_check CHECK (use_count >= 0)
);

CREATE INDEX IF NOT EXISTS album_invites_album_active_idx
  ON public.album_invites (album_id, is_active, created_at DESC);

ALTER TABLE public.album_invites ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- album_contributors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.album_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  guest_id uuid,
  display_name text NOT NULL,
  relationship text,
  role text NOT NULL DEFAULT 'contributor',
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  CONSTRAINT album_contributors_display_name_len CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 40),
  CONSTRAINT album_contributors_role_check CHECK (role IN ('owner', 'contributor', 'viewer')),
  CONSTRAINT album_contributors_status_check CHECK (status IN ('active', 'removed', 'blocked')),
  CONSTRAINT album_contributors_identity_check CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS album_contributors_album_user_uidx
  ON public.album_contributors (album_id, user_id)
  WHERE user_id IS NOT NULL AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS album_contributors_album_guest_uidx
  ON public.album_contributors (album_id, guest_id)
  WHERE guest_id IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS album_contributors_album_status_idx
  ON public.album_contributors (album_id, status, joined_at);

ALTER TABLE public.album_contributors ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- album_photos: contributor upload link
-- ---------------------------------------------------------------------------
ALTER TABLE public.album_photos
  ADD COLUMN IF NOT EXISTS uploaded_by_contributor_id uuid REFERENCES public.album_contributors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS album_photos_contributor_upload_idx
  ON public.album_photos (uploaded_by_contributor_id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- photo_memories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.photo_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  photo_id uuid NOT NULL REFERENCES public.album_photos(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  contributor_id uuid NOT NULL REFERENCES public.album_contributors(id) ON DELETE RESTRICT,
  author_name text NOT NULL,
  relationship text,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT photo_memories_comment_len CHECK (char_length(comment) BETWEEN 1 AND 500),
  CONSTRAINT photo_memories_author_name_len CHECK (char_length(btrim(author_name)) BETWEEN 1 AND 40)
);

CREATE INDEX IF NOT EXISTS photo_memories_photo_created_idx
  ON public.photo_memories (photo_id, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS photo_memories_album_created_idx
  ON public.photo_memories (album_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS photo_memories_contributor_idx
  ON public.photo_memories (contributor_id, created_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS photo_memories_set_updated_at ON public.photo_memories;
CREATE TRIGGER photo_memories_set_updated_at
  BEFORE UPDATE ON public.photo_memories
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();

ALTER TABLE public.photo_memories ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Legacy comment → photo_memories (owner contributor)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  photo_rec record;
  owner_contributor_id uuid;
  owner_name text;
  memo_text text;
  owner_profile uuid;
BEGIN
  FOR photo_rec IN
    SELECT p.id, p.album_id, p.comment, p.caption, p.legacy_author_label, p.created_at,
           a.created_by AS album_owner_id, a.owner_id AS legacy_owner_id
    FROM public.album_photos p
    JOIN public.albums a ON a.id = p.album_id
    WHERE p.deleted_at IS NULL
      AND NULLIF(btrim(COALESCE(p.comment, p.caption)), '') IS NOT NULL
  LOOP
    memo_text := NULLIF(btrim(COALESCE(photo_rec.comment, photo_rec.caption)), '');
    IF memo_text IS NULL THEN
      CONTINUE;
    END IF;

    owner_profile := COALESCE(photo_rec.album_owner_id, photo_rec.legacy_owner_id);
    IF owner_profile IS NULL THEN
      CONTINUE;
    END IF;

    SELECT c.id INTO owner_contributor_id
    FROM public.album_contributors c
    WHERE c.album_id = photo_rec.album_id
      AND c.user_id = owner_profile
      AND c.status = 'active'
    LIMIT 1;

    IF owner_contributor_id IS NULL THEN
      SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), '앨범 주인')
        INTO owner_name
      FROM public.profiles pr
      WHERE pr.id = owner_profile
      LIMIT 1;

      INSERT INTO public.album_contributors (
        album_id, user_id, display_name, role, status
      ) VALUES (
        photo_rec.album_id,
        owner_profile,
        COALESCE(owner_name, '앨범 주인'),
        'owner',
        'active'
      )
      RETURNING id INTO owner_contributor_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.photo_memories m
      WHERE m.photo_id = photo_rec.id
        AND m.deleted_at IS NULL
        AND m.comment = memo_text
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.photo_memories (
      album_id, photo_id, author_id, contributor_id, author_name, comment, created_at
    ) VALUES (
      photo_rec.album_id,
      photo_rec.id,
      owner_profile,
      owner_contributor_id,
      COALESCE(
        NULLIF(btrim(photo_rec.legacy_author_label), ''),
        (SELECT COALESCE(NULLIF(btrim(pr.display_name), ''), '기록') FROM public.profiles pr WHERE pr.id = owner_profile LIMIT 1),
        '기록'
      ),
      left(memo_text, 500),
      COALESCE(photo_rec.created_at, now())
    );
  END LOOP;
END $$;

COMMIT;
