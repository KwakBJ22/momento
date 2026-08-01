-- Rollback for 20260801100000_share_link_kind.sql. Emergency use only.
BEGIN;

ALTER TABLE public.share_links DROP COLUMN IF EXISTS kind;

COMMIT;
