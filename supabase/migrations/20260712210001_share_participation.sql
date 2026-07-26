-- Sprint 6: opaque public sharing, guest memories, and lightweight reactions.
BEGIN;

CREATE TABLE IF NOT EXISTS public.share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired')),
  expires_at timestamptz,
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);
CREATE INDEX IF NOT EXISTS share_links_album_status_idx ON public.share_links (album_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS share_links_expiry_idx ON public.share_links (expires_at) WHERE status = 'active';
CREATE OR REPLACE FUNCTION public.increment_share_link_view(target_share_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.share_links SET view_count = view_count + 1 WHERE id = target_share_id AND status = 'active';
$$;
REVOKE ALL ON FUNCTION public.increment_share_link_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_share_link_view(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.guest_memory_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id uuid NOT NULL REFERENCES public.share_links(id) ON DELETE RESTRICT,
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE RESTRICT,
  guest_name text NOT NULL CHECK (char_length(guest_name) BETWEEN 1 AND 50),
  memory_text text NOT NULL CHECK (char_length(memory_text) BETWEEN 1 AND 300),
  claim_token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'expired', 'rejected')),
  claimed_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  memory_answer_id uuid REFERENCES public.memory_answers(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS guest_memory_album_status_idx ON public.guest_memory_submissions (album_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_memory_expiry_idx ON public.guest_memory_submissions (expires_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.share_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id uuid NOT NULL REFERENCES public.share_links(id) ON DELETE RESTRICT,
  reaction text NOT NULL CHECK (reaction IN ('remember', 'warm', 'smile')),
  session_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT share_reactions_one_per_session UNIQUE (share_link_id, session_hash, reaction)
);

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL CHECK (event_name IN ('share_link_created', 'public_album_viewed', 'memory_cta_clicked', 'guest_memory_started', 'guest_memory_completed', 'invitation_accepted', 'second_album_started')),
  share_link_id uuid REFERENCES public.share_links(id) ON DELETE SET NULL,
  album_id uuid REFERENCES public.albums(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_name_created_idx ON public.analytics_events (event_name, created_at DESC);

DROP TRIGGER IF EXISTS share_links_set_updated_at ON public.share_links;
CREATE TRIGGER share_links_set_updated_at BEFORE UPDATE ON public.share_links FOR EACH ROW EXECUTE FUNCTION public.set_db_core_updated_at();
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_memory_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
-- service-role APIs mediate public token access; no direct anon policies.

COMMIT;
