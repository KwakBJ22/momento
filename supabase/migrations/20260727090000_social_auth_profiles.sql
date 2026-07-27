-- Social-auth profile fields. This migration is additive and does not alter
-- existing albums, public shares, or collaboration guest sessions.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS primary_provider text;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, display_name, avatar_url, email, phone, primary_provider
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'nickname', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'Momento 사용자'
    ),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'avatar_url', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'picture', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'profile_image', '')
    ),
    NULLIF(NEW.email, ''),
    NULLIF(NEW.phone, ''),
    NULLIF(NEW.raw_app_meta_data ->> 'provider', '')
  )
  ON CONFLICT (id) DO NOTHING;

  PERFORM public.ensure_default_family(NEW.id);
  RETURN NEW;
END;
$$;

-- Existing profiles keep user-selected display_name/avatar_url. Only nullable
-- contact/provider fields receive a one-time social-auth initial value.
UPDATE public.profiles AS profile
SET
  email = COALESCE(profile.email, NULLIF(auth_user.email, '')),
  phone = COALESCE(profile.phone, NULLIF(auth_user.phone, '')),
  primary_provider = COALESCE(profile.primary_provider, NULLIF(auth_user.raw_app_meta_data ->> 'provider', '')),
  avatar_url = COALESCE(
    profile.avatar_url,
    NULLIF(auth_user.raw_user_meta_data ->> 'avatar_url', ''),
    NULLIF(auth_user.raw_user_meta_data ->> 'picture', ''),
    NULLIF(auth_user.raw_user_meta_data ->> 'profile_image', '')
  )
FROM auth.users AS auth_user
WHERE profile.id = auth_user.id
  AND (
    profile.email IS NULL
    OR profile.phone IS NULL
    OR profile.primary_provider IS NULL
    OR profile.avatar_url IS NULL
  );

COMMIT;
