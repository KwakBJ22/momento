-- 이용자가 **직접 입력하는** 연락처(선택). 계정을 잃었을 때 본인 확인에만 쓴다.
--
-- ★ 기존 profiles.email / profiles.phone 을 재사용하지 않는다.
--   그 두 컬럼은 트리거 handle_new_auth_user_profile 이 auth.users 에서 자동으로
--   채우는 값(카카오·매직링크가 준 값)이다. 본인이 넣은 값과 섞이면 어느 쪽인지
--   구분할 수 없고, "본인 확인용"이라는 근거가 무너진다. 그래서 컬럼을 나눈다.
--     profiles.email / phone          → 로그인 제공자에게 받은 값
--     profiles.contact_* (이 마이그레이션) → 이용자가 직접 넣은 값
--
-- ★ 이 컬럼은 알림·마케팅 발송에 쓰지 않는다(개인정보처리방침 1.2 에 그렇게 적었다).
--   나중에 알림톡을 붙이더라도 이 컬럼을 읽지 않는다.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text;

-- 형식만 다듬어 저장한다(전화는 숫자만). 인증(문자·메일)은 하지 않으므로
-- 길이 상한만 둔다 — 값의 진위는 보증하지 않는다.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_contact_phone_digits
    CHECK (contact_phone IS NULL OR contact_phone ~ '^[0-9]{9,11}$'),
  ADD CONSTRAINT profiles_contact_email_length
    CHECK (contact_email IS NULL OR char_length(contact_email) BETWEEN 5 AND 254);

COMMENT ON COLUMN public.profiles.contact_phone IS
  '이용자가 직접 입력한 연락처(숫자만). 계정 분실 시 본인 확인 전용 — 알림·마케팅 발송에 쓰지 않는다.';
COMMENT ON COLUMN public.profiles.contact_email IS
  '이용자가 직접 입력한 연락처. 계정 분실 시 본인 확인 전용 — 알림·마케팅 발송에 쓰지 않는다.';

COMMIT;
