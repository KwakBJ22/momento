-- Rollback for 20260808200000_analytics_visitor_key.sql.
-- 되돌리면 방문자 수가 다시 API 호출 수로 돌아간다(사람 수를 셀 근거가 사라진다).
BEGIN;

DROP INDEX IF EXISTS public.analytics_events_album_visitor_idx;

ALTER TABLE public.analytics_events
  DROP COLUMN IF EXISTS visitor_key;

COMMIT;
