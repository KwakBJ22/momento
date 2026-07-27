-- Development-only manual cleanup for the retired Magic Link / guest-claim flow.
-- Do NOT run through the migration runner. Back up first and run only after the
-- social-auth deployment is verified. Public share/contribution tables are not
-- included here.

-- Inspect legacy data before choosing a destructive command:
-- SELECT count(*) FROM public.guest_album_sessions;
-- SELECT count(*) FROM public.guest_memory_submissions;

-- Existing development test data may be removed manually:
-- TRUNCATE TABLE public.guest_album_sessions CASCADE;
-- TRUNCATE TABLE public.guest_memory_submissions CASCADE;

-- If the tables are no longer referenced by any deployment, remove them in a
-- separately approved maintenance window:
-- DROP TABLE IF EXISTS public.guest_memory_submissions CASCADE;
-- DROP TABLE IF EXISTS public.guest_album_sessions CASCADE;
