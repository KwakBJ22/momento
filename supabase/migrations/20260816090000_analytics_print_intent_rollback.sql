-- 되돌리기 — `print_intent` 를 허용 이름에서 뺀다.
--
-- ★ 이미 쌓인 print_intent 행이 있으면 제약을 다시 걸 때 걸린다. 되돌릴 때는
--   그 행을 먼저 지울지 남길지 정해야 한다 — **수요 데이터라 지우기 전에 확인한다.**
--   (확인 조회: select count(*) from analytics_events where event_name = 'print_intent';)
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
    'contribution_claimed'
  )
);

COMMIT;
