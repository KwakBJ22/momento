-- Add the contribution_claimed event: an invited participant's guest contributions were
-- attributed to their account after login. This measures invite→participation conversion
-- (one of the three make-or-break metrics). Same pattern as 20260803120000. Removes nothing.
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
