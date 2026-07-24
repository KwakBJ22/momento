-- Admin Console KPI aggregates (single scan, no 2000-row app fetch).
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_album_kpi_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      a.id,
      a.created_at,
      COALESCE(a.updated_at, a.last_collaboration_applied_at, a.created_at) AS active_at,
      COALESCE(a.album_version, 0) AS album_version,
      COALESCE(jsonb_array_length(a.living_append_pages), 0) AS page_count,
      CASE
        WHEN a.living_latest_edition_previous IS NOT NULL THEN GREATEST(COALESCE(a.album_version, 0), 1)
        ELSE COALESCE(a.album_version, 0)
      END AS edition_count,
      COALESCE(cc.cnt, 0) AS contributor_count
    FROM public.albums a
    LEFT JOIN (
      SELECT album_id, COUNT(*)::int AS cnt
      FROM public.album_contributors
      WHERE status = 'active'
      GROUP BY album_id
    ) cc ON cc.album_id = a.id
    WHERE a.deleted_at IS NULL
  ),
  living AS (
    SELECT
      *,
      (
        page_count > 0
        OR album_version > 0
        OR contributor_count > 1
        OR active_at > created_at + interval '1 day'
      ) AS is_living,
      EXTRACT(EPOCH FROM (active_at - created_at)) / 86400.0 AS lifetime_days
    FROM base
  ),
  photo_adds AS (
    SELECT album_id, COUNT(*)::numeric AS c
    FROM public.album_photos
    WHERE deleted_at IS NULL AND uploaded_by_contributor_id IS NOT NULL
    GROUP BY album_id
  ),
  memory_adds AS (
    SELECT album_id, COUNT(*)::numeric AS c
    FROM public.photo_memories
    WHERE deleted_at IS NULL AND contributor_id IS NOT NULL
    GROUP BY album_id
  ),
  album_ids AS (SELECT id FROM living)
  SELECT jsonb_build_object(
    'total_albums', (SELECT COUNT(*)::int FROM living),
    'living_album_count', (SELECT COUNT(*)::int FROM living WHERE is_living),
    'avg_lifetime_days', COALESCE(
      (SELECT AVG(lifetime_days) FROM living WHERE is_living),
      (SELECT AVG(lifetime_days) FROM living),
      0
    ),
    'avg_page_count', COALESCE((SELECT AVG(page_count) FROM living), 0),
    'avg_edition_count', COALESCE((SELECT AVG(edition_count) FROM living), 0),
    'avg_participants', COALESCE((SELECT AVG(contributor_count) FROM living), 0),
    'participation_rate', COALESCE(
      (SELECT 100.0 * COUNT(*) FILTER (WHERE contributor_count > 1) / NULLIF(COUNT(*), 0) FROM living),
      0
    ),
    'avg_added_photos', COALESCE(
      (SELECT AVG(COALESCE(pa.c, 0)) FROM album_ids a LEFT JOIN photo_adds pa ON pa.album_id = a.id),
      0
    ),
    'avg_added_memories', COALESCE(
      (SELECT AVG(COALESCE(ma.c, 0)) FROM album_ids a LEFT JOIN memory_adds ma ON ma.album_id = a.id),
      0
    ),
    'total_pages', COALESCE((SELECT SUM(page_count)::int FROM living), 0),
    'total_editions', COALESCE((SELECT SUM(edition_count)::int FROM living), 0),
    'reopened_album_ratio', COALESCE(
      (SELECT 100.0 * COUNT(*) FILTER (WHERE active_at > created_at + interval '3 days') / NULLIF(COUNT(*), 0) FROM living),
      0
    )
  );
$$;

REVOKE ALL ON FUNCTION public.admin_album_kpi_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_album_kpi_summary() TO service_role;

COMMIT;
