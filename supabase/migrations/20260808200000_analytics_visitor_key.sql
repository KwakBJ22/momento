-- 방문자를 **사람 단위**로 세기 위한 익명 식별자.
--
-- 지금까지 "지금까지 N명이 다녀갔어요" 는 share_links.view_count 를 더한 값이라
-- 사실상 **API 호출 수**였다(프로덕션 실측: album_revisited 165 / public_album_viewed 139,
-- 실제 사람은 2명). analytics_events 에 사람을 구분할 값이 없었기 때문이다.
--
-- ★ 개인정보를 새로 받지 않는다. IP·User-Agent 를 쓰지 않는다.
--   album_guestbook_entries.session_hash 와 같은 방식이다 — 브라우저가 무작위 문자열
--   하나를 갖고, 서버는 그것의 sha256 해시만 저장한다. 되돌려 사람을 알아낼 수 없다.
--   로그인한 사람은 user_id 로 만든 키를 쓴다(판정은 서버 한 곳에서 한다).
--
-- ★ 옛 행(visitor_key 가 비어 있는 165건 등)은 지우지 않는다. 세지 않을 뿐이다 —
--   방문자 수는 0부터 다시 시작한다.
BEGIN;

ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS visitor_key text;

-- 앨범별 "서로 다른 사람 수" 질의를 위한 인덱스.
CREATE INDEX IF NOT EXISTS analytics_events_album_visitor_idx
  ON public.analytics_events (album_id, visitor_key)
  WHERE visitor_key IS NOT NULL;

COMMENT ON COLUMN public.analytics_events.visitor_key IS
  '방문자 익명 식별자의 sha256 해시. 로그인 사용자는 user id 기반, 아니면 브라우저의 무작위 토큰 기반. 개인정보(IP·UA)를 쓰지 않는다.';

COMMIT;
