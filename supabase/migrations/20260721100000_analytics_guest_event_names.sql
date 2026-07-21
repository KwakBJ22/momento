-- Ensure guest onboarding analytics event names are allowed (fixes insert 400 on CHECK violation).
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
    'enrichment_started'
  )
);

COMMIT;
