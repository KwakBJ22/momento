-- Momento DB core migration (phase 1)
--
-- This migration is additive. It deliberately preserves public.albums rows,
-- legacy owner_id, public album reads, and the existing `albums` Storage bucket.
-- Run through the Supabase migration workflow; do not paste blindly into production.

BEGIN;

-- DATABASE_PLAN.md recommends text + CHECK rather than PostgreSQL enums so that
-- future role/status additions do not require enum alteration deployments.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  avatar_path text,
  locale text NOT NULL DEFAULT 'ko-KR',
  timezone text NOT NULL DEFAULT 'Asia/Seoul',
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT profiles_status_check CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT families_status_check CHECK (status IN ('active', 'archived', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'member'
    CONSTRAINT family_members_role_check CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT family_members_status_check CHECK (status IN ('invited', 'active', 'left', 'removed')),
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT family_members_family_profile_key UNIQUE (family_id, profile_id),
  CONSTRAINT family_members_membership_dates_check CHECK (
    (status = 'active' AND joined_at IS NOT NULL AND left_at IS NULL)
    OR (status = 'invited' AND joined_at IS NULL AND left_at IS NULL)
    OR (status IN ('left', 'removed') AND left_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS families_slug_active_key
  ON public.families (slug)
  WHERE slug IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS families_created_by_status_idx
  ON public.families (created_by, status);
CREATE INDEX IF NOT EXISTS family_members_profile_status_idx
  ON public.family_members (profile_id, status);
CREATE INDEX IF NOT EXISTS family_members_family_role_status_idx
  ON public.family_members (family_id, role, status);
CREATE UNIQUE INDEX IF NOT EXISTS family_members_one_active_owner_idx
  ON public.family_members (family_id)
  WHERE role = 'owner' AND status = 'active';

-- Keep all new ownership fields nullable in this phase: legacy albums continue
-- to authorize with owner_id until an explicit family transfer is implemented.
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS event_at date;
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'family';
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS legacy_migrated_at timestamptz;

ALTER TABLE public.albums DROP CONSTRAINT IF EXISTS albums_family_id_fkey;
ALTER TABLE public.albums ADD CONSTRAINT albums_family_id_fkey
  FOREIGN KEY (family_id) REFERENCES public.families(id) ON DELETE RESTRICT;
ALTER TABLE public.albums DROP CONSTRAINT IF EXISTS albums_created_by_fkey;
ALTER TABLE public.albums ADD CONSTRAINT albums_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.albums DROP CONSTRAINT IF EXISTS albums_status_check;
ALTER TABLE public.albums ADD CONSTRAINT albums_status_check
  CHECK (status IN ('draft', 'processing', 'active', 'archived', 'deleted', 'failed'));
ALTER TABLE public.albums DROP CONSTRAINT IF EXISTS albums_visibility_check;
ALTER TABLE public.albums ADD CONSTRAINT albums_visibility_check
  CHECK (visibility IN ('private', 'family'));

CREATE INDEX IF NOT EXISTS albums_family_status_event_created_idx
  ON public.albums (family_id, status, event_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS albums_created_by_status_created_idx
  ON public.albums (created_by, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS albums_owner_id_idx ON public.albums (owner_id);

-- Shared timestamp trigger, scoped to tables introduced by this migration.
CREATE OR REPLACE FUNCTION public.set_db_core_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();
DROP TRIGGER IF EXISTS families_set_updated_at ON public.families;
CREATE TRIGGER families_set_updated_at
  BEFORE UPDATE ON public.families
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();
DROP TRIGGER IF EXISTS family_members_set_updated_at ON public.family_members;
CREATE TRIGGER family_members_set_updated_at
  BEFORE UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();
DROP TRIGGER IF EXISTS albums_set_updated_at ON public.albums;
CREATE TRIGGER albums_set_updated_at
  BEFORE UPDATE ON public.albums
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();

-- New Auth users receive a profile. User metadata is only used for an initial
-- display name; it is never used as an authorization source.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'Momento 사용자'
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user_profile();

-- Compatibility backfill: only create profiles and copy a legacy owner into
-- created_by when the matching Auth user exists. No album is assigned to a
-- family, no path is moved, and no legacy owner_id is changed.
INSERT INTO public.profiles (id, display_name, created_at, updated_at)
SELECT
  u.id,
  COALESCE(
    NULLIF(u.raw_user_meta_data ->> 'display_name', ''),
    NULLIF(u.raw_user_meta_data ->> 'name', ''),
    NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
    'Momento 사용자'
  ),
  now(),
  now()
FROM auth.users AS u
ON CONFLICT (id) DO NOTHING;

UPDATE public.albums AS a
SET created_by = a.owner_id,
    updated_at = COALESCE(a.updated_at, a.created_at)
WHERE a.owner_id IS NOT NULL
  AND a.created_by IS NULL
  AND EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.id = a.owner_id);

UPDATE public.albums
SET updated_at = created_at
WHERE updated_at IS NULL;

-- Basic RLS for the new family domain. The existing public SELECT policy on
-- public.albums intentionally remains untouched for legacy shared URLs.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_active_family_member(target_family_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_members AS fm
    WHERE fm.family_id = target_family_id
      AND fm.profile_id = auth.uid()
      AND fm.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_family_manager(target_family_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_members AS fm
    WHERE fm.family_id = target_family_id
      AND fm.profile_id = auth.uid()
      AND fm.status = 'active'
      AND fm.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.shares_active_family_with(target_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_members AS mine
    JOIN public.family_members AS theirs ON theirs.family_id = mine.family_id
    WHERE mine.profile_id = auth.uid()
      AND mine.status = 'active'
      AND theirs.profile_id = target_profile_id
      AND theirs.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_family_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_family_manager(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_active_family_with(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_family_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_family_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_active_family_with(uuid) TO authenticated;

DROP POLICY IF EXISTS profiles_select_self_or_family ON public.profiles;
CREATE POLICY profiles_select_self_or_family ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_active_family_with(id));
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- RLS decides which row a user can touch; column privileges keep account state
-- and audit timestamps server-managed even if direct profile editing is added.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (display_name, avatar_path, locale, timezone) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS families_select_member ON public.families;
CREATE POLICY families_select_member ON public.families
  FOR SELECT TO authenticated
  USING (public.is_active_family_member(id));
DROP POLICY IF EXISTS families_insert_creator ON public.families;
CREATE POLICY families_insert_creator ON public.families
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
DROP POLICY IF EXISTS families_update_owner ON public.families;
CREATE POLICY families_update_owner ON public.families
  FOR UPDATE TO authenticated
  USING (public.is_active_family_manager(id))
  WITH CHECK (public.is_active_family_manager(id));

DROP POLICY IF EXISTS family_members_select_member ON public.family_members;
CREATE POLICY family_members_select_member ON public.family_members
  FOR SELECT TO authenticated
  USING (public.is_active_family_member(family_id));
DROP POLICY IF EXISTS family_members_insert_owner_or_manager ON public.family_members;
CREATE POLICY family_members_insert_owner_or_manager ON public.family_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_family_manager(family_id)
    OR (
      profile_id = auth.uid()
      AND role = 'owner'
      AND status = 'active'
      AND joined_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.families AS f
        WHERE f.id = family_id AND f.created_by = auth.uid()
      )
    )
  );
DROP POLICY IF EXISTS family_members_update_owner_or_manager ON public.family_members;
CREATE POLICY family_members_update_owner_or_manager ON public.family_members
  FOR UPDATE TO authenticated
  USING (public.is_active_family_manager(family_id))
  WITH CHECK (public.is_active_family_manager(family_id));

COMMIT;
