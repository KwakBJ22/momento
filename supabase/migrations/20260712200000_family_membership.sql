-- Sprint 3: family invitations, album_members, extended roles, RLS.
-- Additive only. Legacy public album reads remain unchanged.

BEGIN;

ALTER TABLE public.family_members DROP CONSTRAINT IF EXISTS family_members_role_check;
ALTER TABLE public.family_members ADD CONSTRAINT family_members_role_check
  CHECK (role IN ('owner', 'admin', 'member', 'viewer'));

CREATE TABLE IF NOT EXISTS public.family_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE RESTRICT,
  inviter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  invitee_email text NOT NULL,
  token_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member'
    CONSTRAINT family_invitations_role_check CHECK (role IN ('admin', 'member', 'viewer')),
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT family_invitations_status_check CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT family_invitations_invitee_email_trimmed CHECK (invitee_email = lower(trim(invitee_email)))
);

CREATE UNIQUE INDEX IF NOT EXISTS family_invitations_token_hash_key
  ON public.family_invitations (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS family_invitations_pending_email_key
  ON public.family_invitations (family_id, invitee_email)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS family_invitations_family_status_idx
  ON public.family_invitations (family_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.album_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'viewer'
    CONSTRAINT album_members_role_check CHECK (role IN ('owner', 'editor', 'contributor', 'viewer')),
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT album_members_status_check CHECK (status IN ('active', 'removed')),
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CONSTRAINT album_members_album_profile_key UNIQUE (album_id, profile_id)
);

CREATE INDEX IF NOT EXISTS album_members_profile_status_idx
  ON public.album_members (profile_id, status);
CREATE INDEX IF NOT EXISTS album_members_album_role_status_idx
  ON public.album_members (album_id, role, status);

DROP TRIGGER IF EXISTS album_members_set_updated_at ON public.album_members;
CREATE TRIGGER album_members_set_updated_at
  BEFORE UPDATE ON public.album_members
  FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();

INSERT INTO public.album_members (album_id, profile_id, role, status, invited_by, created_at)
SELECT
  a.id,
  COALESCE(a.created_by, a.owner_id),
  'owner',
  'active',
  COALESCE(a.created_by, a.owner_id),
  COALESCE(a.created_at, now())
FROM public.albums AS a
WHERE a.family_id IS NOT NULL
  AND COALESCE(a.created_by, a.owner_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.album_members AS am
    WHERE am.album_id = a.id AND am.profile_id = COALESCE(a.created_by, a.owner_id)
  )
ON CONFLICT (album_id, profile_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_active_family_role(target_family_id uuid, target_profile_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fm.role
  FROM public.family_members AS fm
  WHERE fm.family_id = target_family_id
    AND fm.profile_id = target_profile_id
    AND fm.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_active_album_role(target_album_id uuid, target_profile_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT am.role
  FROM public.album_members AS am
  WHERE am.album_id = target_album_id
    AND am.profile_id = target_profile_id
    AND am.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_family_invitation(
  p_token_hash text,
  p_profile_id uuid,
  p_profile_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  invitation_record public.family_invitations%ROWTYPE;
  normalized_email text;
BEGIN
  normalized_email := lower(trim(p_profile_email));
  IF normalized_email IS NULL OR normalized_email = '' THEN
    RAISE EXCEPTION 'Authenticated user email is required to accept an invitation'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  SELECT * INTO invitation_record
  FROM public.family_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF invitation_record.status = 'accepted' THEN
    RAISE EXCEPTION 'Invitation has already been accepted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF invitation_record.status IN ('revoked', 'expired') THEN
    RAISE EXCEPTION 'Invitation is no longer valid'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF invitation_record.expires_at <= now() THEN
    UPDATE public.family_invitations
    SET status = 'expired'
    WHERE id = invitation_record.id;
    RAISE EXCEPTION 'Invitation has expired'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF invitation_record.invitee_email <> normalized_email THEN
    RAISE EXCEPTION 'Invitation email does not match the signed-in user'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.family_members AS fm
    WHERE fm.family_id = invitation_record.family_id
      AND fm.profile_id = p_profile_id
      AND fm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'User is already an active family member'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  INSERT INTO public.family_members (
    family_id, profile_id, role, status, invited_by, joined_at
  )
  VALUES (
    invitation_record.family_id,
    p_profile_id,
    invitation_record.role,
    'active',
    invitation_record.inviter_id,
    now()
  )
  ON CONFLICT (family_id, profile_id) DO UPDATE
  SET role = EXCLUDED.role,
      status = 'active',
      invited_by = EXCLUDED.invited_by,
      joined_at = COALESCE(public.family_members.joined_at, now()),
      left_at = NULL,
      updated_at = now();

  UPDATE public.family_invitations
  SET status = 'accepted',
      accepted_at = now()
  WHERE id = invitation_record.id;

  RETURN invitation_record.family_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_family_role(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_album_role(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_family_invitation(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_family_role(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_album_role(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_family_invitation(text, uuid, text) TO service_role;

ALTER TABLE public.family_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.album_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS family_invitations_select_manager ON public.family_invitations;
CREATE POLICY family_invitations_select_manager ON public.family_invitations
  FOR SELECT TO authenticated
  USING (public.is_active_family_manager(family_id));

DROP POLICY IF EXISTS family_invitations_insert_manager ON public.family_invitations;
CREATE POLICY family_invitations_insert_manager ON public.family_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_family_manager(family_id)
    AND inviter_id = auth.uid()
  );

DROP POLICY IF EXISTS family_invitations_update_manager ON public.family_invitations;
CREATE POLICY family_invitations_update_manager ON public.family_invitations
  FOR UPDATE TO authenticated
  USING (public.is_active_family_manager(family_id))
  WITH CHECK (public.is_active_family_manager(family_id));

DROP POLICY IF EXISTS album_members_select_access ON public.album_members;
CREATE POLICY album_members_select_access ON public.album_members
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

DROP POLICY IF EXISTS album_members_insert_manager ON public.album_members;
CREATE POLICY album_members_insert_manager ON public.album_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.albums AS a
      WHERE a.id = album_id
        AND (
          public.get_active_album_role(a.id, auth.uid()) IN ('owner', 'editor')
          OR public.is_active_family_manager(a.family_id)
        )
    )
  );

DROP POLICY IF EXISTS album_members_update_manager ON public.album_members;
CREATE POLICY album_members_update_manager ON public.album_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.albums AS a
      WHERE a.id = album_id
        AND (
          public.get_active_album_role(a.id, auth.uid()) IN ('owner', 'editor')
          OR public.is_active_family_manager(a.family_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.albums AS a
      WHERE a.id = album_id
        AND (
          public.get_active_album_role(a.id, auth.uid()) IN ('owner', 'editor')
          OR public.is_active_family_manager(a.family_id)
        )
    )
  );

COMMIT;
