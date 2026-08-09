-- 새 계정의 기본 표시 이름을 `우리앨범 사용자` 로 (K-1-a).
--
-- 닉네임·이름·이메일 앞부분이 전부 없을 때만 쓰이는 마지막 대비값이다.
-- 이 이름이 네 개 migration 에 흩어져 있었다(20260712160000 · 20260712170000 ·
-- 20260727090000 · 그리고 롤백 파일 하나).
-- ★ 옛 파일은 고치지 않는다. **이력이라 그대로 둔다** — 이미 실행된 migration 을
--   나중에 바꾸면 기록이 사실과 달라진다. 새 정의로 **덮는다.**
--
-- 함수 본문은 20260727090000_social_auth_profiles.sql 의 것 그대로이고,
-- 마지막 대비값 한 줄만 다르다.
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
      '우리앨범 사용자'
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

-- 이미 그 이름으로 만들어진 계정이 있으면 함께 옮긴다.
-- (지금은 0건이라 아무 행도 바뀌지 않는다 — 나중에 이 migration 만 다시 돌려도 안전하다.)
UPDATE public.profiles
SET display_name = '우리앨범 사용자'
WHERE display_name = 'Momento 사용자';

COMMIT;
