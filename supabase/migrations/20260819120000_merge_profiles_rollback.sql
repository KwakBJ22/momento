-- 되돌리기 — 합치기 함수를 없앤다.
-- ★ 이미 합쳐진 계정은 이 파일로 되돌아오지 않는다. 함수만 사라진다(합치기가 막힌다).
--   되돌리려면 닫힌 profiles 의 deleted_at 과 옮겨진 행을 따로 봐야 한다.
BEGIN;
DROP FUNCTION IF EXISTS public.merge_profiles(uuid, uuid);
COMMIT;
