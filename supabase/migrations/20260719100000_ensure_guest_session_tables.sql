-- Repair migration: safe to apply when earlier guest migrations were only partially deployed.
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
CREATE INDEX IF NOT EXISTS guest_album_sessions_expiry_idx
  ON public.guest_album_sessions (expires_at) WHERE status = 'active';
ALTER TABLE public.guest_album_sessions ENABLE ROW LEVEL SECURITY;

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
CREATE INDEX IF NOT EXISTS guest_memory_album_status_idx
  ON public.guest_memory_submissions (album_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_memory_expiry_idx
  ON public.guest_memory_submissions (expires_at) WHERE status = 'pending';
ALTER TABLE public.guest_memory_submissions ENABLE ROW LEVEL SECURITY;

COMMIT;
