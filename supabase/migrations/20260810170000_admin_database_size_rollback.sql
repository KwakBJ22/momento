-- 관리자 데이터 건강 패널의 크기 측정 함수 되돌리기.
--
-- ★ 지우는 것은 **읽기 전용 측정 함수 하나**뿐이다. 사용자 데이터는 손대지 않는다.
--   이 함수는 pg_database_size(current_database()) 를 돌려줄 뿐이고,
--   테이블 내용을 내보내지 않는다.
-- ★ 되돌리면 관리자 첫 화면의 `데이터베이스 크기` 칸이 비게 된다(화면은 그대로 뜬다).
BEGIN;

DROP FUNCTION IF EXISTS public.admin_database_size_bytes();

COMMIT;
