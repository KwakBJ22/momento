-- Security hardening for guest ownership claims and generated album assets.
BEGIN;

-- A claim changes three ownership records.  Lock the one-time guest session so
-- concurrent claims cannot race, and make retries by its successful owner
-- idempotent.
CREATE OR REPLACE FUNCTION public.claim_guest_album_ownership(
  p_token_hash text,
  p_profile_id uuid,
  p_family_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.guest_album_sessions%ROWTYPE;
  v_album public.albums%ROWTYPE;
BEGIN
  SELECT * INTO v_session
  FROM public.guest_album_sessions
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'guest ownership token not found';
  END IF;

  IF v_session.status = 'claimed' THEN
    IF v_session.claimed_profile_id = p_profile_id THEN
      RETURN v_session.album_id;
    END IF;
    RAISE EXCEPTION 'guest album already claimed by another user';
  END IF;

  IF v_session.status <> 'active' OR v_session.expires_at <= now() THEN
    IF v_session.status = 'active' THEN
      UPDATE public.guest_album_sessions SET status = 'expired' WHERE id = v_session.id;
    END IF;
    RAISE EXCEPTION 'guest ownership token expired';
  END IF;

  SELECT * INTO v_album FROM public.albums WHERE id = v_session.album_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'guest album not found';
  END IF;
  IF (v_album.owner_id IS NOT NULL AND v_album.owner_id <> p_profile_id)
     OR (v_album.created_by IS NOT NULL AND v_album.created_by <> p_profile_id) THEN
    RAISE EXCEPTION 'guest album already claimed by another user';
  END IF;

  UPDATE public.albums
  SET owner_id = p_profile_id,
      created_by = p_profile_id,
      family_id = p_family_id,
      updated_at = now()
  WHERE id = v_session.album_id;

  INSERT INTO public.album_members (album_id, profile_id, role, status, invited_by)
  VALUES (v_session.album_id, p_profile_id, 'owner', 'active', p_profile_id)
  ON CONFLICT (album_id, profile_id) DO UPDATE
  SET role = 'owner', status = 'active', removed_at = NULL, invited_by = EXCLUDED.invited_by;

  UPDATE public.guest_album_sessions
  SET status = 'claimed', claimed_profile_id = p_profile_id, claimed_at = now()
  WHERE id = v_session.id;

  RETURN v_session.album_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_album_ownership(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_guest_album_ownership(text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_guest_album_ownership(text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_album_ownership(text, uuid, uuid) TO service_role;

-- Generated result/PDF objects are paths, not public capability URLs.  New
-- code signs these paths after owner or active-public-link authorization.
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS result_bucket text;
UPDATE public.albums
SET result_bucket = 'albums'
WHERE result_path IS NOT NULL AND result_bucket IS NULL;

-- Existing objects remain readable through signed URLs once the backend is
-- deployed.  This removes predictable public-object access for old and new
-- generated assets alike.
UPDATE storage.buckets SET public = false WHERE id = 'albums';

COMMIT;
