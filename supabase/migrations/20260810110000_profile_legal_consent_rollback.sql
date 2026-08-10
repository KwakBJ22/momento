-- K-14 되돌리기.
--
-- ★ 되돌리면 **받아 둔 동의 기록이 사라진다.** 그것이 이 두 칸의 존재 이유이므로,
--   되돌리기 전에 값을 어딘가로 옮겨 둘지 사람이 판단해야 한다.
--   (예: `select id, legal_agreed_at, legal_agreed_version from public.profiles
--         where legal_agreed_at is not null;` 을 먼저 내려받는다.)
-- ★ 되돌린 뒤에는 모든 사용자가 다음 로그인 때 다시 동의를 받게 된다.
BEGIN;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS legal_agreed_version,
  DROP COLUMN IF EXISTS legal_agreed_at;

COMMIT;
