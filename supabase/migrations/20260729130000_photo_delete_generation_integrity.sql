-- Keep an album's current photo source and cover in sync when one photo is removed.
-- Storage cleanup remains in the API because PostgreSQL cannot atomically delete
-- Storage objects; DB references are committed first so a Storage retry is safe.
BEGIN;

CREATE OR REPLACE FUNCTION public.soft_delete_album_photo(
  p_album_id uuid,
  p_photo_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_cover uuid;
  v_current_cover uuid;
  v_deleted_memory_ids jsonb := '[]'::jsonb;
BEGIN
  UPDATE public.album_photos
  SET status = 'deleted', deleted_at = COALESCE(deleted_at, now())
  WHERE id = p_photo_id
    AND album_id = p_album_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.album_media
  SET deleted_at = COALESCE(deleted_at, now())
  WHERE id = p_photo_id
    AND album_id = p_album_id
    AND deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(id::text), '[]'::jsonb)
  INTO v_deleted_memory_ids
  FROM public.photo_memories
  WHERE album_id = p_album_id
    AND photo_id = p_photo_id
    AND deleted_at IS NULL;

  UPDATE public.photo_memories
  SET deleted_at = COALESCE(deleted_at, now())
  WHERE album_id = p_album_id
    AND photo_id = p_photo_id
    AND deleted_at IS NULL;

  SELECT cover_photo_id
  INTO v_current_cover
  FROM public.albums
  WHERE id = p_album_id;

  SELECT id
  INTO v_next_cover
  FROM public.album_photos
  WHERE album_id = p_album_id
    AND id = v_current_cover
    AND status = 'ready'
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_next_cover IS NULL THEN
    SELECT id
    INTO v_next_cover
    FROM public.album_photos
    WHERE album_id = p_album_id
      AND status = 'ready'
      AND deleted_at IS NULL
    ORDER BY sort_order
    LIMIT 1;
  END IF;

  -- The current rendered document and PDF cache can contain the deleted ID.
  -- Clear only current derived state; historical edition snapshots remain intact.
  UPDATE public.albums
  SET cover_photo_id = v_next_cover,
      album_json = NULL,
      living_append_pages = '[]'::jsonb,
      pdf_cache = '{}'::jsonb,
      applied_contribution_photo_ids = COALESCE((
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(COALESCE(applied_contribution_photo_ids, '[]'::jsonb)) AS photo_ids(value)
        WHERE value <> p_photo_id::text
      ), '[]'::jsonb),
      applied_contribution_memory_ids = COALESCE((
        SELECT jsonb_agg(value)
        FROM jsonb_array_elements_text(COALESCE(applied_contribution_memory_ids, '[]'::jsonb)) AS memory_ids(value)
        WHERE value NOT IN (SELECT value FROM jsonb_array_elements_text(v_deleted_memory_ids) AS deleted_ids(value))
      ), '[]'::jsonb),
      dirty = true,
      last_rebuild_started_at = NULL,
      updated_at = now()
  WHERE id = p_album_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_album_photo(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_album_photo(uuid, uuid) TO service_role;

COMMIT;
