-- Auth + family ownership sprint
-- Depends on 20260712160000_db_core_migration.sql.
-- This is additive and does not alter legacy public album reads or Storage.

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_default_family(target_profile_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_family_id uuid;
  profile_name text;
BEGIN
  SELECT id INTO default_family_id
  FROM public.families
  WHERE created_by = target_profile_id
    AND status = 'active'
    AND deleted_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF default_family_id IS NULL THEN
    SELECT display_name INTO profile_name
    FROM public.profiles
    WHERE id = target_profile_id
      AND status = 'active'
      AND deleted_at IS NULL;

    IF profile_name IS NULL THEN
      RAISE EXCEPTION 'Active profile % does not exist', target_profile_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    INSERT INTO public.families (name, created_by)
    VALUES (profile_name || '의 가족', target_profile_id)
    RETURNING id INTO default_family_id;
  END IF;

  INSERT INTO public.family_members (family_id, profile_id, role, status, joined_at)
  VALUES (default_family_id, target_profile_id, 'owner', 'active', now())
  ON CONFLICT (family_id, profile_id) DO UPDATE
  SET role = CASE
        WHEN public.family_members.role = 'owner' THEN 'owner'
        ELSE public.family_members.role
      END,
      status = 'active',
      joined_at = COALESCE(public.family_members.joined_at, now()),
      left_at = NULL;

  RETURN default_family_id;
END;
$$;

-- The phase-1 profile trigger already creates profiles. Extend it so new Auth
-- users receive a family and an owner membership in the same transaction.
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

  PERFORM public.ensure_default_family(NEW.id);
  RETURN NEW;
END;
$$;

-- Existing Auth users get a family only when they do not have an active one.
-- Legacy albums remain family_id NULL until a separate explicit transfer flow.
DO $$
DECLARE
  profile_record record;
BEGIN
  FOR profile_record IN
    SELECT p.id
    FROM public.profiles AS p
    WHERE p.status = 'active'
      AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.family_members AS fm
        WHERE fm.profile_id = p.id
          AND fm.status = 'active'
      )
  LOOP
    PERFORM public.ensure_default_family(profile_record.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_family(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_default_family(uuid) TO service_role;

COMMIT;
