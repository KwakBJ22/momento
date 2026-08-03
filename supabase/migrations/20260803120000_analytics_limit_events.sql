-- Give the limit / abuse signals their own event names instead of overloading
-- upload_failed + metadata.error_code. The workaround (a) polluted the upload-failure
-- rate with limit rejections, (b) mislabeled claim rejections as upload failures, and
-- (c) required metadata parsing to read. Same pattern as
-- 20260801120000_analytics_metric_events.sql. PO-approved.
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
    'video_dropped'
  )
);

-- Reclassify rows already recorded via the upload_failed workaround into the dedicated
-- names. The WHERE clauses narrow to exactly those workaround rows, so this is a no-op
-- when none exist. Runs AFTER the constraint above already allows the new names.
UPDATE public.analytics_events SET event_name = 'album_limit_reached'
  WHERE event_name = 'upload_failed' AND metadata->>'error_code' = 'album_limit_reached';
UPDATE public.analytics_events SET event_name = 'photo_limit_reached'
  WHERE event_name = 'upload_failed' AND metadata->>'error_code' = 'photo_limit_reached';

COMMIT;
