-- 약관 동의를 **남긴다** (K-14 · SCREEN_SPEC §11).
--
-- 지금까지는 로그인할 때마다 체크를 새로 받으면서 **한 번도 기록하지 않았다.**
-- 그래서 두 가지가 동시에 잘못돼 있었다:
--   · 이미 동의한 사람인지 알 방법이 없어 매번 처음처럼 물었다
--     (PO 실기기 소감 — *"솔직히 계속 회원가입하는 꼴"*)
--   · 언제·어떤 문서에 동의했는지가 어디에도 없어, 나중에 다툼이 생기면
--     "받았다" 를 보일 근거가 없다
--
-- ★ **새 테이블을 만들지 않는다.** 사람마다 한 벌이면 되는 값이라 `profiles` 두 칸이다.
-- ★ 버전은 **날짜 문자열 하나**다(`2026-08-09` 식). 버전 체계를 새로 만들지 않는다.
--   문서가 바뀌면 그 날짜를 올리고, 그때 한 번 다시 받는다.
-- ★ **기존 회원을 임의로 채우지 않는다.** 둘 다 NULL 로 둔다 — 다음 로그인 때 한 번
--   받는다. 받지도 않고 "동의한 것" 으로 적는 것은 기록이 아니라 조작이다.
--
-- (법률 자문이 아니다. 최종 확인은 PO 가 변호사에게 한다.)
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS legal_agreed_at timestamptz,
  ADD COLUMN IF NOT EXISTS legal_agreed_version text;

COMMENT ON COLUMN public.profiles.legal_agreed_at IS
  '이용약관·개인정보처리방침에 동의한 시각. NULL 이면 아직 받지 않았다(K-14).';
COMMENT ON COLUMN public.profiles.legal_agreed_version IS
  '동의한 문서 버전(날짜 문자열). 현재 버전보다 낮으면 다시 받는다(K-14).';

COMMIT;
