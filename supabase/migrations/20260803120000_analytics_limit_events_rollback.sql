-- Rollback for 20260803120000_analytics_limit_events.sql. Emergency use only.
BEGIN;

-- Revert the reclassified rows back to the upload_failed workaround — only those that
-- still carry the original error_code in metadata (the ones this migration converted).
UPDATE public.analytics_events SET event_name = 'upload_failed'
  WHERE event_name IN ('album_limit_reached', 'photo_limit_reached')
    AND metadata->>'error_code' IN ('album_limit_reached', 'photo_limit_reached');

-- Rows recorded natively with the new names after the migration have no error_code to
-- map back and cannot satisfy the narrower CHECK, so remove them before re-applying it.
DELETE FROM public.analytics_events
  WHERE event_name IN ('album_limit_reached', 'photo_limit_reached', 'video_dropped');

ALTER TABLE public.analytics_events DROP CONSTRAINT IF EXISTS analytics_events_event_name_check;

ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_event_name_check CHECK (
  event_name IN (
    'share_link_created', 'public_album_viewed', 'memory_cta_clicked', 'guest_memory_started',
    'guest_memory_completed', 'invitation_accepted', 'second_album_started', 'landing_viewed',
    'primary_cta_clicked', 'upload_started', 'upload_completed', 'guest_album_generated',
    'preview_viewed', 'save_cta_clicked', 'login_started', 'guest_album_claimed',
    'enrichment_started', 'album_rebuild_started', 'album_rebuild_completed', 'album_rebuild_failed',
    'public_contribution_started', 'album_created', 'photo_added', 'memory_added',
    'living_page_appended', 'edition_created', 'cover_photo_changed', 'pdf_generated',
    'upload_failed', 'pdf_failed', 'share_failed', 'invitation_opened', 'album_revisited'
  )
);

COMMIT;
