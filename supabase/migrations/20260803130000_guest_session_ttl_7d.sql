-- Guest album sessions live 7 days instead of 24 hours. A visitor who makes an album
-- in the evening and tries to save it two days later should still find it — 24h is too
-- short. Only the DEFAULT for NEW rows changes; existing rows are left untouched.
BEGIN;

ALTER TABLE public.guest_album_sessions
  ALTER COLUMN expires_at SET DEFAULT now() + interval '7 days';

COMMIT;
