-- Rollback for 20260808100000_profile_contact.sql.
-- ★ 컬럼을 지우면 이용자가 직접 넣은 연락처가 사라진다. 되돌릴 때는 그 사실을 알고 실행할 것.
BEGIN;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_contact_phone_digits,
  DROP CONSTRAINT IF EXISTS profiles_contact_email_length;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS contact_email;

COMMIT;
