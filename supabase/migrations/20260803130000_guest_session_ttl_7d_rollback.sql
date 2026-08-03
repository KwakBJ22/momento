-- Rollback for 20260803130000_guest_session_ttl_7d.sql. Restores the 24-hour default.
-- Existing rows are left untouched.
BEGIN;

ALTER TABLE public.guest_album_sessions
  ALTER COLUMN expires_at SET DEFAULT now() + interval '24 hours';

COMMIT;
