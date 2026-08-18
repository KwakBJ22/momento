-- `print_intent` 이벤트를 허용 이름에 더한다 — 실물 인쇄 수요를 재는 자리다.
--
-- 왜: 인쇄는 1순위 수익원인데 지금은 아무 데서도 안 내보인다. 시범운영 8주가 끝나도
-- `사람들이 돈을 낼까` 에 대한 데이터가 0 이 된다(제품_방향 §7 · 유료화_기준 §7).
-- 파는 것이 아니라 **재는 것**이다 — 결제도 배송도 없다.
--
-- ★ 새 테이블을 만들지 않는다. 이미 있는 analytics_events 에 이름 하나를 더한다.
-- ★ 이름이 이 목록에 없으면 그 행은 **조용히 버려진다.** 실제로 그런 적이 있어
--   (album_appearance_changed) 칸을 먼저 열고 코드를 나중에 넣는다(개발_운영_분리 §3③).
-- ★ 지우는 것이 없다 — 기존 이름은 그대로 두고 하나만 더한다.
BEGIN;

ALTER TABLE public.analytics_events DROP CONSTRAINT IF EXISTS analytics_events_event_name_check;

ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_event_name_check CHECK (
  event_name IN (
    'share_link_created',
    'public_album_viewed',
    'memory_cta_clicked',
    'guest_memory_started',
    'guest_memory_completed',
    'invitation_accepted',
    'second_album_started',
    'landing_viewed',
    'primary_cta_clicked',
    'upload_started',
    'upload_completed',
    'guest_album_generated',
    'preview_viewed',
    'save_cta_clicked',
    'login_started',
    'guest_album_claimed',
    'enrichment_started',
    'album_rebuild_started',
    'album_rebuild_completed',
    'album_rebuild_failed',
    'public_contribution_started',
    'album_created',
    'photo_added',
    'memory_added',
    'living_page_appended',
    'edition_created',
    'cover_photo_changed',
    'pdf_generated',
    'upload_failed',
    'pdf_failed',
    'share_failed',
    'invitation_opened',
    'album_revisited',
    'album_limit_reached',
    'photo_limit_reached',
    'video_dropped',
    'contribution_claimed',
    'print_intent'
  )
);

COMMIT;
