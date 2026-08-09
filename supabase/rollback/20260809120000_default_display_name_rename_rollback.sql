-- K-1-a 되돌리기 — 기본 표시 이름을 옛 값으로 되돌린다.
--
-- 20260727090000_social_auth_profiles.sql 의 함수 본문 그대로다.
-- ★ 이름을 되돌려도 이미 그 이름으로 만들어진 계정은 건드리지 않는다 —
--   그 사람이 쓰던 이름을 말없이 바꾸지 않는다.
BEGIN;

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

COMMIT;
