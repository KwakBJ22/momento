-- UX-1: expiring guest albums that can be safely claimed after magic-link login.
BEGIN;

CREATE TABLE IF NOT EXISTS public.guest_album_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL UNIQUE REFERENCES public.albums(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'claimed', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  claimed_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS guest_album_sessions_expiry_idx ON public.guest_album_sessions (expires_at) WHERE status = 'active';
ALTER TABLE public.guest_album_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.analytics_events DROP CONSTRAINT IF EXISTS analytics_events_event_name_check;
ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_event_name_check CHECK (event_name IN (
  'share_link_created', 'public_album_viewed', 'memory_cta_clicked', 'guest_memory_started', 'guest_memory_completed', 'invitation_accepted', 'second_album_started',
  'landing_viewed', 'primary_cta_clicked', 'upload_started', 'upload_completed', 'guest_album_generated', 'preview_viewed', 'save_cta_clicked', 'login_started', 'guest_album_claimed', 'enrichment_started'
));

COMMIT;
